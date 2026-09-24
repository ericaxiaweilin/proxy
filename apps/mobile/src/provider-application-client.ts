// ORDER-PERMISSION-001：「申请接单权限」客户端（任何人可申请，性别不是门槛）（服务端 /v1/provider-application，需会话）。
// 实名只提交、只给运营看；这里的读模型是本人自己的那一份。

export type ProviderApplicationStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type ProviderApplication = {
  applicationId: string;
  displayName: string;
  realName?: string;
  city: string;
  serviceAreas: string[];
  languages: string[];
  capabilities: string[];
  intro: string;
  photoAssetIds: string[];
  status: ProviderApplicationStatus;
  rejectReason?: string;
  reviewedAt?: string;
  source: "APP" | "BACKFILL";
  createdAt: string;
};

export type ProviderApplicationOptions = {
  serviceAreas: string[];
  languages: string[];
  capabilities: string[];
  minPhotos: number;
  maxPhotos: number;
};

export type ProviderApplicationInput = {
  realName: string;
  photosAttested: boolean;
  city: string;
  serviceAreas: string[];
  languages: string[];
  capabilities: string[];
  intro: string;
  photoAssetIds: string[];
};

export type ProviderApplicationView = { application: ProviderApplication | null; options: ProviderApplicationOptions };

export class ProviderApplicationError extends Error {
  constructor(public readonly code: string, public readonly fields: readonly string[] = []) {
    super(code);
  }
}

type Requester = { request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; json(): Promise<unknown> }> };

const DEFAULT_OPTIONS: ProviderApplicationOptions = { serviceAreas: [], languages: [], capabilities: [], minPhotos: 3, maxPhotos: 9 };

async function call(client: Requester, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<ProviderApplicationView> {
  const response = await client.request(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status !== 200) {
    throw new ProviderApplicationError(
      typeof body.error === "string" ? body.error : `http_${response.status}`,
      Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === "string") : [],
    );
  }
  const app = body.application as ProviderApplication | null | undefined;
  return { application: app && typeof app.applicationId === "string" ? app : null, options: { ...DEFAULT_OPTIONS, ...(body.options as Partial<ProviderApplicationOptions> | undefined) } };
}

export const fetchProviderApplication = (client: Requester): Promise<ProviderApplicationView> => call(client, "/v1/provider-application", { method: "GET" });
export const submitProviderApplication = (client: Requester, input: ProviderApplicationInput): Promise<ProviderApplicationView> => call(client, "/v1/provider-application", { method: "POST", body: input });
export const withdrawProviderApplication = (client: Requester): Promise<ProviderApplicationView> => call(client, "/v1/provider-application/withdraw", { method: "POST", body: {} });

// 选项码 → 人话（码跟 supply 同一套）。
export const AREA_LABELS: Readonly<Record<string, string>> = { hn: "河内", bn: "北宁", hcm: "胡志明市", dn: "岘港" };
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { VI: "越南语", ZH: "中文", EN: "英语", KO: "韩语", JA: "日语" };
export const CAPABILITY_LABELS: Readonly<Record<string, string>> = { CITY_GUIDE: "城市向导", PHOTOGRAPHY: "拍照", TRANSLATION: "翻译", DRIVING: "驾车" };

const FIELD_TEXT: Readonly<Record<string, string>> = {
  profile_name: "先在「个人管理」设置用户名",
  profile_avatar: "先在「个人管理」设置头像",
  real_name: "请填写 2–40 字的真实姓名",
  photos_attested: "请确认照片均为本人真实照片",
  city: "请填写所在城市",
  service_areas: "至少选一个服务区域",
  languages: "至少选一种会说的语言",
  capabilities: "能力选项无效",
  intro: "自我介绍写 10–500 字",
  photos_count: "请上传 3–9 张本人照片",
  photos_not_own_real: "照片必须是你本人上传的真实照片（不能用 AI 生成的图）",
};

/** 服务端逐项不合格 → 逐条人话（认不出的码原样不显示，给一句兜底）。 */
export function providerApplicationFieldErrors(fields: readonly string[]): string[] {
  const out = fields.map((f) => FIELD_TEXT[f]).filter((t): t is string => Boolean(t));
  return out.length > 0 || fields.length === 0 ? out : ["有信息不合格，请检查后再提交"];
}

export function providerApplicationErrorText(error: unknown): string {
  if (error instanceof ProviderApplicationError) {
    if (error.code === "invalid_fields") return providerApplicationFieldErrors(error.fields).join("；");
    if (error.code === "already_open") return "你已经有一份审核中或已通过的申请。";
    if (error.code === "wrong_status") return "这份申请现在的状态不能这样操作，刷新看看。";
    if (error.code === "access_token_required" || error.code === "invalid_access_token") return "请先登录。";
  }
  return "暂时没连上服务，稍后再试。";
}

/** 状态卡：标题 + 一行说明。没有申请 / 撤回了 = null（直接显示表单）。 */
export function providerApplicationStatusCard(app: ProviderApplication | null): { title: string; detail: string; canWithdraw: boolean; canReapply: boolean } | null {
  if (!app || app.status === "WITHDRAWN") return null;
  switch (app.status) {
    case "SUBMITTED": return { title: "审核中", detail: "运营会看你的资料和照片，结果会显示在这里。审核期间可以撤回。", canWithdraw: true, canReapply: false };
    case "APPROVED": return { title: "已通过 · 可以接单了", detail: app.source === "BACKFILL" ? "申请入口上线前你已是服务者，已为你补录。" : "你的服务者身份已开通，现在可以接单。", canWithdraw: false, canReapply: false };
    case "REJECTED": return { title: "未通过", detail: app.rejectReason ? `原因：${app.rejectReason}` : "运营没有写原因。", canWithdraw: false, canReapply: true };
    default: return null;
  }
}
