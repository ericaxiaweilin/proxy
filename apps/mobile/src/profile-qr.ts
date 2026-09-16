// PROFILE-QR-002 个人二维码常规能力：二维码里到底编什么 —— **标准 vCard 名片**。
//
// 为什么不再是 `https://proxy.app/@x`（2026-09-16 实测）：
//   - `proxy.app` **不是我们的域名**。它挂在 Spaceship 上**待售**，`curl https://proxy.app`
//     返回 200 + 页面标题「proxy.app for sale | Spaceship.com」。也就是说以前每一张二维码
//     扫出来都是把用户送到一个**卖域名的落地页**。
//   - app.json 里**没有 `associatedDomains`**，仓库里也**没有 apple-app-site-association** ——
//     所以就算域名是我们的，iOS 也永远不会把这个链接交给 App（会去开浏览器）。
//   - 仓库里其它主机名全是保留域名：`api.proxy.test`（`.test` 是 RFC 2606 保留 TLD）、
//     `proxy.example`（T-15 里那个 canonical URL 用的占位）。真域名 + Universal Link 那条
//     是 T-15，**还没做**。
//   - 结果就是用户说的「这个 link 自己系统的搜索都搜不出来」：`SearchProfiles` 是按
//     handle / 昵称做字面匹配的，`https://proxy.app/@huyen` 这串谁也对不上。
//
// 所以改成 vCard：**成熟的名片标准**，任何手机的相机扫到都能「存联系人」，不需要域名。
// 同时用 vCard 自己的扩展机制（`X-` 前缀，RFC 2426 / RFC 6350 允许）带上 App 需要的标识，
// 保证「App 产出的码，App 自己能读回来」—— 这是以前最缺的一条。
//
// 卡片形状（ECC H 实测版本号）：
//   个人名片 v10 57×57 —— N / FN / NICKNAME / X-PROXY-HANDLE
//   店铺名片 v12 65×65 —— N / FN / X-PROXY-STORE
// 长度是硬约束：payload 每长一截，模块就多一圈，同样尺寸下点就更小、更难扫。
// 实测（渲染成图后逐张解码，200~400px 共 51 个尺寸的通过率）：
//   旧的 https://proxy.app/store/<uuid>（v7 45×45）98.0%
//   店铺名片 N+FN+ORG+id（v13 69×69）               76.5%   ← ORG 就是被这么砍掉的
//   店铺名片 N+FN+id（v12 65×65）                   88.2%
// `ORG` 对店铺来说只是把 FN 抄了一遍，却要吃掉一整档版本号，砍掉换回 12 个百分点。
// 改这里的字段，就要重跑 `apps/mobile/scripts/qr-geometry/run.sh`。

const HANDLE_PATTERN = /^[A-Za-z0-9._-]+$/;
/** 店铺 id：服务端给的是 uuid，也兼容测试里的短式。 */
const STORE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const CRLF = "\r\n";

/** vCard 值里的保留字符必须转义（RFC 2426 §2.4.2）。反斜杠自己也要转。 */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    i += 1;
    if (next === "n" || next === "N") out += "\n";
    else if (next === undefined) out += "\\";
    else out += next;
  }
  return out;
}

function cleanHandle(handle: string): string | null {
  const cleaned = handle.trim().replace(/^@+/, "");
  if (!cleaned || !HANDLE_PATTERN.test(cleaned)) return null;
  return cleaned;
}

export type ContactCardInput = {
  /** 展示名：个人姓名，或店铺名。空则整张卡不成立（fail-closed，不画坏码）。 */
  name: string;
  /** Proxy handle。个人名片必有；店铺名片没有（店铺只有 id）。 */
  handle?: string | undefined;
  /** 店铺 id。店铺名片才有。 */
  storeId?: string | undefined;
};

/**
 * 生成标准 vCard 3.0 名片。返回 null = 输入不足以构成一张可识别的名片，
 * 调用方 fail-closed（宁可这一处不画码，也不要画一张扫了没用的码）。
 *
 * 必须有 handle 或 storeId 之一：只有名字的卡扫回来落不到任何人，等于没接。
 */
export function buildContactCard(input: ContactCardInput): string | null {
  const name = input.name.trim();
  if (!name) return null;

  const handle = input.handle ? cleanHandle(input.handle) : null;
  const storeId = input.storeId?.trim();
  const hasStore = Boolean(storeId && STORE_ID_PATTERN.test(storeId));

  if (input.handle && !handle) return null;
  if (input.storeId && !hasStore) return null;
  if (!handle && !hasStore) return null;

  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escapeValue(name)};;;;`, `FN:${escapeValue(name)}`];

  if (handle) {
    // NICKNAME 是给人看的（存进通讯录后能读到 @handle），X-PROXY-HANDLE 是给 App 认的。
    lines.push(`NICKNAME:@${escapeValue(handle)}`, `X-PROXY-HANDLE:${escapeValue(handle)}`);
  } else if (storeId) {
    // 刻意不写 `ORG:` —— 店铺的 ORG 就是店名本身（FN 已经写了），
    // 却要多花一整档版本号（v12→v13），实测解码通过率掉 12 个点。
    lines.push(`X-PROXY-STORE:${escapeValue(storeId)}`);
  }

  lines.push("END:VCARD");
  return lines.join(CRLF);
}

export type ParsedContactCard = {
  name: string;
  handle?: string | undefined;
  storeId?: string | undefined;
};

/**
 * 解析 vCard 名片。**只认带 Proxy 标识的卡** —— 别人的普通名片（没有
 * `X-PROXY-HANDLE` / `X-PROXY-STORE`）返回 null。
 *
 * 这条和以前「只认 proxy.app」是同一个原则：扫任何码都给反应，等于帮钓鱼码做跳转。
 */
export function parseContactCard(raw: string): ParsedContactCard | null {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/BEGIN:VCARD/i.test(text)) return null;

  // 展开折行：vCard 允许用「换行 + 空格」把长行折开（RFC 2426 §2.6）。
  const unfolded = text.replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");

  let name: string | undefined;
  let handle: string | undefined;
  let storeId: string | undefined;

  for (const line of lines) {
    if (!line || /^BEGIN:VCARD$/i.test(line) || /^END:VCARD$/i.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    // 属性名可能带参数（`N;CHARSET=UTF-8:`），取分号前那段。
    const property = line.slice(0, colon).split(";")[0]?.trim().toUpperCase() ?? "";
    const value = line.slice(colon + 1);
    switch (property) {
      case "FN":
        name ??= unescapeValue(value).trim();
        break;
      case "X-PROXY-HANDLE":
        handle = unescapeValue(value).trim();
        break;
      case "X-PROXY-STORE":
        storeId = unescapeValue(value).trim();
        break;
      default:
        break;
    }
  }

  const cleanedHandle = handle ? cleanHandle(handle) : null;
  const cleanedStore = storeId && STORE_ID_PATTERN.test(storeId) ? storeId : null;
  // 没有 App 能认的标识 —— 这不是 Proxy 名片。
  if (!cleanedHandle && !cleanedStore) return null;

  const result: ParsedContactCard = { name: (name || cleanedHandle || cleanedStore || "").trim() };
  if (cleanedHandle) result.handle = cleanedHandle;
  if (cleanedStore) result.storeId = cleanedStore;
  return result;
}

// PROFILE-QR-003 扫码解析：扫码枪 / 相册 / 剪贴板拿到的文本落到哪。
//
// 顺序：先试 vCard（现在的形状），再试旧的 https://proxy.app/... 链接（**已经发出去的
// 码还在别人相册里**，不能因为换了格式就认不出来），最后接受裸 `@handle`（用户手打的）。
export type ScannedQr =
  | { kind: "person"; handle: string; name: string }
  | { kind: "store"; storeId: string; name: string };

/** 旧的裸 `proxy.app/...` 归一成 https 全量；未知形状原样透传，绝不瞎改。 */
export function toQrPayload(value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("proxy.app/")) return `https://${v}`;
  return v;
}

function parseLegacyUrl(value: string): ScannedQr | null {
  const normalized = toQrPayload(value);
  const profile = /^https:\/\/proxy\.app\/@([A-Za-z0-9._-]+)\/?$/i.exec(normalized);
  if (profile?.[1]) {
    const handle = cleanHandle(profile[1]);
    if (handle) return { kind: "person", handle, name: `@${handle}` };
  }
  const invite = /^https:\/\/proxy\.app\/invite\/([A-Za-z0-9._-]+)\/?$/i.exec(normalized);
  if (invite?.[1]) {
    const handle = cleanHandle(invite[1]);
    if (handle) return { kind: "person", handle, name: `@${handle}` };
  }
  // 店铺码以前也是这个形状，而且**是 App 自己发出去的** —— 自己的码自己读不回来
  // 正是这次要修的那类问题，所以旧的店铺链接必须继续认。
  const store = /^https:\/\/proxy\.app\/store\/([A-Za-z0-9._-]+)\/?$/i.exec(normalized);
  if (store?.[1] && STORE_ID_PATTERN.test(store[1])) {
    return { kind: "store", storeId: store[1], name: store[1] };
  }
  return null;
}

export function parseScannedQr(value: string): ScannedQr | null {
  const v = value.trim();
  if (!v) return null;

  const card = parseContactCard(v);
  if (card) {
    if (card.handle) return { kind: "person", handle: card.handle, name: card.name };
    if (card.storeId) return { kind: "store", storeId: card.storeId, name: card.name };
  }

  const legacy = parseLegacyUrl(v);
  if (legacy) return legacy;

  // 裸 handle：用户把 `@huyen` 打进搜索/粘贴进来。要求带 `@`，
  // 否则任何一段普通文字都会被当成一次「识别成功」。
  const bare = /^@([A-Za-z0-9._-]+)$/.exec(v);
  if (bare?.[1]) {
    const handle = cleanHandle(bare[1]);
    if (handle) return { kind: "person", handle, name: `@${handle}` };
  }

  return null;
}

/** 码下方展示 / 复制的那串。人给 `@handle`（**这个才是 App 搜得到的**），店铺给店名。 */
export function scannedCaption(scanned: ScannedQr): string {
  return scanned.kind === "person" ? `@${scanned.handle}` : scanned.name;
}
