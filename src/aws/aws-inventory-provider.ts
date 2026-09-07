import { DescribeInstancesCommand, DescribeVolumesCommand, EC2Client, type Tag } from "@aws-sdk/client-ec2";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import type { AwsAssumeRoleConfiguration, AwsResourceType } from "../connections/types.js";
import type { AwsRoleProvider } from "./aws-role-provider.js";

export interface DiscoveredAwsResource {
  readonly providerId: string;
  readonly resourceType: AwsResourceType;
  readonly name: string;
  readonly environment: string;
  readonly criticality: "low" | "medium" | "high" | "critical";
  readonly dataClassification: "public" | "internal" | "confidential" | "restricted";
  readonly tags: Readonly<Record<string, string>>;
}

export interface AwsInventoryProvider {
  discover(configuration: AwsAssumeRoleConfiguration, customerId: string): Promise<readonly DiscoveredAwsResource[]>;
}

export class DefaultAwsInventoryProvider implements AwsInventoryProvider {
  constructor(private readonly roles: AwsRoleProvider, private readonly timeoutMs: number) {}

  async discover(configuration: AwsAssumeRoleConfiguration, customerId: string): Promise<readonly DiscoveredAwsResource[]> {
    const assumed = await this.roles.assume(configuration, customerId);
    const found: DiscoveredAwsResource[] = [];
    for (const region of configuration.regions) {
      for (const resourceType of configuration.resourceTypes) {
        const page = await this.discoverType(resourceType, region, assumed.credentials, assumed.accountId, configuration.maxResources - found.length);
        found.push(...page);
        if (found.length > configuration.maxResources) throw new Error("AWS_DISCOVERY_LIMIT_EXCEEDED");
      }
    }
    return found;
  }

  private async discoverType(resourceType: AwsResourceType, region: string, credentials: AwsCredentialIdentity, accountId: string, remaining: number) {
    if (remaining <= 0) throw new Error("AWS_DISCOVERY_LIMIT_EXCEEDED");
    const requestHandler = new NodeHttpHandler({ connectionTimeout: this.timeoutMs, requestTimeout: this.timeoutMs });
    if (resourceType === "aws_ec2" || resourceType === "aws_ebs") {
      const client = new EC2Client({ region, credentials, maxAttempts: 3, requestHandler });
      try { return resourceType === "aws_ec2" ? await discoverEc2(client, region, accountId, remaining) : await discoverEbs(client, region, accountId, remaining); }
      finally { client.destroy(); }
    }
    if (resourceType === "aws_rds") {
      const client = new RDSClient({ region, credentials, maxAttempts: 3, requestHandler });
      try { return await discoverRds(client, region, accountId, remaining); }
      finally { client.destroy(); }
    }
    const client = new ElasticLoadBalancingV2Client({ region, credentials, maxAttempts: 3, requestHandler });
    try { return await discoverLoadBalancers(client, region, accountId, remaining); }
    finally { client.destroy(); }
  }
}

async function discoverEc2(client: EC2Client, region: string, accountId: string, limit: number) {
  const result: DiscoveredAwsResource[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new DescribeInstancesCommand({ MaxResults: 100, ...(token ? { NextToken: token } : {}) }));
    for (const reservation of page.Reservations ?? []) for (const instance of reservation.Instances ?? []) {
      if (!instance.InstanceId) continue;
      result.push(resource(instance.InstanceId, "aws_ec2", awsTags(instance.Tags), region, accountId));
      enforceLimit(result, limit);
    }
    token = page.NextToken;
  } while (token);
  return result;
}

async function discoverEbs(client: EC2Client, region: string, accountId: string, limit: number) {
  const result: DiscoveredAwsResource[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new DescribeVolumesCommand({ MaxResults: 100, ...(token ? { NextToken: token } : {}) }));
    for (const volume of page.Volumes ?? []) {
      if (!volume.VolumeId) continue;
      result.push(resource(volume.VolumeId, "aws_ebs", awsTags(volume.Tags), region, accountId));
      enforceLimit(result, limit);
    }
    token = page.NextToken;
  } while (token);
  return result;
}

async function discoverRds(client: RDSClient, region: string, accountId: string, limit: number) {
  const result: DiscoveredAwsResource[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(new DescribeDBInstancesCommand({ MaxRecords: 100, ...(marker ? { Marker: marker } : {}) }));
    for (const database of page.DBInstances ?? []) {
      if (!database.DBInstanceArn || !database.DBInstanceIdentifier) continue;
      result.push(resource(database.DBInstanceArn, "aws_rds", { Name: database.DBInstanceIdentifier }, region, accountId));
      enforceLimit(result, limit);
    }
    marker = page.Marker;
  } while (marker);
  return result;
}

async function discoverLoadBalancers(client: ElasticLoadBalancingV2Client, region: string, accountId: string, limit: number) {
  const result: DiscoveredAwsResource[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(new DescribeLoadBalancersCommand({ PageSize: 100, ...(marker ? { Marker: marker } : {}) }));
    for (const loadBalancer of page.LoadBalancers ?? []) {
      if (!loadBalancer.LoadBalancerArn || !loadBalancer.LoadBalancerName) continue;
      result.push(resource(loadBalancer.LoadBalancerArn, "aws_load_balancer", { Name: loadBalancer.LoadBalancerName }, region, accountId));
      enforceLimit(result, limit);
    }
    marker = page.NextMarker;
  } while (marker);
  return result;
}

function resource(providerId: string, resourceType: AwsResourceType, sourceTags: Readonly<Record<string, string>>, region: string, accountId: string): DiscoveredAwsResource {
  const tags = sanitizeTags({ ...sourceTags, aws_region: region, aws_account: accountId });
  return {
    providerId, resourceType, name: (sourceTags.Name || providerId).slice(0, 200),
    environment: (sourceTags.Environment || "unknown").slice(0, 100),
    criticality: enumValue(sourceTags.MetricOpsCriticality, ["low", "medium", "high", "critical"], "medium"),
    dataClassification: enumValue(sourceTags.MetricOpsDataClassification, ["public", "internal", "confidential", "restricted"], "internal"),
    tags,
  };
}

function awsTags(tags: readonly Tag[] | undefined): Record<string, string> {
  return Object.fromEntries((tags ?? []).filter((tag) => tag.Key && tag.Value !== undefined).map((tag) => [tag.Key!, tag.Value!]));
}

function sanitizeTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).filter(([key]) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)).slice(0, 32).map(([key, value]) => [key, value.slice(0, 120)]));
}

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const normalized = value?.toLowerCase() as T | undefined;
  return normalized && allowed.includes(normalized) ? normalized : fallback;
}

function enforceLimit(items: readonly unknown[], limit: number): void {
  if (items.length > limit) throw new Error("AWS_DISCOVERY_LIMIT_EXCEEDED");
}
