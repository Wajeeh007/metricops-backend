import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionRecord, Connector } from "../src/connections/types.js";
import { MysqlConnector } from "../src/connections/mysql-connector.js";

const mysqlRecord: ConnectionRecord = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  customerId: "11111111-1111-4111-8111-111111111111",
  name: "MySQL",
  kind: "mysql",
  configuration: { host: "mysql.internal.example", port: 3306, database: "application", sslMode: "verify_identity" },
  secretRef: "file:mysql",
  status: "pending",
  lastValidatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function assertSanitizedFailure(connector: Connector, record: ConnectionRecord, forbiddenText: string): Promise<void> {
  const result = await connector.validate(record);
  assert.equal(result.healthy, false);
  assert.match(result.errorCode ?? "", /^[A-Z][A-Z0-9_]{2,99}$/);
  assert.deepEqual(result.metadata, {});
  assert.equal(JSON.stringify(result).includes(forbiddenText), false);
  assert.ok(result.latencyMs >= 0);
}

test("connector contract sanitizes upstream failures and closes opened sessions", async () => {
  const forbiddenText = "upstream-password-and-host-details";
  let closed = false;
  const connector = new MysqlConnector(
    { getDatabaseSecret: async () => ({ username: "monitor", password: forbiddenText }) } as never,
    { resolveAllowed: async () => "10.20.30.40" } as never,
    750,
    { connect: async () => ({
      query: async () => { throw new Error(forbiddenText); },
      end: async () => { closed = true; },
    }) },
  );
  await assertSanitizedFailure(connector, mysqlRecord, forbiddenText);
  assert.equal(closed, true);
});

test("connector contract sanitizes connection-establishment failures", async () => {
  const forbiddenText = "private-ca-or-password-must-not-escape";
  const connector = new MysqlConnector(
    { getDatabaseSecret: async () => ({ username: "monitor", password: forbiddenText }) } as never,
    { resolveAllowed: async () => "10.20.30.40" } as never,
    750,
    { connect: async () => { throw new Error(forbiddenText); } },
  );
  await assertSanitizedFailure(connector, mysqlRecord, forbiddenText);
});
