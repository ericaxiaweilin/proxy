// ExperienceManifest client.
//
// Server sends structured configuration only. The client validates the complete
// manifest with the shared Zod contract before exposing it to UI code.
// No remote JS / JSX / route source is accepted.

import {
  ExperienceManifestSchema,
  type CommandResult,
  type ExperienceContext,
  type ExperienceManifest,
  type ExperienceSummary,
  parseListExperiencesPayload
} from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type ExperienceCommandTransport = {
  request(
    path: string,
    init: { method: "POST"; body: unknown }
  ): Promise<TransportResponse>;
  requestPublic?(
    path: string,
    init: { method: "POST"; body: unknown }
  ): Promise<TransportResponse>;
};

export type ExperienceClientOptions = {
  authClient: ExperienceCommandTransport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export class ExperienceProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExperienceProtocolError";
  }
}

export class ExperienceCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "experience command rejected"));
    this.name = "ExperienceCommandRejectedError";
  }
}

export class ExperienceClient {
  private commandSequence = 0;

  public constructor(private readonly input: ExperienceClientOptions) {}

  /**
   * R15.49 — listExperiences 匿名可调（跟 ListMarketOpportunities / ListActivities 同策略）。
   * 返 server 可见体验列表 — home "体验"计数 / future 体验列表 UI 都会调。
   */
  public async listExperiences(): Promise<ExperienceSummary[]> {
    const session = await this.optionalSession();
    const result = await this.sendCommandOptional(
      session,
      "ListExperiences",
      { type: "Experience", id: "list" },
      {}
    );
    const raw = this.decodeOperationRef(result);
    const parsed = parseListExperiencesPayload(raw);
    return parsed.experiences;
  }

  public async getManifest(context: ExperienceContext): Promise<ExperienceManifest> {
    const session = await this.requireSession();

    const result = await this.sendCommand(
      session,
      "GetExperienceManifest",
      {
        type: "ExperienceManifest",
        id: context
      },
      {
        context
      }
    );

    const raw = this.decodeOperationRef(result);
    const parsed = ExperienceManifestSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ExperienceProtocolError(
        "experience manifest failed shared-contract validation"
      );
    }

    if (parsed.data.context !== context) {
      throw new ExperienceProtocolError(
        "experience manifest context mismatch"
      );
    }

    return parsed.data;
  }

  private async requireSession(): Promise<
    StoredSession & {
      principal: NonNullable<StoredSession["principal"]>;
    }
  > {
    const session = await this.input.secureSessionStore.read();

    if (!session?.principal) {
      throw new ExperienceProtocolError(
        "an authenticated principal is required"
      );
    }

    if (session.serverSession === false) {
      throw new ExperienceProtocolError(
        "experience actions require a real sign-in (offline session cannot act)"
      );
    }
    if (session.signedOut === true) throw new OfflineFallbackSessionError();

    return session as StoredSession & {
      principal: NonNullable<StoredSession["principal"]>;
    };
  }

  // R15.49 — optionalSession: 有 session 用, 没 session 也行 (匿名命令).
  // 跟 MarketplaceClient.list() 同样策略.
  private async optionalSession(): Promise<
    (StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined
  > {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) return undefined;
    if (session.serverSession === false) return undefined;
    if (session.signedOut === true) return undefined;
    return session as StoredSession & {
      principal: NonNullable<StoredSession["principal"]>;
    };
  }

  // R15.49 — sendCommandOptional: 匿名可调命令.
  // session 为 nil → actor.type=PUBLIC; 走 requestPublic (不带 bearer credentials).
  private async sendCommandOptional(
    session:
      | (StoredSession & { principal: NonNullable<StoredSession["principal"]> })
      | undefined,
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const isAnonymous = !session;
    const actor = isAnonymous
      ? { type: "PUBLIC", id: "public_reader" }
      : { type: "USER", id: session.userAccountId };
    const principal = isAnonymous
      ? { type: "PUBLIC", id: "public_reader" }
      : session.principal;
    const authContext = isAnonymous ? {} : { sessionId: session.auth.sessionId };

    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor,
      principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext,
      purpose: "experience_list",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };

    const transport = isAnonymous
      ? this.input.authClient.requestPublic ?? this.input.authClient.request
      : this.input.authClient.request;
    const response = await transport(`/v1/commands/${commandType}`, {
      method: "POST",
      body: envelope
    });
    const result = parseCommandResult(await response.json());
    if (!result) {
      throw new ExperienceProtocolError(
        "experience command response was malformed"
      );
    }
    if (result.outcome === "REJECTED") {
      throw new ExperienceCommandRejectedError(result);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ExperienceProtocolError(
        `unexpected experience command status: ${response.status}`
      );
    }
    return result;
  }

  private async sendCommand(
    session: StoredSession & {
      principal: NonNullable<StoredSession["principal"]>;
    },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");

    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: {
        type: "USER",
        id: session.userAccountId
      },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: {
        sessionId: session.auth.sessionId
      },
      purpose: "experience_manifest",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };

    const response = await this.input.authClient.request(
      `/v1/commands/${commandType}`,
      {
        method: "POST",
        body: envelope
      }
    );

    const result = parseCommandResult(await response.json());

    if (!result) {
      throw new ExperienceProtocolError(
        "experience command response was malformed"
      );
    }

    if (result.outcome === "REJECTED") {
      throw new ExperienceCommandRejectedError(result);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ExperienceProtocolError(
        `unexpected experience command status: ${response.status}`
      );
    }

    return result;
  }

  private decodeOperationRef(result: CommandResult): unknown {
    if (!result.operationRef) {
      throw new ExperienceProtocolError(
        "experience response missing operationRef"
      );
    }

    try {
      return JSON.parse(result.operationRef);
    } catch {
      throw new ExperienceProtocolError(
        "experience operationRef was not valid JSON"
      );
    }
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;

    return `mobile_experience_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}
