import { invalid } from "../domain/errors.js";
import type { ConnectionKind, Connector } from "./types.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<ConnectionKind, Connector>();

  register(connector: Connector): void {
    if (this.connectors.has(connector.kind)) throw new Error(`Connector already registered: ${connector.kind}`);
    this.connectors.set(connector.kind, connector);
  }

  get(kind: ConnectionKind): Connector {
    const connector = this.connectors.get(kind);
    if (!connector) throw invalid("UNSUPPORTED_CONNECTION_KIND", "The requested connection type is not supported");
    return connector;
  }

  supportedKinds(): readonly ConnectionKind[] {
    return [...this.connectors.keys()];
  }
}
