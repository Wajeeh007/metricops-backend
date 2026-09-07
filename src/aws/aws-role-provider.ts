import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { AwsAssumeRoleConfiguration, ConnectionCheck, ConnectionRecord, Connector } from "../connections/types.js";
import { awsAssumeRoleConfigurationSchema } from "./aws-schema.js";

export interface AssumedAwsRole {
  readonly credentials: AwsCredentialIdentity;
  readonly accountId: string;
}

export interface AwsRoleProvider {
  assume(configuration: AwsAssumeRoleConfiguration, customerId: string): Promise<AssumedAwsRole>;
}

export class DefaultAwsRoleProvider implements AwsRoleProvider {
  constructor(private readonly timeoutMs: number) {}

  async assume(configuration: AwsAssumeRoleConfiguration, customerId: string): Promise<AssumedAwsRole> {
    configuration = awsAssumeRoleConfigurationSchema.parse(configuration);
    const region = configuration.regions[0]!;
    const requestHandler = new NodeHttpHandler({ connectionTimeout: this.timeoutMs, requestTimeout: this.timeoutMs });
    const source = new STSClient({ region, maxAttempts: 3, requestHandler });
    try {
      const assumed = await source.send(new AssumeRoleCommand({
        RoleArn: configuration.roleArn,
        ExternalId: configuration.externalId,
        RoleSessionName: `metricops-${customerId.replaceAll("-", "").slice(0, 24)}`,
        SourceIdentity: `metricops-${customerId}`,
        DurationSeconds: 900,
      }));
      const value = assumed.Credentials;
      if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken || !value.Expiration) throw new Error("AWS returned incomplete temporary credentials");
      const credentials: AwsCredentialIdentity = {
        accessKeyId: value.AccessKeyId,
        secretAccessKey: value.SecretAccessKey,
        sessionToken: value.SessionToken,
        expiration: value.Expiration,
      };
      const verification = new STSClient({ region, credentials, maxAttempts: 3, requestHandler });
      try {
        const identity = await verification.send(new GetCallerIdentityCommand({}));
        if (!identity.Account || !/^\d{12}$/.test(identity.Account)) throw new Error("AWS identity is incomplete");
        return { credentials, accountId: identity.Account };
      } finally {
        verification.destroy();
      }
    } finally {
      source.destroy();
    }
  }
}

export class AwsAssumeRoleConnector implements Connector {
  readonly kind = "aws_assume_role" as const;
  constructor(private readonly roles: AwsRoleProvider) {}

  async validate(connection: ConnectionRecord): Promise<ConnectionCheck> {
    const checkedAt = new Date();
    const started = performance.now();
    try {
      if (connection.secretRef !== null) throw new Error("AWS connections cannot use stored access keys");
      const configuration = awsAssumeRoleConfigurationSchema.parse(connection.configuration);
      const role = await this.roles.assume(configuration, connection.customerId);
      return { healthy: true, checkedAt, latencyMs: Math.round(performance.now() - started), metadata: { accountId: role.accountId, authentication: "assume-role" } };
    } catch {
      return { healthy: false, checkedAt, latencyMs: Math.round(performance.now() - started), metadata: {}, errorCode: "AWS_ROLE_UNAVAILABLE" };
    }
  }
}
