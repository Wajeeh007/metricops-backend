import { z } from "zod";
import { awsAssumeRoleConfigurationSchema } from "../aws/aws-schema.js";

const hostname = z.string().trim().min(1).max(253).regex(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$|^(?:\d{1,3}\.){3}\d{1,3}$/);

const postgresConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("postgresql"),
  configuration: z.object({
    host: hostname,
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1).max(63),
    sslMode: z.literal("verify-full"),
  }).strict(),
  secretRef: z.string().regex(/^file:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
}).strict();

const mysqlConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("mysql"),
  configuration: z.object({
    host: hostname,
    port: z.number().int().min(1).max(65535).default(3306),
    database: z.string().trim().min(1).max(64),
    sslMode: z.literal("verify_identity"),
  }).strict(),
  secretRef: z.string().regex(/^file:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
}).strict();

const prometheusConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("prometheus"),
  configuration: z.object({
    baseUrl: z.string().url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
    }, "Prometheus URL must use HTTPS and must not contain credentials, query, or fragment"),
    healthPath: z.string().regex(/^\/[A-Za-z0-9/_-]{1,128}$/).default("/-/ready"),
  }).strict(),
  secretRef: z.string().regex(/^file:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).nullable().default(null),
}).strict();

const alertmanagerWebhookConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("alertmanager_webhook"),
  configuration: z.object({ sourceName: z.string().trim().min(1).max(120) }).strict(),
  secretRef: z.string().regex(/^file:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
}).strict();

const awsAssumeRoleConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("aws_assume_role"),
  configuration: awsAssumeRoleConfigurationSchema,
  secretRef: z.null(),
}).strict();

export const createConnectionSchema = z.discriminatedUnion("kind", [postgresConnectionSchema, mysqlConnectionSchema, prometheusConnectionSchema, alertmanagerWebhookConnectionSchema, awsAssumeRoleConnectionSchema]);

const stringMap = (maxValueLength: number) => z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(maxValueLength)).refine((value) => Object.keys(value).length <= 64);
const alertmanagerAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: stringMap(500),
  annotations: stringMap(2000).default({}),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
  fingerprint: z.string().regex(/^[A-Fa-f0-9]{1,64}$/),
});

export const alertmanagerWebhookSchema = z.object({
  version: z.string().max(20),
  status: z.enum(["firing", "resolved"]),
  receiver: z.string().max(200),
  alerts: z.array(alertmanagerAlertSchema).min(1).max(100),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
}).strict();

export const uuidSchema = z.string().uuid();
export const listLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

const tagsSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  z.string().max(120),
).refine((tags) => Object.keys(tags).length <= 32, "No more than 32 tags are allowed");

export const createResourceSchema = z.object({
  providerId: z.string().trim().min(1).max(300),
  resourceType: z.enum(["linux_host", "application_endpoint", "database_instance", "aws_ec2", "aws_ebs", "aws_rds", "aws_load_balancer"]),
  name: z.string().trim().min(1).max(200),
  environment: z.string().trim().min(1).max(100),
  criticality: z.enum(["low", "medium", "high", "critical"]),
  dataClassification: z.enum(["public", "internal", "confidential", "restricted"]),
  monitoringConnectionId: z.string().uuid().nullable().default(null),
  monitoringSelector: z.string().regex(/^[A-Za-z0-9._:-]{1,253}$/).nullable().default(null),
  tags: tagsSchema.default({}),
  source: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/),
}).strict().refine(
  (value) => (value.monitoringConnectionId === null) === (value.monitoringSelector === null),
  { message: "Monitoring connection and selector must be supplied together", path: ["monitoringConnectionId"] },
);

export const metricsQuerySchema = z.object({
  resourceId: z.string().uuid(),
  queryId: z.enum(["host.up", "host.cpu.utilization", "host.memory.utilization"]),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  stepSeconds: z.number().int().min(15).max(3600),
}).strict().superRefine((value, context) => {
  const start = new Date(value.start).getTime();
  const end = new Date(value.end).getTime();
  if (end <= start) context.addIssue({ code: "custom", path: ["end"], message: "End must be after start" });
  if (end - start > 86_400_000) context.addIssue({ code: "custom", path: ["end"], message: "Range cannot exceed 24 hours" });
  if (end > Date.now() + 60_000) context.addIssue({ code: "custom", path: ["end"], message: "End cannot be in the future" });
  if ((end - start) / (value.stepSeconds * 1000) > 2_000) context.addIssue({ code: "custom", path: ["stepSeconds"], message: "Query exceeds the point budget" });
});

export const incidentTransitionSchema = z.object({
  version: z.number().int().positive(),
  assignee: z.string().trim().min(1).max(200).optional(),
  resolution: z.string().trim().min(1).max(4000).optional(),
}).strict();

export const operationsReportQuerySchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (end <= start) context.addIssue({ code: "custom", path: ["end"], message: "End must be after start" });
  if (end - start > 90 * 86_400_000) context.addIssue({ code: "custom", path: ["end"], message: "Report range cannot exceed 90 days" });
  if (end > Date.now() + 60_000) context.addIssue({ code: "custom", path: ["end"], message: "End cannot be in the future" });
});
