export type ConnectionKind = "postgresql" | "mysql" | "prometheus" | "alertmanager_webhook" | "aws_assume_role";

export interface PostgresConnectionConfiguration {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly sslMode: "verify-full";
}

export interface MysqlConnectionConfiguration {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly sslMode: "verify_identity";
}

export interface PrometheusConnectionConfiguration {
  readonly baseUrl: string;
  readonly healthPath: string;
}

export interface AlertmanagerWebhookConfiguration { readonly sourceName: string }

export type AwsResourceType = "aws_ec2" | "aws_ebs" | "aws_rds" | "aws_load_balancer";
export interface AwsAssumeRoleConfiguration {
  readonly roleArn: string;
  readonly externalId: string;
  readonly regions: readonly string[];
  readonly resourceTypes: readonly AwsResourceType[];
  readonly maxResources: number;
}

export type ConnectionConfiguration = PostgresConnectionConfiguration | MysqlConnectionConfiguration | PrometheusConnectionConfiguration | AlertmanagerWebhookConfiguration | AwsAssumeRoleConfiguration;

export interface ConnectionRecord {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly kind: ConnectionKind;
  readonly configuration: ConnectionConfiguration;
  readonly secretRef: string | null;
  readonly status: "pending" | "healthy" | "unhealthy" | "disabled";
  readonly lastValidatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConnectionCheck {
  readonly healthy: boolean;
  readonly checkedAt: Date;
  readonly latencyMs: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly errorCode?: string;
}

export interface Connector {
  readonly kind: ConnectionKind;
  validate(connection: ConnectionRecord): Promise<ConnectionCheck>;
}
