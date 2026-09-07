import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config.js";
import { unauthorized } from "../domain/errors.js";
import type { Permission, Principal } from "../domain/principal.js";

const knownPermissions = new Set<Permission>([
  "connection:read",
  "connection:write",
  "connection:validate",
  "job:read",
  "resource:read",
  "resource:write",
  "resource:discover",
  "metrics:read",
  "alert:read",
  "incident:read",
  "incident:write",
  "report:read",
  "audit:read",
  "platform:admin",
]);

export interface Authenticator {
  authenticate(header: string | undefined): Promise<Principal>;
}

export class OidcAuthenticator implements Authenticator {
  private readonly jwks;

  constructor(private readonly config: AppConfig["oidc"]) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri), {
      cooldownDuration: 30_000,
      timeoutDuration: 3_000,
    });
  }

  async authenticate(header: string | undefined): Promise<Principal> {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header ?? "");
    if (!match?.[1]) throw unauthorized();
    try {
      const { payload } = await jwtVerify(match[1], this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ["RS256", "ES256", "PS256"],
        clockTolerance: 5,
        maxTokenAge: this.config.maxTokenAgeSeconds,
        requiredClaims: ["sub", "exp", "iat", "jti", "customer_id"],
      });
      return claimsToPrincipal(payload);
    } catch {
      throw unauthorized();
    }
  }
}

export function claimsToPrincipal(payload: JWTPayload): Principal {
  const customerId = payload.customer_id;
  const rawPermissions = payload.permissions;
  if (typeof payload.sub !== "string" || payload.sub.length > 200 || typeof payload.jti !== "string" || payload.jti.length > 512 || typeof payload.exp !== "number") {
    throw unauthorized();
  }
  if (typeof customerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerId) || !Array.isArray(rawPermissions) || rawPermissions.length > 100) throw unauthorized();
  const permissions = new Set<Permission>();
  for (const value of rawPermissions) {
    if (typeof value === "string" && knownPermissions.has(value as Permission)) permissions.add(value as Permission);
  }
  if (permissions.has("platform:admin") && permissions.size > 1) throw unauthorized();
  return {
    subject: payload.sub,
    customerId,
    permissions,
    tokenId: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
  };
}
