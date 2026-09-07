import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertManifestHash, decryptFile, encryptFile, fileSha256, readBackupKey } from "../src/operations/backup-crypto.js";

test("encrypted backups round-trip and reject authenticated-data tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-backup-crypto-"));
  const input = join(directory, "input.dump");
  const encrypted = join(directory, "backup.dump.enc");
  const decrypted = join(directory, "restored.dump");
  const tampered = join(directory, "tampered.dump.enc");
  await writeFile(input, Buffer.from("representative PostgreSQL custom dump bytes"), { mode: 0o600 });
  await encryptFile(input, encrypted, "01234567890123456789012345678901");
  await decryptFile(encrypted, decrypted, "01234567890123456789012345678901");
  assert.deepEqual(await readFile(decrypted), await readFile(input));
  const bytes = await readFile(encrypted);
  bytes[40] = bytes[40]! ^ 1;
  await writeFile(tampered, bytes, { mode: 0o600 });
  await assert.rejects(() => decryptFile(tampered, join(directory, "must-not-exist.dump"), "01234567890123456789012345678901"));
});

test("backup keys and manifests are permission- and integrity-checked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-backup-manifest-"));
  const key = join(directory, "key");
  const backup = join(directory, "backup.dump.enc");
  const manifest = join(directory, "manifest.json");
  await writeFile(key, "01234567890123456789012345678901\n", { mode: 0o600 });
  await writeFile(backup, "ciphertext", { mode: 0o600 });
  await writeFile(manifest, JSON.stringify({ sha256: await fileSha256(backup) }), { mode: 0o600 });
  assert.equal((await readBackupKey(key)).length, 32);
  await assertManifestHash(backup, manifest);
  await chmod(key, 0o644);
  await assert.rejects(() => readBackupKey(key), /0600/);
  await writeFile(backup, "changed", { mode: 0o600 });
  await assert.rejects(() => assertManifestHash(backup, manifest), /does not match/);
});
