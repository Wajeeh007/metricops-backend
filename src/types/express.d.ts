import type { Principal } from "../domain/principal.js";

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId: string;
    }
  }
}

export {};
