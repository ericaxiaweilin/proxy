// ORDER-PERMISSION-001：「申请接单权限」客户端（任何人可申请，性别不是门槛）（服务端 /v1/provider-application，需会话）。
// 实名只提交、只给运营看；这里的读模型是本人自己的那一份。

export type ProviderApplicationStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type ProviderApplication = {
  applicationId: string;
  displayName: string;
  realName?: string;
  birthYear?: number;
  // KYC-BIRTH-DATE-001：出生日期精确到日；birthYear 只读兼容老行；gender 后端保留兼容但不再收。
  birthDate?: string;
  gender?: string;
  phone?: string;
  phoneVerified: boolean;
  idType?: "CCCD" | "PASSPORT";
  termsVersion?: string;
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
  minAge: number;
};

// 履约条款来自服务端读的 config/provider-terms/terms.json；enforced=false = 机制还没上线，界面如实标注。
export type ProviderTerms = { version: string; items: Array<{ id: string; title: string; body: string; enforced: boolean }> };

export type ProviderApplicationInput = {
  realName: string;
  birthDate: string;
  gender: "";
  phone: string;
  idType: "CCCD" | "PASSPORT";
  idFrontAsset: string;
  idBackAsset: string;
  selfieAsset: string;
  noCrimeDeclared: boolean;
  dataConsent: boolean;
  emergencyContact: string;
  termsVersion: string;
  termsAccepted: string[];
};

export type ProviderApplicationView = { application: ProviderApplication | null; options: ProviderApplicationOptions; terms: ProviderTerms | null };

export class ProviderApplicationError extends Error {
  constructor(public readonly code: string, public readonly fields: readonly string[] = []) {
    super(code);
  }
}

type Requester = { request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; json(): Promise<unknown> }> };

const DEFAULT_OPTIONS: ProviderApplicationOptions = { serviceAreas: [], languages: [], minAge: 18 };

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
  const terms = body.terms as ProviderTerms | undefined;
  return {
    application: app && typeof app.applicationId === "string" ? app : null,
    options: { ...DEFAULT_OPTIONS, ...(body.options as Partial<ProviderApplicationOptions> | undefined) },
    terms: terms && typeof terms.version === "string" && Array.isArray(terms.items) ? terms : null,
  };
}

export const fetchProviderApplication = (client: Requester): Promise<ProviderApplicationView> => call(client, "/v1/provider-application", { method: "GET" });
export const submitProviderApplication = (client: Requester, input: ProviderApplicationInput): Promise<ProviderApplicationView> => call(client, "/v1/provider-application", { method: "POST", body: input });
export const withdrawProviderApplication = (client: Requester): Promise<ProviderApplicationView> => call(client, "/v1/provider-application/withdraw", { method: "POST", body: {} });

// 选项码 → 人话（码跟 supply 同一套）。
export const AREA_LABELS: Readonly<Record<string, string>> = { hn: "河内", bn: "北宁", hcm: "胡志明市", dn: "岘港" };
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { VI: "越南语", ZH: "中文", EN: "英语", KO: "韩语", JA: "日语" };

// 手机号成熟做法：只收越南手机号 —— 本地 0 开头 10 位 / 国际 +84 开头后面 9 位。
// 输入时自动断空格（0912 345 678 / +84 912 345 678），服务端 normalize 会去空格，两边一致。
export function formatPhoneInput(value: string): string {
  const v = value.trim();
  if (v.startsWith("+")) {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8), digits.slice(8)].filter((p) => p !== "");
    return `+${parts.join(" ")}`.trimEnd();
  }
  const digits = v.replace(/\D/g, "").slice(0, 10);
  const parts = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)].filter((p) => p !== "");
  return parts.join(" ");
}

// 返回错误文案，没有错误返回 undefined。
export function phoneDigitsError(value: string): string | undefined {
  const v = value.trim();
  if (v === "") return "请填写手机号";
  const digits = v.replace(/\D/g, "");
  if (v.startsWith("+")) {
    return /^84\d{9}$/.test(digits) ? undefined : "越南手机号是 +84 开头，后面 9 位";
  }
  return /^0\d{9}$/.test(digits) ? undefined : "手机号填 10 位，以 0 开头";
}

const FIELD_TEXT: Readonly<Record<string, string>> = {
  profile_name: "先在「个人管理」设置用户名",
  profile_avatar: "先在「个人管理」设置头像",
  real_name: "请填写 2–40 字的真实姓名",
  birth_date: "出生日期不对（格式 2001-05-20，需年满 18 岁）",
  phone: "手机号格式不对",
  city: "请填写所在城市",
  service_areas: "至少选一个服务区域",
  languages: "至少选一种会说的语言",
  id_type: "请选择证件类型",
  id_documents: "请上传证件（身份证要正反面，护照只要正面）",
  selfie: "请上传手持证件的自拍",
  documents_not_own_real: "证件和自拍必须是你本人上传的真实照片（不能用 AI 生成的图）",
  no_crime_declared: "请勾选无犯罪声明",
  data_consent: "请同意 KYC 数据使用",
  emergency_contact: "请填写紧急联系人（姓名 + 电话）",
  terms_accepted: "请逐条接受履约条款",
  terms_outdated: "履约条款已更新，请重新阅读后再提交",
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

// ORDER-CENTER-STATS-001：「我的订单」顶部接单面板（真实订单 / 举报算出来的；比率分母为 0 时是 null）。
export type ProviderStats = {
  completed: number;
  cancelledByMe: number;
  onTime: number;
  completionRate: number | null;
  onTimeRate: number | null;
  repeatClients: number;
  complaints: number;
  openComplaints: number;
};
export type ProviderStatsView = { permission: "NONE" | ProviderApplicationStatus; stats: ProviderStats };

export async function fetchProviderStats(client: Requester): Promise<ProviderStatsView> {
  const response = await client.request("/v1/provider-application/stats", { method: "GET" });
  const body = (await response.json().catch(() => ({}))) as Partial<ProviderStatsView> & { error?: string };
  if (response.status !== 200 || !body.stats) throw new ProviderApplicationError(body.error ?? `http_${response.status}`);
  return { permission: body.permission ?? "NONE", stats: body.stats };
}

/** 比率 → 「92%」；没有分母 → 「—」（不给 0% 也不给 100%）。 */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function permissionLine(permission: ProviderStatsView["permission"]): { text: string; canApply: boolean } {
  switch (permission) {
    case "APPROVED": return { text: "已认证 · 可接单", canApply: false };
    case "SUBMITTED": return { text: "KYC认证审核中", canApply: true };
    case "REJECTED": return { text: "KYC认证未通过 · 可修改后重新提交", canApply: true };
    default: return { text: "还没有完成KYC认证", canApply: true };
  }
}

// 审核进度（原型「KYC 审核进度」），只列真实发生的步骤：没有「证件自动比对」「Face ID」—— 这两样没有。
export type KycPipelineStep = { title: string; state: "done" | "active" | "pending" | "failed"; badge: string; hint: string };

export function kycPipeline(app: ProviderApplication | null): KycPipelineStep[] {
  const status = app?.status;
  const submitted = status === "SUBMITTED" || status === "APPROVED" || status === "REJECTED";
  return [
    { title: "资料提交", state: submitted ? "done" : "pending", badge: submitted ? "完成" : "待提交", hint: submitted ? "基础信息 + 证件 + 手持证件自拍 + 条款" : "3 步填完后提交" },
    {
      title: "运营人工比对",
      state: status === "SUBMITTED" ? "active" : status === "APPROVED" || status === "REJECTED" ? "done" : "pending",
      badge: status === "SUBMITTED" ? "进行中" : status === "APPROVED" || status === "REJECTED" ? "完成" : "等待中",
      hint: "手持证件自拍 ↔ 证件照 ↔ 主页头像",
    },
    {
      title: "KYC 通过",
      state: status === "APPROVED" ? "done" : status === "REJECTED" ? "failed" : "pending",
      badge: status === "APPROVED" ? "通过" : status === "REJECTED" ? "未通过" : "等待中",
      hint: status === "APPROVED" ? "可以接单，AI 分身已开放" : status === "REJECTED" ? "看原因，修改后重新提交" : "通过后开始接单",
    },
  ];
}
