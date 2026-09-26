import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const feed = readFileSync(new URL("./feed.tsx", import.meta.url), "utf8");

describe("SELF-FOLLOW-001 本人帖子的头像菜单不提供「关注」", () => {
  // 移动端没有 testing-library / react-test-renderer，组件不能真渲染，所以这里钉源码结构。
  // 后端已经拒绝自关注（CANNOT_FOLLOW_SELF）；这一层的作用是别让用户看到一个必然失败的操作。

  it("gates the 关注 row on isOwnAuthorId(profileActions.userId, viewerAccountId)", () => {
    expect(feed).toContain("!isOwnAuthorId(profileActions.userId, viewerAccountId)");
  });

  it("guards toggleProfileFollow too, before it can send anything", () => {
    const fnAt = feed.indexOf("async function toggleProfileFollow(");
    const guardAt = feed.indexOf("isOwnAuthorId(profileActions.userId, viewerAccountId)", fnAt);
    const busyAt = feed.indexOf("setProfileFollowBusy(true)", fnAt);
    expect(fnAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(busyAt).toBeGreaterThan(-1);
    // 门必须排在真正开始请求之前，否则「隐藏按钮」只是表面功夫。
    expect(guardAt).toBeLessThan(busyAt);
  });

  it("still lets you reach your own profile — 访问个人主页 stays ungated", () => {
    // 这正是 PROFILE-FROM-ANY-TAB-001 修的那条路：自己帖子点头像 → 访问个人主页
    // 必须仍然可用。别把「不显示关注」误做成「不显示菜单」。
    // 注意锚点要用真正的 JSX 文本：文件里有三处注释也提到「访问个人主页」
    // （写入方说明 / 头像 onPress 说明），用 indexOf 会命中注释而不是那一行。
    const menuAt = feed.indexOf(">访问个人主页</Text>");
    expect(menuAt).toBeGreaterThan(-1);
    const rowAt = feed.lastIndexOf("<GlassView", menuAt);
    expect(rowAt).toBeGreaterThan(-1);
    // 承载「访问个人主页」的那一行没有被 isOwnAuthorId 条件包住。
    expect(feed.slice(rowAt, menuAt)).not.toContain("isOwnAuthorId");
  });
});

describe("FOLLOW-STATE-HYDRATE-001 关注态必须从服务端回读", () => {
  // 用户报的 P0：点头像 → 关注 → 等到「已关注」→ 切模块再回来 → 又变回「+ 关注」。
  // 根因不在服务端：engagement.follows 有行、IsFollowing 读得回来。是客户端这根线
  // 从来没接过 —— `following` 只有 toggleProfileFollow 一个写点，从不回读，所以它是
  // 「本会话手动点过谁」的内存集合，remount 即清空。四个消费点全部因此失真：
  // 头像菜单、关注 tab 的过滤、friends 自定义流、帖子卡上的 isFollow。
  // 移动端没有 testing-library，组件不能真渲染，所以这里钉源码结构（同本文件其余用例）。

  // 回读那一整个 effect 的范围：从它自己的 useEffect 到依赖数组收尾。
  // 原先这里写的是「isFollowing 调用往后数 2000 字符」，falsification 跑出来是假守卫：
  // 选作者的那个循环（去重 / 跳过本人 / 跳过在飞的）在调用**之前**，而「照抄头像那份
  // authorType 跳过」这个最像真事的错误正好落在调用之前 —— 那条臂能活（A3），只有把
  // 引用硬塞进窗口内才红（A3b）。窗口改成整个 effect 之后两条都红。
  // 仪器：~/wb-scratch/falsify_follow.py。
  const callAt = feed.indexOf("engagement.isFollowing(");
  const probeStart = callAt === -1 ? -1 : feed.lastIndexOf("useEffect(() => {", callAt);
  const probeEnd = callAt === -1 ? -1 : feed.indexOf("}, [posts, viewerAccountId, engagement]);", callAt);
  const probe = probeStart > -1 && probeEnd > probeStart ? feed.slice(probeStart, probeEnd) : "";

  it("reads the follow graph back instead of trusting session-local state", () => {
    // 带括号锚定：只留 import / 改名成 isFollowingX 都不能满足它。
    // 第一行是非空窗验：窗口得真罩住回读那段，后面的断言才不会落在空串上假绿。
    expect(probe).toContain("const wanted: string[] = [];");
    expect(probe).toMatch(/engagement\.isFollowing\(/);
  });

  it("feeds the read-back into `following`, as a merge and not a replace", () => {
    // 光查询不算接线：结果必须落进 UI 真正读的那个集合。整份替换会把用户本会话
    // 刚做的决定一起抹掉，所以必须是**并入**。
    expect(probe).toContain("engagement.isFollowing(");
    expect(probe).toContain("setFollowing((current)");
  });

  it("probes every author type — 关注对 AGENT / AI 账号同样成立", () => {
    // 头像那条管线按 authorType 跳过 AGENT / AI_NATIVE（它们走别的解析路径），
    // 关注没有这个区分：ai-assistants-row 关注的就是 AI 账号。别顺手照抄那份跳过。
    // 两个正向标记把窗口钉死在「选作者」那一段上，not.toContain 才不会空转。
    expect(probe).toContain("const wanted: string[] = [];");
    expect(probe).toContain("if (followProbeInFlightRef.current.has(authorId)) continue;");
    expect(probe).not.toContain("AUTHOR_AVATAR_SKIP_TYPES");
  });

  it("keeps the in-flight dedupe per-mount, so a remount really re-reads", () => {
    expect(feed).toMatch(/const followProbeInFlightRef = useRef<Set<string>>\(new Set\(\)\)/);
    // 反向：一旦挪成模块级（列 0），新 mount 会看到上一次留下的「在飞」记录而跳过
    // 回读 —— 原 bug 原地复发。
    expect(feed).not.toMatch(/^const followProbeInFlight/m);
  });

  it("lets the user's own toggle win over a stale read-back", () => {
    const fnAt = feed.indexOf("async function toggleProfileFollow(");
    expect(fnAt).toBeGreaterThan(-1);
    // 回读可能在 toggle 之前就发出了（读到的还是旧值）。用户自己的决定必须记下来，
    // 否则会出现「刚取消关注、切一下又变回已关注」这个镜像 bug。
    expect(feed.indexOf("followDecisionsRef.current.set(", fnAt)).toBeGreaterThan(fnAt);
  });
});

describe("AVATAR-FLASH-001 本人头像不闪黑头", () => {
  // 首帧时异步解析（读盘/读网）还没回来，旧实现直接画 #111 黑底首字，
  // 照片到了再换 —— 每次进动态都"黑一下"。现在：内存缓存首帧直出，
  // 算不出来时画透明占位，算出来是首字才画黑底。
  it("caches the resolved avatar URI across mounts, keyed by account", () => {
    expect(feed).toContain("cachedViewerAvatar");
    expect(feed).toContain("cachedViewerAvatar.accountId === viewerAccountId");
  });

  it("renders a transparent placeholder (not the #111 circle) while the own avatar is unresolved", () => {
    expect(feed).toContain("!viewerAvatarLoaded && viewerAvatarUri === undefined");
    expect(feed).toContain('backgroundColor: "transparent"');
  });
});
