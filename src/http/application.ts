import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import type { AlertmanagerService } from "../alerts/alertmanager-service.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { CustomerService } from "../customers/customer-service.js";
import type { JobService } from "../jobs/job-service.js";
import type { IncidentService } from "../incidents/incident-service.js";
import type { MetricsService } from "../metrics/metrics-service.js";
import type { ResourceService } from "../resources/resource-service.js";
import type { OperationsReportService } from "../reports/operations-report-service.js";
import type { OperationalTelemetry } from "../observability/operational-telemetry.js";
import type { AuditQueryService } from "../audit/audit-query-service.js";
import { AppError, forbidden, invalid, unauthorized } from "../domain/errors.js";
import type { Permission, Principal } from "../domain/principal.js";
import type { Authenticator } from "../security/authentication.js";
import { authorize } from "../security/authorization.js";
import type { SessionService } from "../security/session-service.js";
import { createConnectionSchema, createCustomerSchema, createResourceSchema, incidentTransitionSchema, listLimitSchema, metricsQuerySchema, operationsReportQuerySchema, uuidSchema } from "./schemas.js";

export interface ApplicationDependencies {
  readonly config: AppConfig;
  readonly pool: pg.Pool;
  readonly authenticator: Authenticator;
  readonly connections: ConnectionService;
  readonly customers: CustomerService;
  readonly sessions: SessionService;
  readonly jobs: JobService;
  readonly resources: ResourceService;
  readonly metrics: MetricsService;
  readonly alertmanager: AlertmanagerService;
  readonly incidents: IncidentService;
  readonly reports: OperationsReportService;
  readonly telemetry: OperationalTelemetry;
  readonly auditQuery: AuditQueryService;
}

function authenticated(request: Request): Principal {
  if (!request.principal) throw unauthorized();
  return request.principal;
}

function requirePermission(permission: Permission) {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      authorize(authenticated(request), permission);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createApplication(dependencies: ApplicationDependencies) {
  const { config, pool, authenticator, connections, customers, sessions, jobs, resources, metrics, alertmanager, incidents, reports, telemetry, auditQuery } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((request, response, next) => {
    const supplied = request.header("x-request-id");
    request.requestId = supplied && uuidSchema.safeParse(supplied).success ? supplied : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.use(pinoHttp({
    redact: {
      paths: [
        "err",
        "req.url",
        "req.query",
        "req.params",
        "req.body",
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-metricops-signature",
        "res.headers['set-cookie']",
      ],
      censor: "[REDACTED]",
    },
    autoLogging: { ignore: (request) => request.url === "/health/live" },
  }));
  app.use((request, response, next) => { telemetry.observe(request, response); next(); });
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    strictTransportSecurity: config.environment === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(forbidden());
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-request-id", "x-metricops-timestamp", "x-metricops-nonce", "x-metricops-signature"],
    exposedHeaders: ["x-request-id"],
    credentials: false,
    maxAge: 600,
  }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: config.rateLimit.max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request, response) => response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" }, requestId: request.requestId }),
  }));
  app.get("/internal/metrics", async (request, response) => {
    telemetry.authenticate(request.header("authorization"));
    const rendered = await telemetry.render();
    response.setHeader("content-type", rendered.contentType);
    response.setHeader("cache-control", "no-store");
    response.send(rendered.body);
  });
  app.post(
    "/api/v1/webhooks/alertmanager/:customerId/:connectionId",
    express.raw({ limit: "256kb", type: "application/json" }),
    async (request, response) => {
      const customerId = uuidSchema.parse(request.params.customerId);
      const connectionId = uuidSchema.parse(request.params.connectionId);
      if (!Buffer.isBuffer(request.body)) throw invalid("INVALID_WEBHOOK_PAYLOAD", "The webhook body must be JSON");
      const data = await alertmanager.ingest(customerId, connectionId, {
        "x-metricops-timestamp": request.header("x-metricops-timestamp"),
        "x-metricops-nonce": request.header("x-metricops-nonce"),
        "x-metricops-signature": request.header("x-metricops-signature"),
      }, request.body, request.requestId);
      response.status(202).json({ data, requestId: request.requestId });
    },
  );

  app.use(express.json({ limit: "256kb", strict: true, type: "application/json" }));

  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/health/ready", async (_request, response, next) => {
    try {
      await pool.query("SELECT 1");
      telemetry.markReady();
      response.json({ status: "ready" });
    } catch (error) {
      telemetry.markDependencyFailure("postgresql");
      next(new AppError(503, "DEPENDENCY_UNAVAILABLE", "A required dependency is unavailable"));
    }
  });

  app.use("/api/v1", async (request, _response, next) => {
    try {
      request.principal = await authenticator.authenticate(request.header("authorization"));
      await sessions.assertActive(request.principal);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/connections", requirePermission("connection:read"), async (request, response) => {
    const limit = listLimitSchema.parse(request.query.limit);
    const data = await connections.list(authenticated(request), limit);
    response.json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/connections", requirePermission("connection:write"), async (request, response) => {
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey || !uuidSchema.safeParse(idempotencyKey).success) {
      throw invalid("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key UUID header is required");
    }
    const input = createConnectionSchema.parse(request.body);
    const data = await connections.create(authenticated(request), input, idempotencyKey, request.requestId);
    response.status(201).json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/connections/:connectionId/validation-jobs", requirePermission("connection:validate"), async (request, response) => {
    const connectionId = uuidSchema.parse(request.params.connectionId);
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey || !uuidSchema.safeParse(idempotencyKey).success) {
      throw invalid("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key UUID header is required");
    }
    const data = await jobs.enqueueConnectionValidation(authenticated(request), connectionId, idempotencyKey, request.requestId);
    response.status(202).location(`/api/v1/jobs/${data.id}`).json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/connections/:connectionId/discovery-jobs", requirePermission("resource:discover"), async (request, response) => {
    const connectionId = uuidSchema.parse(request.params.connectionId);
    const idempotencyKey = requireIdempotencyKey(request);
    const data = await jobs.enqueueAwsDiscovery(authenticated(request), connectionId, idempotencyKey, request.requestId);
    response.status(202).location(`/api/v1/jobs/${data.id}`).json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/jobs/:jobId", requirePermission("job:read"), async (request, response) => {
    const jobId = uuidSchema.parse(request.params.jobId);
    const data = await jobs.get(authenticated(request), jobId);
    response.json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/resources", requirePermission("resource:write"), async (request, response) => {
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey || !uuidSchema.safeParse(idempotencyKey).success) throw invalid("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key UUID header is required");
    const input = createResourceSchema.parse(request.body);
    const data = await resources.create(authenticated(request), input, idempotencyKey, request.requestId);
    response.status(201).json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/resources", requirePermission("resource:read"), async (request, response) => {
    const limit = listLimitSchema.parse(request.query.limit);
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
    const result = await resources.list(authenticated(request), limit, cursor);
    response.json({ ...result, requestId: request.requestId });
  });

  app.post("/api/v1/metrics/query", requirePermission("metrics:read"), async (request, response) => {
    const input = metricsQuerySchema.parse(request.body);
    const data = await metrics.query(authenticated(request), input, request.requestId);
    response.json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/alerts", requirePermission("alert:read"), async (request, response) => {
    const limit = listLimitSchema.parse(request.query.limit);
    const data = await incidents.listAlerts(authenticated(request), limit);
    response.json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/incidents", requirePermission("incident:read"), async (request, response) => {
    const limit = listLimitSchema.parse(request.query.limit);
    const data = await incidents.listIncidents(authenticated(request), limit);
    response.json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/incidents/:incidentId/acknowledge", requirePermission("incident:write"), async (request, response) => {
    const incidentId = uuidSchema.parse(request.params.incidentId);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = incidentTransitionSchema.parse(request.body);
    if (input.resolution !== undefined) throw invalid("VALIDATION_FAILED", "Resolution is not accepted when acknowledging an incident");
    const data = await incidents.acknowledge(authenticated(request), incidentId, input.version, input.assignee, idempotencyKey, request.requestId);
    response.json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/incidents/:incidentId/resolve", requirePermission("incident:write"), async (request, response) => {
    const incidentId = uuidSchema.parse(request.params.incidentId);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = incidentTransitionSchema.parse(request.body);
    if (!input.resolution) throw invalid("VALIDATION_FAILED", "Resolution is required when resolving an incident");
    const data = await incidents.resolve(authenticated(request), incidentId, input.version, input.resolution, idempotencyKey, request.requestId);
    response.json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/reports/operations", requirePermission("report:read"), async (request, response) => {
    const input = operationsReportQuerySchema.parse({ start: request.query.start, end: request.query.end });
    const data = await reports.generate(authenticated(request), new Date(input.start), new Date(input.end), request.requestId);
    response.json({ data, requestId: request.requestId });
  });

  app.get("/api/v1/audit-events", requirePermission("audit:read"), async (request, response) => {
    const limit = listLimitSchema.parse(request.query.limit);
    const data = await auditQuery.list(authenticated(request), limit);
    response.json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/platform/customers", requirePermission("platform:admin"), async (request, response) => {
    const input = createCustomerSchema.parse(request.body);
    const data = await customers.create(authenticated(request), input.name, request.requestId);
    response.status(201).json({ data, requestId: request.requestId });
  });

  app.post("/api/v1/sessions/current/revoke", async (request, response) => {
    await sessions.revokeCurrent(authenticated(request), request.requestId);
    response.status(204).send();
  });

  app.use((_request, _response, next) => next(new AppError(404, "ROUTE_NOT_FOUND", "The requested route does not exist")));

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const appError = error instanceof AppError
      ? error
      : error instanceof ZodError
        ? new AppError(400, "VALIDATION_FAILED", "The request is invalid", {
            fields: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
          })
        : error && typeof error === "object" && "code" in error && error.code === "23505"
          ? new AppError(409, "RESOURCE_CONFLICT", "A resource with the same unique values already exists")
          : new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
    if (appError.statusCode >= 500) {
      request.log.error({ errorCode: safeInternalErrorCode(error), requestId: request.requestId }, "request failed");
    }
    response.status(appError.statusCode).json({
      error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
      requestId: request.requestId,
    });
  };
  app.use(errorHandler);
  return app;
}

function safeInternalErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "UNEXPECTED";
  return /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "UNEXPECTED";
}

function requireIdempotencyKey(request: Request): string {
  const value = request.header("idempotency-key");
  if (!value || !uuidSchema.safeParse(value).success) throw invalid("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key UUID header is required");
  return value;
}

export function configureServerSecurity(server: Server): void {
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
}
