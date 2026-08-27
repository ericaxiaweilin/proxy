import type { CommandResult } from "@proxy/contracts";
import type { AuthenticatedCommandTransport } from "./demand-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export class SceneClient {
  private seq=0;
  constructor(private readonly input: { authClient: AuthenticatedCommandTransport; secureSessionStore: SecureSessionStore; now?: ()=>Date } ){}
  private async requireSession(){ const s=await this.input.secureSessionStore.read(); if(!s?.principal) throw new Error("principal required"); return s as StoredSession & {principal: NonNullable<StoredSession["principal"]>} }
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
    const result=parseCommandResult(await res.json()); if(!result) throw new Error("malformed"); if(result.outcome==="REJECTED") throw Object.assign(new Error(result.error?.messageKey||"rejected"),{result}); return result;
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
}
