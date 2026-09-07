import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type pg from "pg";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import type { JobRecord } from "../jobs/job-service.js";

type JobKind = JobRecord["kind"];

export class WorkerTelemetry {
  private readonly registry = new Registry();
  private readonly claimed = new Counter({ name: "metricops_worker_jobs_claimed_total", help: "Jobs claimed by kind", labelNames: ["kind"], registers: [this.registry] });
  private readonly completed = new Counter({ name: "metricops_worker_jobs_completed_total", help: "Job attempts completed by kind and outcome", labelNames: ["kind", "outcome"], registers: [this.registry] });
  private readonly duration = new Histogram({ name: "metricops_worker_job_duration_seconds", help: "Job attempt duration", labelNames: ["kind", "outcome"], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300], registers: [this.registry] });
  private readonly claimFailures = new Counter({ name: "metricops_worker_claim_failures_total", help: "Failed database job-claim operations", registers: [this.registry] });
  private readonly heartbeat = new Gauge({ name: "metricops_worker_last_loop_unixtime", help: "Unix time of the latest worker loop", registers: [this.registry] });
  private readonly tokenDigest: Buffer;

  constructor(pool: pg.Pool, token: string) {
    this.tokenDigest = createHash("sha256").update(token).digest();
    collectDefaultMetrics({ register: this.registry, prefix: "metricops_worker_node_" });
    new Gauge({ name: "metricops_worker_database_pool_connections", help: "Worker database pool connections by state", labelNames: ["state"], registers: [this.registry], collect: function () {
      this.set({ state: "total" }, pool.totalCount);
      this.set({ state: "idle" }, pool.idleCount);
      this.set({ state: "waiting" }, pool.waitingCount);
    } });
  }

  loop(): void { this.heartbeat.set(Date.now() / 1000); }
  claimFailed(): void { this.claimFailures.inc(); }
  jobClaimed(kind: JobKind): void { this.claimed.inc({ kind }); }
  startJob(kind: JobKind): (outcome: "succeeded" | "failed") => void {
    const started = process.hrtime.bigint();
    return (outcome) => {
      this.completed.inc({ kind, outcome });
      this.duration.observe({ kind, outcome }, Number(process.hrtime.bigint() - started) / 1_000_000_000);
    };
  }

  authenticate(header: string | undefined): boolean {
    const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(header ?? "");
    if (!match?.[1]) return false;
    return timingSafeEqual(createHash("sha256").update(match[1]).digest(), this.tokenDigest);
  }

  async render(): Promise<{ readonly contentType: string; readonly body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}

export function startWorkerTelemetryServer(host: string, port: number, telemetry: WorkerTelemetry): Server {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health/live") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end('{"status":"ok"}');
        return;
      }
      if (request.method === "GET" && request.url === "/internal/metrics") {
        if (!telemetry.authenticate(request.headers.authorization)) {
          response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end('{"error":"authentication required"}');
          return;
        }
        const metrics = await telemetry.render();
        response.writeHead(200, { "content-type": metrics.contentType, "cache-control": "no-store" }).end(metrics.body);
        return;
      }
      response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end('{"error":"not found"}');
    } catch {
      response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" }).end('{"error":"internal error"}');
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 3_000;
  server.maxHeadersCount = 30;
  server.listen(port, host);
  return server;
}
