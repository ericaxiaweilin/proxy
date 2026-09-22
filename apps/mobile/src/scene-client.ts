import type { CommandResult, Memory, RecordOutcomePayload } from "@proxy/contracts";
import type { AuthenticatedCommandTransport } from "./demand-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

// ── R15.13 P2: Memory envelope shape returned by api-go ────────────
// The server wraps each list/get response in a JSON object inside
// command.Result.OperationRef. Pin the wire shape so the parser is
// independent of command type and the OperationRef is the only
// source of truth for memory rows.

interface ListMyMemoriesRef {
  actorId: string;
  limit: number;
  memories: Memory[];
}

interface GetMemoryRef {
  memoryId: string;
  sceneId: string;
  hostId: string;
  guestId: string;
  sceneType?: string;
  fundingMode: string;
  plannedBudget: number;
  actualSpend: number;
  currency: string;
  durationMin: number;
  rating: number;
  notes?: string;
  createdAt: string;
}

export type MyScene = { sceneId: string; title: string; tool: string; status: string; startsAt: string };
export type MySceneInvitation = {
  invitationId: string;
  sceneId: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "ASK";
  card: { what?: string; where?: string; when?: string; who?: string; hostLabel?: string };
  fundingMode?: string;
  plannedBudget?: number;
  currency?: string;
  sceneType?: string;
  orderRef?: string;
};

export class SceneClient {
  private seq=0;
  constructor(private readonly input: { authClient: AuthenticatedCommandTransport; secureSessionStore: SecureSessionStore; now?: ()=>Date } ){}
  private async requireSession(){ const s=await this.input.secureSessionStore.read(); if(!s?.principal) throw new Error("principal required"); if(s.serverSession === false) throw new Error("scene actions require a real sign-in (offline session cannot act)"); if(s.signedOut === true) throw new OfflineFallbackSessionError(); return s as StoredSession & {principal: NonNullable<StoredSession["principal"]>} }
  private nextId(p:string){
    // Per-bucket counters: commandId / idempotencyKey / correlationId must
    // never collide even when they all sit in the same millisecond.
    // A previous version used a single `seq` shared across all three, which
    // is fine in practice (different `p` prefix already disambiguates) but
    // splits here so the format is unambiguous and easy to assert in tests.
    return `mobile_scene_${p}_${Date.now().toString(36)}_${(++this.seq).toString(36)}`
  }
  private async send(session: StoredSession & {principal: NonNullable<StoredSession["principal"]>}, type:string, target:{type:string;id:string}, payload:Record<string,unknown>, ver?:number){
    const envelope={ commandId:this.nextId("cmd"), commandType:type, commandVersion:1, actor:{type:"USER",id:session.userAccountId}, principal:session.principal, target, idempotencyKey:this.nextId("idem"), ...(ver!==undefined?{expectedAggregateVersion:ver}:{}), authContext:{sessionId:session.auth.sessionId}, purpose:"scene_value_exchange", correlationId:this.nextId("corr"), requestedAt:(this.input.now?.()??new Date()).toISOString(), payload };
    const res=await this.input.authClient.request(`/v1/commands/${type}`,{method:"POST", body:envelope});
    const result=parseCommandResult(await res.json()); if(!result) throw new Error("malformed"); if(result.outcome==="REJECTED") throw Object.assign(new Error(commandErrorMessage(result.error,"rejected")),{result}); return result;
  }

  /**
   * Build a fresh envelope without sending it. Exported for tests so the
   * envelope shape (actor / principal / target / idempotency key format)
   * can be pinned without spinning up a transport. The triple of
   * (commandId, idempotencyKey, correlationId) is produced by three
   * independent counter increments so two envelopes built in the same
   * millisecond never collide on any of the three ids.
   */
  buildEnvelope(input: {
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> };
    commandType: string;
    target: { type: string; id: string };
    payload: Record<string, unknown>;
    expectedAggregateVersion?: number;
    now: () => Date;
  }): Record<string, unknown> {
    const envelope: Record<string, unknown> = {
      commandId: this.nextId("cmd"),
      commandType: input.commandType,
      commandVersion: 1,
      actor: { type: "USER", id: input.session.userAccountId },
      principal: input.session.principal,
      target: input.target,
      idempotencyKey: this.nextId("idem"),
      authContext: { sessionId: input.session.auth.sessionId },
      purpose: "scene_value_exchange",
      correlationId: this.nextId("corr"),
      requestedAt: input.now().toISOString(),
      payload: input.payload,
    };
    if (input.expectedAggregateVersion !== undefined) {
      envelope.expectedAggregateVersion = input.expectedAggregateVersion;
    }
    return envelope;
  }
  async createScene(tool:string, intent:string, participation:string, cost:string, startsAt:string){
    const s=await this.requireSession();
    return this.send(s,"CreateScene",{type:"Scene",id:"new"},{tool,intent,participation,cost,startsAt});
  }
  async createInvitation(sceneId:string, inviteeUserId:string, card:Record<string,unknown>){
    const s=await this.requireSession();
    return this.send(s,"CreateInvitation",{type:"Scene",id:sceneId},{sceneId,inviteeUserId,card});
  }
  async respondInvitation(invitationId:string, decision:"ACCEPTED"|"DECLINED"|"ASK"){
    const s=await this.requireSession();
    return this.send(s,"RespondInvitation",{type:"Invitation",id:invitationId},{decision});
  }
  async listMyScenes(limit = 20): Promise<MyScene[]> {
    const s = await this.requireSession();
    const result = await this.send(s, "ListMyScenes", { type: "Scene", id: "mine" }, { limit });
    if (!result.operationRef) return [];
    const ref = JSON.parse(result.operationRef) as { scenes?: MyScene[] };
    return Array.isArray(ref.scenes) ? ref.scenes : [];
  }
  async listMyInvitations(limit = 20): Promise<MySceneInvitation[]> {
    const s = await this.requireSession();
    const result = await this.send(s, "ListMyInvitations", { type: "Invitation", id: "mine" }, { limit });
    if (!result.operationRef) return [];
    const ref = JSON.parse(result.operationRef) as { invitations?: MySceneInvitation[] };
    return Array.isArray(ref.invitations) ? ref.invitations : [];
  }

  // BADGE-WALL-001: 已获得的徽章 id + 去过的所有场景 id。失败必须抛 ——
  // 调用方要分清“失败”和“空”（空墙和拉失败长得不一样），吞成 [] 就是撒谎。
  async listMyBadges(): Promise<string[]> {
    const s = await this.requireSession();
    const result = await this.send(s, "ListMyBadges", { type: "Scene", id: "mine" }, {});
    if (!result.operationRef) throw new Error("badges response malformed");
    const ref = JSON.parse(result.operationRef) as { badges?: Array<{ badgeId?: string }> };
    if (!Array.isArray(ref.badges)) throw new Error("badges response malformed");
    return ref.badges.map((b) => b.badgeId).filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  async listMyCheckinHistory(): Promise<string[]> {
    const s = await this.requireSession();
    const result = await this.send(s, "ListMyCheckinHistory", { type: "Scene", id: "mine" }, {});
    if (!result.operationRef) throw new Error("checkin history response malformed");
    const ref = JSON.parse(result.operationRef) as { sceneIds?: string[] };
    if (!Array.isArray(ref.sceneIds)) throw new Error("checkin history response malformed");
    return ref.sceneIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  // ── R15.13 P2: Memory domain (post-outcome audit trail) ──────────

  /**
   * List the memories in which the current session's user is either
   * the host or the guest. limit defaults to 10, max 50 (the server
   * also clamps to 50 so a client override is silently respected).
   */
  async listMyMemories(limit?: number): Promise<Memory[]> {
    const s = await this.requireSession();
    const result = await this.send(
      s,
      "ListMyMemories",
      { type: "MyMemories", id: "unused" },
      limit ? { limit } : {},
    );
    return this.parseMemoryList(result);
  }

  /**
   * Fetch a single memory by scene id. The host or guest who
   * participated in the scene is allowed to read; anyone else gets
   * MEMORY_NOT_VISIBLE from the server, which surfaces here as a
   * thrown result with outcome=REJECTED.
   */
  async getMemory(sceneId: string): Promise<Memory> {
    const s = await this.requireSession();
    const result = await this.send(
      s,
      "GetMemory",
      { type: "Memory", id: sceneId },
      {},
    );
    return this.parseMemorySingle(result, s.userAccountId);
  }

  /**
   * Record the outcome of a Scene after both sides have actually
   * shown up. Only the host may record (the server enforces this).
   * On success, returns the persisted Memory (with the derived
   * rating blended from aesthetic score + budget adherence).
   */
  async recordOutcome(sceneId: string, payload: RecordOutcomePayload): Promise<Memory> {
    const s = await this.requireSession();
    const result = await this.send(
      s,
      "RecordOutcome",
      { type: "Outcome", id: sceneId },
      { ...payload },
    );
    return this.parseMemorySingle(result, s.userAccountId);
  }

  // ── internal: OperationRef parsers ────────────────────────────────

  private parseMemoryList(result: CommandResult): Memory[] {
    if (!result.operationRef) return [];
    let ref: ListMyMemoriesRef;
    try { ref = JSON.parse(result.operationRef) as ListMyMemoriesRef; }
    catch { throw new Error("malformed memory list response"); }
    return Array.isArray(ref.memories) ? ref.memories : [];
  }

  private parseMemorySingle(result: CommandResult, viewerUserId: string): Memory {
    if (!result.operationRef) throw new Error("malformed memory response");
    let ref: GetMemoryRef;
    try { ref = JSON.parse(result.operationRef) as GetMemoryRef; }
    catch { throw new Error("malformed memory response"); }
    const role: "HOST" | "GUEST" =
      ref.hostId === viewerUserId ? "HOST" :
      ref.guestId === viewerUserId ? "GUEST" : "GUEST";
    return {
      memoryId: ref.memoryId,
      sceneId: ref.sceneId,
      sceneType: ref.sceneType,
      actualSpend: ref.actualSpend,
      plannedBudget: ref.plannedBudget,
      currency: ref.currency,
      durationMin: ref.durationMin,
      rating: ref.rating,
      notes: ref.notes,
      createdAt: ref.createdAt,
      role,
    };
  }
}
