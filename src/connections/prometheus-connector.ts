import { request as httpsRequest, type RequestOptions } from "node:https";
import type { FileSecretProvider } from "../secrets/file-secret-provider.js";
import type { EgressPolicy } from "../security/egress-policy.js";
import type { ConnectionCheck, ConnectionRecord, Connector } from "./types.js";

export interface MetricSeries {
  readonly labels: Readonly<Record<string, string>>;
  readonly values: readonly { readonly timestamp: number; readonly value: string }[];
}

interface PreparedRequest {
  readonly baseUrl: URL;
  readonly options: RequestOptions;
}

export class PrometheusConnector implements Connector {
  readonly kind = "prometheus" as const;

  constructor(private readonly secrets: FileSecretProvider, private readonly egress: EgressPolicy, private readonly timeoutMs: number) {}

  async validate(connection: ConnectionRecord): Promise<ConnectionCheck> {
    const startedAt = performance.now();
    const checkedAt = new Date();
    const prepared = await this.prepare(connection);
    const healthPath = (connection.configuration as { healthPath: string }).healthPath;
    const response = await this.request(prepared, healthPath, 65_536);
    const healthy = response.statusCode === 200;
    return {
      healthy, checkedAt, latencyMs: Math.round(performance.now() - startedAt), metadata: { endpoint: prepared.baseUrl.origin },
      ...(!healthy ? { errorCode: "CONNECTION_CHECK_FAILED" } : {}),
    };
  }

  async queryRange(connection: ConnectionRecord, query: string, start: Date, end: Date, stepSeconds: number): Promise<readonly MetricSeries[]> {
    const prepared = await this.prepare(connection);
    const parameters = new URLSearchParams({ query, start: String(start.getTime() / 1000), end: String(end.getTime() / 1000), step: String(stepSeconds) });
    const response = await this.request(prepared, `/api/v1/query_range?${parameters.toString()}`, 1_048_576);
    if (response.statusCode !== 200) throw new Error("Prometheus query failed");
    let payload: unknown;
    try { payload = JSON.parse(response.body); }
    catch { throw new Error("Prometheus returned malformed JSON"); }
    return normalizePrometheusMatrix(payload);
  }

  private async prepare(connection: ConnectionRecord): Promise<PreparedRequest> {
    if (connection.kind !== "prometheus" || !("baseUrl" in connection.configuration)) throw new Error("Prometheus connector received an incompatible connection record");
    const baseUrl = new URL(connection.configuration.baseUrl);
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("Stored Prometheus URL violates connector security policy");
    if (!/^\/[A-Za-z0-9/_-]{1,128}$/.test(connection.configuration.healthPath)) throw new Error("Stored Prometheus health path violates connector security policy");
    const address = await this.egress.resolveAllowed(baseUrl.hostname);
    const secret = await this.secrets.getHttpSecret(connection.secretRef);
    const authorization = secret.bearerToken ? `Bearer ${secret.bearerToken}` : secret.username && secret.password ? `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}` : undefined;
    return {
      baseUrl,
      options: {
        protocol: "https:", hostname: address, port: baseUrl.port ? Number(baseUrl.port) : 443, method: "GET",
        servername: baseUrl.hostname, rejectUnauthorized: true, ...(secret.ca ? { ca: secret.ca } : {}),
        headers: { host: baseUrl.host, accept: "application/json, text/plain", "accept-encoding": "identity", ...(authorization ? { authorization } : {}) },
      },
    };
  }

  private request(prepared: PreparedRequest, path: string, maxBytes: number): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest({ ...prepared.options, path }, (response) => {
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          response.destroy(new Error("Compressed upstream responses are not accepted"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) response.destroy(new Error("Response exceeded limit"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      });
      request.setTimeout(this.timeoutMs, () => request.destroy(new Error("Connection timed out")));
      request.on("error", reject);
      request.end();
    });
  }
}

export function normalizePrometheusMatrix(payload: unknown): readonly MetricSeries[] {
  if (!payload || typeof payload !== "object") throw new Error("Prometheus response shape is invalid");
  const root = payload as Record<string, unknown>;
  if (root.status !== "success" || !root.data || typeof root.data !== "object") throw new Error("Prometheus query was not successful");
  const data = root.data as Record<string, unknown>;
  if (data.resultType !== "matrix" || !Array.isArray(data.result) || data.result.length > 100) throw new Error("Prometheus result exceeds the series limit or has the wrong type");
  let samples = 0;
  return data.result.map((item): MetricSeries => {
    if (!item || typeof item !== "object") throw new Error("Prometheus series is invalid");
    const series = item as Record<string, unknown>;
    if (!series.metric || typeof series.metric !== "object" || Array.isArray(series.metric) || !Array.isArray(series.values)) throw new Error("Prometheus series is invalid");
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(series.metric as Record<string, unknown>)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.length > 500) throw new Error("Prometheus label is invalid");
      labels[key] = value;
    }
    const values = series.values.map((sample) => {
      samples += 1;
      if (samples > 5_000 || !Array.isArray(sample) || sample.length !== 2 || typeof sample[0] !== "number" || !Number.isFinite(sample[0]) || typeof sample[1] !== "string" || sample[1].length > 64) throw new Error("Prometheus samples exceed limits or are invalid");
      return { timestamp: sample[0], value: sample[1] };
    });
    return { labels, values };
  });
}
