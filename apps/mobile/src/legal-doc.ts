// R16.9: minimal client to fetch the legal documents from the server's
// /v1/legal/{terms,privacy} endpoint. We intentionally do NOT depend on
// the secure-session / auth-client — these documents are public, and the
// signup gate must be able to fetch them BEFORE the user has any session.

export type LegalDocKind = "terms" | "privacy";

export type LegalDoc = {
  kind: LegalDocKind;
  version: string;
  locale: string;
  title: string;
  effectiveAt: string;
  contentSha256: string;
  updatedAt: string;
  content: string;
};

export class LegalDocClient {
  constructor(private readonly input: { baseUrl: string; fetchImpl?: typeof fetch }) {}

  async load(kind: LegalDocKind): Promise<LegalDoc> {
    const baseUrl = this.input.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/v1/legal/${kind}`;
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`legal doc fetch failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as LegalDoc;
    if (body.kind !== kind) {
      throw new Error(`legal doc kind mismatch: requested=${kind} got=${body.kind}`);
    }
    if (!body.content || body.content.length < 200) {
      throw new Error(`legal doc body is empty (${body.content?.length ?? 0} bytes) — refusing to show as consent`);
    }
    return body;
  }
}
