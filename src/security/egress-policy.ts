import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { invalid } from "../domain/errors.js";

interface Ipv4Network {
  readonly network: number;
  readonly mask: number;
}

function ipv4ToNumber(address: string): number {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return (((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!) >>> 0;
}

function parseCidr(value: string): Ipv4Network {
  const [address, prefixText] = value.split("/");
  const prefix = Number(prefixText);
  if (!address || isIP(address) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 CIDR in CONNECTION_ALLOWED_CIDRS: ${value}`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: ipv4ToNumber(address) & mask, mask };
}

export class EgressPolicy {
  private readonly networks: readonly Ipv4Network[];
  private readonly hosts: ReadonlySet<string>;

  constructor(cidrs: readonly string[], hosts: readonly string[]) {
    this.networks = cidrs.map(parseCidr);
    this.hosts = new Set(hosts.map((host) => host.toLowerCase()));
  }

  async resolveAllowed(host: string): Promise<string> {
    const normalized = host.trim().toLowerCase().replace(/\.$/, "");
    if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
      throw invalid("CONNECTION_TARGET_DENIED", "The connection target is not permitted by egress policy");
    }
    let addresses: readonly { address: string; family: number }[];
    try {
      addresses = isIP(normalized)
        ? [{ address: normalized, family: isIP(normalized) }]
        : await lookup(normalized, { all: true, verbatim: true });
    } catch {
      throw invalid("CONNECTION_DNS_FAILED", "The connection target could not be resolved");
    }
    if (addresses.length === 0) throw invalid("CONNECTION_DNS_FAILED", "The connection target could not be resolved");
    if (this.hosts.has(normalized)) return addresses[0]!.address;
    const allowed = addresses.filter(({ address, family }) => family === 4 && this.isAllowedIpv4(address));
    if (allowed.length !== addresses.length) {
      throw invalid("CONNECTION_TARGET_DENIED", "The connection target is not permitted by egress policy");
    }
    return allowed[0]!.address;
  }

  private isAllowedIpv4(address: string): boolean {
    const candidate = ipv4ToNumber(address);
    return this.networks.some(({ network, mask }) => (candidate & mask) === network);
  }
}
