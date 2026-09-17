import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// CONVO-ATTACH-001: 会话窗的相机图标太弱 —— 点它和 ＋ 弹同一张 sheet，
// 进相册要点两次。Lotus 式：点图标直进自建相册，首格拍摄，后面最新照片。
// 系统相册一次只能做一件事（选图 XOR 拍照），合并不了，所以缩略图自己摆，
// 拍摄复用 chooseImage("CAMERA") 的真链路。注释先剥掉再断言，只认代码。
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

  it("puts capture first and feeds the existing preview-and-send chain", () => {
    // 首格拍摄走真链路（权限/取图/报错都在 chooseImage 那一边），不另起炉灶；
    // 选图进已有的 setSelectedImage → sendImage，不旁路发送。
    expect(convoCode).toContain('accessibilityLabel="拍摄"');
    expect(convoCode).toContain('chooseImage("CAMERA")');
    expect(convoCode).toContain("setSelectedImage({ uri: a.uri");
    expect(convoCode).toContain("recyclingKey={`album:${a.uri}`}");
  });

  it("says no to dead ends instead of going silent", () => {
    // 没权限 / 打不开 / 空相册 —— 三件事三句话，静默等于按钮坏了。
    expect(convoCode).toContain("请允许 Proxy 读取照片");
    expect(convoCode).toContain("相册打不开，请重试");
    expect(convoCode).toContain("相册是空的，先拍一张吧");
  });

  it("drops the duplicate photo row from the attach sheet", () => {
    // 照片入口搬到相机图标上之后，＋ 里再留一个就是两条路进同一个相册。
    expect(convoCode).not.toContain(">照片</Text>");
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

  it("keeps camera media out of the attach sheet entirely", () => {
    // 拍照/选图/选视频都在相机图标的相册里 —— ＋ 里留任何一个都是第二条路。
    // （CONVO-ATTACH-001 已钉死照片行，这里把视频行一起钉死。）
    expect(convoCode).not.toContain(">视频</Text>");
    expect(convoCode).not.toContain(">照片</Text>");
  });
});
