import { forbidden } from "../domain/errors.js";
import { hasPermission, type Permission, type Principal } from "../domain/principal.js";

export function authorize(principal: Principal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw forbidden();
  }
}
