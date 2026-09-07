import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { appendFile, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { constants } from "node:fs";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("MOPSBAK1", "ascii");
const headerBytes = magic.length + 16 + 12;
const tagBytes = 16;

export async function readBackupKey(path: string): Promise<string> {
  if (!path.startsWith("/")) throw new Error("Backup key path must be absolute");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("Backup key must be a mode 0600 regular file");
    const value = (await handle.readFile("utf8")).trim();
    if (value.length < 32) throw new Error("Backup key must contain at least 32 characters");
    return value;
  } finally { await handle.close(); }
}

export async function encryptFile(input: string, output: string, passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(output, Buffer.concat([magic, salt, iv]), { mode: 0o600, flag: "wx" });
  try {
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
    await appendFile(output, cipher.getAuthTag());
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw error;
  } finally { key.fill(0); }
}

export async function decryptFile(input: string, output: string, passphrase: string): Promise<void> {
  const metadata = await stat(input);
  if (!metadata.isFile() || metadata.size <= headerBytes + tagBytes) throw new Error("Encrypted backup is invalid");
  const handle = await open(input, "r");
  const header = Buffer.alloc(headerBytes);
  const tag = Buffer.alloc(tagBytes);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, metadata.size - tagBytes);
  } finally { await handle.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error("Encrypted backup format is invalid");
  const salt = header.subarray(magic.length, magic.length + 16);
  const iv = header.subarray(magic.length + 16);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(input, { start: headerBytes, end: metadata.size - tagBytes - 1 }),
      decipher,
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw error;
  } finally { key.fill(0); }
}

export async function atomicRename(source: string, destination: string): Promise<void> {
  await rename(source, destination);
}

export async function assertManifestHash(backupPath: string, manifestPath: string): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.sha256 !== await fileSha256(backupPath)) throw new Error("Backup manifest hash does not match the encrypted artifact");
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
