export type Permission =
  | "connection:read"
  | "connection:write"
  | "connection:validate"
  | "job:read"
  | "resource:read"
  | "resource:write"
  | "resource:discover"
  | "metrics:read"
  | "alert:read"
  | "incident:read"
  | "incident:write"
  | "report:read"
  | "audit:read"
  | "platform:admin";

export interface Principal {
  readonly subject: string;
  readonly customerId: string;
  readonly permissions: ReadonlySet<Permission>;
  readonly tokenId: string;
  readonly expiresAt: Date;
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.permissions.has(permission);
}
