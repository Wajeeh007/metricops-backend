import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import type { AwsAssumeRoleConfiguration } from "../connections/types.js";
import { withTenantTransaction } from "../database/transaction.js";
import { notFound } from "../domain/errors.js";
import type { AwsInventoryProvider } from "./aws-inventory-provider.js";
import { awsAssumeRoleConfigurationSchema } from "./aws-schema.js";

export class AwsDiscoveryService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService, private readonly inventory: AwsInventoryProvider) {}

  async discover(customerId: string, connectionId: string, jobId: string, actorId: string) {
    const configuration = await withTenantTransaction(this.pool, { customerId, actorId }, async (client) => {
      const result = await client.query<{ configuration: AwsAssumeRoleConfiguration }>(
        "SELECT configuration FROM connections WHERE customer_id=$1 AND id=$2 AND kind='aws_assume_role' AND status<>'disabled'",
        [customerId, connectionId],
      );
      if (!result.rows[0]) throw notFound("Connection");
      return awsAssumeRoleConfigurationSchema.parse(result.rows[0].configuration);
    });
    const resources = await this.inventory.discover(configuration, customerId);
    const source = `aws:${connectionId}`;
    return withTenantTransaction(this.pool, { customerId, actorId }, async (client) => {
      for (const resource of resources) {
        await client.query(
          `INSERT INTO resources
           (id,customer_id,provider_id,resource_type,name,environment,criticality,data_classification,tags,source,last_discovered_at,last_discovery_job_id,discovery_state,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,'active',$12)
           ON CONFLICT(customer_id,source,provider_id) DO UPDATE SET
             resource_type=excluded.resource_type,name=excluded.name,environment=excluded.environment,
             criticality=excluded.criticality,data_classification=excluded.data_classification,tags=excluded.tags,
             last_discovered_at=now(),last_discovery_job_id=excluded.last_discovery_job_id,
             discovery_state='active',updated_at=now(),version=resources.version+1`,
          [randomUUID(), customerId, resource.providerId, resource.resourceType, resource.name, resource.environment, resource.criticality, resource.dataClassification, resource.tags, source, jobId, actorId],
        );
      }
      const missing = await client.query(
        `UPDATE resources SET discovery_state='missing',updated_at=now(),version=version+1
         WHERE customer_id=$1 AND source=$2 AND discovery_state='active'
           AND last_discovery_job_id IS DISTINCT FROM $3`,
        [customerId, source, jobId],
      );
      await this.audit.append(client, {
        customerId, actorId, action: "aws.discovery.completed", resourceType: "connection", resourceId: connectionId,
        requestId: jobId, details: { discovered: resources.length, markedMissing: missing.rowCount ?? 0, regions: configuration.regions, resourceTypes: configuration.resourceTypes },
      });
      return { discovered: resources.length, markedMissing: missing.rowCount ?? 0 };
    });
  }
}
