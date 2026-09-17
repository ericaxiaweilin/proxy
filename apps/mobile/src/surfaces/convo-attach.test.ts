import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// CONVO-ATTACH-001: 会话窗的相机图标太弱 —— 点它和 ＋ 弹同一张 sheet，
// 进相册要点两次。Lotus 式：点图标直进自建相册。
//
// CONVO-ATTACH-002: 001 的首格是"点了跳系统相机"的按钮、缩略图逐张调用
// getUri()（触发 iCloud 下载，慢）、没带 mimeType（HEIC 声明成 JPEG 被
// 服务端拒收）、视频要另外去 ＋ 面板找。002 把首格换成真的实时取景
// （CameraView + 快门直接拍），缩略图改用 id 本身渲染（不碰网络，只在
// 点选那一张时才 resolve 真实 URI + 按文件名推 mimeType），图片视频
// 同一个入口，＋ 面板不再重复放"视频"。注释先剥掉再断言，只认代码。
const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const convoCode = stripComments(convo);

describe("CONVO-ATTACH-001 tapping the camera icon opens the album directly", () => {
  it("opens the album in one tap instead of the attach sheet", () => {
    expect(convoCode).toContain('accessibilityLabel="相册"');
    expect(convoCode).toContain("void openAlbum()");
    // v57 顶层 getAssetsAsync 是只会 throw 的占位实现 —— 必须走新 API，
    // 源码钉只能钉到这一层，真机点按验收在门禁之外另做。
    expect(convoCode).toContain("new Query()");
    expect(convoCode).toContain("AssetField.MEDIA_TYPE");
    expect(convoCode).not.toContain("MediaLibrary.getAssetsAsync");
  });

  it("drops the duplicate photo row from the attach sheet", () => {
    // 照片入口搬到相机图标上之后，＋ 里再留一个就是两条路进同一个相册。
    expect(convoCode).not.toContain(">照片</Text>");
  });
});

describe("CONVO-ATTACH-002 camera slot is a live viewfinder, not a jump-away button", () => {
  it("queries both images and videos, not images only", () => {
    // 001 用 .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE) 只查图片；
    // 002 必须用 .within(...) 同时收 IMAGE 和 VIDEO，否则视频又回到
    // 只能从 ＋ 面板另找一条路的老问题。
    expect(convoCode).toContain(".within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])");
    expect(convoCode).not.toContain(".eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)");
  });

  it("the camera slot is a real live preview with a shutter, not a button that jumps to chooseImage", () => {
    expect(convoCode).toContain("CameraView");
    expect(convoCode).toContain("takePictureAsync");
    expect(convoCode).toContain("async function capturePhoto(): Promise<void>");
    // 001 那种"点拍摄跳系统相机"的独立函数不应该再存在——相机位本身
    // 就是实时取景，快门直接拍。
    expect(convoCode).not.toContain('async function chooseImage(source: "CAMERA" | "LIBRARY")');
  });

  it("thumbnails render from the asset id directly, not from a per-item getUri() call", () => {
    // 逐张 getUri() 会触发 iCloud 下载，是"选完要等好几秒"的根因；
    // 缩略图必须改成不碰网络的 id 渲染，getUri() 只能在点选那一张时
    // 出现一次。
    expect(convoCode).toContain("function thumbnailSource(id: string)");
    expect(convoCode).toContain("source={thumbnailSource(a.id)}");
    const getUriCallSites = (convoCode.match(/\.getUri\(\)/g) ?? []).length;
    expect(getUriCallSites).toBe(1);
  });

  it("resolves a real mimeType from the filename instead of trusting the upload default", () => {
    // 不带 mimeType 时 uploadImage 会用 "image/jpeg" 顶上去；iPhone 相册
    // 默认是 HEIC，声明和探测的真实格式对不上，服务端 mediaMimeAllowed
    // 直接拒收——这是"选好照片发不出去"的根因，必须显式推出真实类型。
    expect(convoCode).toContain("function mimeFromFilename(filename: string | undefined)");
    expect(convoCode).toContain('case "heic": return "image/heic";');
    expect(convoCode).toContain("mimeFromFilename(filename)");
  });

  it("paginates silently on scroll instead of a visible load-more button", () => {
    expect(convoCode).toContain("onEndReached={() => void loadMoreAlbumSilently()}");
    expect(convoCode).not.toContain(">加载更多<");
  });

  it("says no to dead ends instead of going silent", () => {
    // 没权限 / 打不开 / 相册没有照片和视频 —— 三件事三句话，静默等于
    // 按钮坏了。相机位永远在，列表技术上不是空的，所以空相册文案挂在
    // ListFooterComponent 上，跟当年 001 的位置不一样，但话还在。
    expect(convoCode).toContain("请允许 Proxy 读取照片");
    expect(convoCode).toContain("相册打不开，请重试");
    expect(convoCode).toContain("相册是空的，先拍一张吧");
  });

  it("drops the duplicate video row from the attach sheet", () => {
    // 视频统一从相机图标这一个入口选，＋ 面板不该再留一条独立的"视频"路。
    expect(convoCode).not.toContain(">视频</Text>");
    expect(convoCode).not.toContain("async function chooseVideo(): Promise<void>");
  });
});

describe("SHEET-ICONS-001 attach sheet entries are icon tiles, not text rows", () => {
  it("renders card, event and location as icon tiles with their handlers intact", () => {
    // 原型定的三个块：名片(user)/活动(ticket)/位置(pin)。处理函数一个没动，
    // 只换皮 —— 卡片选择器、活动选择器、位置 sheet 照旧。
    expect(convoCode).toContain('name="user"');
    expect(convoCode).toContain('name="ticket"');
    expect(convoCode).toContain('name="pin"');
    expect(convoCode).toContain("setCardPickerOpen(true)");
    expect(convoCode).toContain("void openActivityPicker()");
    expect(convoCode).toContain('setLocationSheetOpen(true)');
  });
});
