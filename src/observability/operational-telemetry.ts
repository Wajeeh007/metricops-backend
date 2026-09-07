import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type pg from "pg";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import { unauthorized } from "../domain/errors.js";

export class OperationalTelemetry {
  private readonly registry = new Registry();
  private readonly requests = new Counter({ name: "metricops_http_requests_total", help: "Completed HTTP requests", labelNames: ["method", "route", "status_class"], registers: [this.registry] });
  private readonly duration = new Histogram({ name: "metricops_http_request_duration_seconds", help: "HTTP request duration", labelNames: ["method", "route", "status_class"], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [this.registry] });
  private readonly readiness = new Gauge({ name: "metricops_ready", help: "Whether required API dependencies passed the latest readiness check", registers: [this.registry] });
  private readonly dependencyFailures = new Counter({ name: "metricops_dependency_failures_total", help: "Failed dependency checks", labelNames: ["dependency"], registers: [this.registry] });
  private readonly tokenDigest: Buffer | null;

  constructor(private readonly pool: pg.Pool, token: string | null) {
    this.tokenDigest = token ? createHash("sha256").update(token).digest() : null;
    collectDefaultMetrics({ register: this.registry, prefix: "metricops_node_" });
    const databasePool = this.pool;
    new Gauge({ name: "metricops_database_pool_connections", help: "Database pool connections by state", labelNames: ["state"], registers: [this.registry], collect: function () {
      this.set({ state: "total" }, databasePool.totalCount);
      this.set({ state: "idle" }, databasePool.idleCount);
      this.set({ state: "waiting" }, databasePool.waitingCount);
    } });
    this.readiness.set(0);
  }

  observe(request: Request, response: Response): void {
    const started = process.hrtime.bigint();
    response.once("finish", () => {
      const labels = { method: safeMethod(request.method), route: routeTemplate(request), status_class: `${Math.floor(response.statusCode / 100)}xx` };
      this.requests.inc(labels);
      this.duration.observe(labels, Number(process.hrtime.bigint() - started) / 1_000_000_000);
    });
  }

  markReady(): void { this.readiness.set(1); }
  markDependencyFailure(dependency: "postgresql"): void { this.readiness.set(0); this.dependencyFailures.inc({ dependency }); }

  authenticate(header: string | undefined): void {
    if (!this.tokenDigest) throw unauthorized();
    const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(header ?? "");
    if (!match?.[1]) throw unauthorized();
    const supplied = createHash("sha256").update(match[1]).digest();
    if (!timingSafeEqual(supplied, this.tokenDigest)) throw unauthorized();
  }

  async render(): Promise<{ readonly contentType: string; readonly body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}

function safeMethod(value: string): string {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(value) ? value : "OTHER";
}

function routeTemplate(request: Request): string {
  const path = request.route && typeof request.route.path === "string" ? request.route.path : "unmatched";
  const base = request.baseUrl || "";
  return `${base}${path}`.slice(0, 200);
}
