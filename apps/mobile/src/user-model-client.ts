// AI-MANAGE-015：AI 分身「用户建模」客户端（服务端 /v1/ai/user-model，需会话 + 本人形象授权）。
// 每项带来源：ai = AI 从本人授权的图库照片识别；manual = 本人填的（AI 不覆盖）。没有就是没有，不补假值。

export type UserModelField = "heightCm" | "weightKg" | "age" | "bodyType" | "skinTone" | "hair" | "faceFeatures";

export type UserModel = {
  ownerId: string;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  bodyType?: string;
  skinTone?: string;
  hair?: string;
  // 面部与骨架特征（AI 从本人照片读出）—— 本人特征锁定锁的就是这些，不是预设人种模板（AI-MANAGE-016）。
  faceFeatures?: string;
  likenessLock: boolean;
  sources: Partial<Record<UserModelField, "ai" | "manual">>;
  analyzedPhotoCount: number;
  analyzedAt?: string;
};

export type UserModelView = { model: UserModel; galleryCount: number; recognised?: number };

export type UserModelPatch = Partial<Pick<UserModel, "heightCm" | "weightKg" | "age" | "bodyType" | "skinTone" | "hair" | "faceFeatures" | "likenessLock">> & { clear?: UserModelField[] };

export class UserModelError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

type Requester = { request(path: string, init: { method: "GET" | "POST" | "PUT"; body?: unknown }): Promise<{ status: number; json(): Promise<unknown> }> };

// 用户建模 logo（用户 2026-09-23 交付 user_modeling_black_white_clean.svg，去掉白底以便落在卡片上）。
export const USER_MODELING_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"> <circle cx="220" cy="174" r="67" fill="#111111"/> <path d="M103 374 C103 302 151 260 220 260 C289 260 337 302 337 374 C337 390 324 403 308 403 H132 C116 403 103 390 103 374Z" fill="#111111"/> <circle cx="340" cy="337" r="65" fill="#ffffff" stroke="#111111" stroke-width="18"/> </svg>`;

async function call(client: Requester, path: string, init: { method: "GET" | "POST" | "PUT"; body?: unknown }): Promise<UserModelView> {
  const response = await client.request(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status !== 200) throw new UserModelError(typeof body.error === "string" ? body.error : `http_${response.status}`);
  const model = body.model as UserModel | undefined;
  if (!model || typeof model.ownerId !== "string") throw new UserModelError("malformed");
  return {
    model: { ...model, sources: model.sources ?? {} },
    galleryCount: typeof body.galleryCount === "number" ? body.galleryCount : 0,
    ...(typeof body.recognised === "number" ? { recognised: body.recognised } : {}),
  };
}

export const fetchUserModel = (client: Requester): Promise<UserModelView> => call(client, "/v1/ai/user-model", { method: "GET" });
export const updateUserModel = (client: Requester, patch: UserModelPatch): Promise<UserModelView> => call(client, "/v1/ai/user-model", { method: "PUT", body: patch });
export const analyzeUserModel = (client: Requester): Promise<UserModelView> => call(client, "/v1/ai/user-model/analyze", { method: "POST", body: {} });

// 卡片一行描述 / chips 用：只列真有的值。
export function userModelSummary(model: UserModel): string[] {
  return [
    model.age !== undefined ? `${model.age} 岁` : undefined,
    model.heightCm !== undefined ? `${model.heightCm}cm` : undefined,
    model.bodyType?.split("·")[0]?.trim() || undefined,
    model.hair?.replace(/\s*·\s*/, "").trim() || undefined,
  ].filter((item): item is string => Boolean(item));
}

export function userModelErrorText(code: string): string {
  switch (code) {
    case "likeness_consent_required": return "还没有授权 AI 使用你的形象";
    case "no_photos": return "公共图库里还没有可用的照片，先导入几张";
    case "vision_unavailable": return "识图模型还没接上，暂时只能手动填写";
    case "vision_unreadable": return "AI 这次没看明白，换几张清楚的照片再试";
    case "invalid_value": return "数值超出范围（身高 120-220、体重 30-200、年龄 18-90）";
    default: return "没有成功，请稍后重试";
  }
}
