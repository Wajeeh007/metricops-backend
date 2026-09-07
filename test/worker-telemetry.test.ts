import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import request from "supertest";
import { startWorkerTelemetryServer, WorkerTelemetry } from "../src/observability/worker-telemetry.js";

test("worker telemetry is authenticated, bounded, and free of tenant labels", async () => {
  const pool = { totalCount: 2, idleCount: 1, waitingCount: 0 } as never;
  const telemetry = new WorkerTelemetry(pool, "01234567890123456789012345678901");
  telemetry.loop();
  telemetry.jobClaimed("aws.discover");
  telemetry.startJob("aws.discover")("failed");
  telemetry.claimFailed();
  const server = startWorkerTelemetryServer("127.0.0.1", 0, telemetry);
  await once(server, "listening");
  try {
    const live = await request(server).get("/health/live");
    assert.equal(live.status, 200);
    const denied = await request(server).get("/internal/metrics");
    assert.equal(denied.status, 401);
    const metrics = await request(server).get("/internal/metrics").set("authorization", "Bearer 01234567890123456789012345678901");
    assert.equal(metrics.status, 200);
    assert.match(metrics.text, /metricops_worker_jobs_claimed_total\{kind="aws.discover"\} 1/);
    assert.match(metrics.text, /metricops_worker_jobs_completed_total\{kind="aws.discover",outcome="failed"\} 1/);
    assert.match(metrics.text, /metricops_worker_claim_failures_total 1/);
    assert.equal(metrics.text.includes("11111111-1111-4111-8111-111111111111"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
