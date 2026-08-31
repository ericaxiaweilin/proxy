import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<{ status: number; json: () => Promise<unknown> }>;
};

export type DisplayIdentity = {
  id: string;
  ownerId: string;
  type: "PUBLIC" | "PRIVATE" | "BURNER";
  alias: string;
  displayName: string;
  avatarRef?: string;
  createdAt: string;
  expiresAt?: string | null;
  burnedAt?: string | null;
  version: number;
};

export class DisplayIdentityClient {
  private seq = 0;
  constructor(private readonly opts: { authClient: AuthenticatedCommandTransport; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  async create(params: { type: DisplayIdentity["type"]; alias: string; displayName: string; avatarRef?: string }): Promise<DisplayIdentity> {
    const session = await this.requireSession();
    const res = await this.send(session, "CreateDisplayIdentity", { type: "DisplayIdentity", id: "new" }, params);
    return this.parseIdentity(res);
  }

  async list(): Promise<DisplayIdentity[]> {
    const session = await this.requireSession();
    const res = await this.send(session, "ListDisplayIdentities", { type: "DisplayIdentity", id: session.userAccountId }, {});
    const op = this.parseOp(res);
    const arr = (op.identities ?? op.available ?? []) as unknown[];
    return arr as DisplayIdentity[];
  }

  async burn(identityId: string): Promise<DisplayIdentity> {
    const session = await this.requireSession();
    const res = await this.send(session, "BurnDisplayIdentity", { type: "DisplayIdentity", id: identityId }, { identityId });
    return this.parseIdentity(res);
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const s = await this.opts.secureSessionStore.read();
    if (!s?.principal) throw new Error("authenticated principal required");
    return s as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private parseOp(res: Record<string, unknown>): Record<string, unknown> {
    const ref = res.operationRef as string | undefined;
    if (!ref) return res;
    try { return JSON.parse(ref) as Record<string, unknown>; } catch { return res; }
  }

  private parseIdentity(res: Record<string, unknown>): DisplayIdentity {
    const op = this.parseOp(res);
    return (op.identity ?? op.active ?? op) as DisplayIdentity;
  }

  private async send(session: StoredSession & { principal: NonNullable<StoredSession["principal"]> }, commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>) {
    const cid = `did_${Date.now().toString(36)}_${++this.seq}`;
    const env = {
      commandId: cid,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: `idemp_${cid}`,
      authContext: { sessionId: session.auth.sessionId },
      purpose: "display_identity",
      correlationId: `corr_${cid}`,
      requestedAt: (this.opts.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const r = await this.opts.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: env });
    const j = await r.json() as Record<string, unknown>;
    if (!j || j.outcome === "REJECTED") throw new Error(`displayIdentity ${commandType} rejected: ${JSON.stringify((j as { error?: unknown })?.error)}`);
    return j;
  }
}
