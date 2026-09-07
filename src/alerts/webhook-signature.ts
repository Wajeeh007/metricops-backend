import { createHmac, timingSafeEqual } from "node:crypto";
import { unauthorized } from "../domain/errors.js";

export interface WebhookEnvelope { readonly timestamp: number; readonly nonce: string; readonly signature: string }

export function parseWebhookEnvelope(headers: Readonly<Record<string, string | undefined>>, now = Date.now()): WebhookEnvelope {
  const timestampText = headers["x-metricops-timestamp"];
  const nonce = headers["x-metricops-nonce"];
  const signature = headers["x-metricops-signature"];
  const timestamp = Number(timestampText);
  if (!timestampText || !Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) throw unauthorized();
  if (!nonce || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) throw unauthorized();
  if (!signature || !/^v1=[0-9a-f]{64}$/i.test(signature)) throw unauthorized();
  return { timestamp, nonce, signature: signature.slice(3).toLowerCase() };
}

export function verifyWebhookSignature(envelope: WebhookEnvelope, body: Buffer, key: string): void {
  const expected = createHmac("sha256", key).update(`${envelope.timestamp}.${envelope.nonce}.`).update(body).digest();
  const supplied = Buffer.from(envelope.signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw unauthorized();
}
