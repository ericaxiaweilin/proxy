// ComposerV2Screen — 新动态 v2（视觉 1:1 复刻 Proxy · 新动态 v2.html）
//
// 设计目标: 替换 feed.tsx 里的 X 式内联 composer，提供
//   - 顶栏: 取消 / 新动态 / 发布
//   - 1/2/4 宫格媒体预览（替换原横向滚动单卡）
//   - 引用帖文卡片（升级原单行 ellipsis）
//   - 地点 / 话题 chip + 底部 sheet
//   - 权限行: 谁可回复 / 谁可引用（独立 sheet）
//   - GIF / 投票 / 长文 / 24h 切换 / 串帖（UI-only，序列化到正文）
//   - @提及插入 / 字数 0/500 / Toast
//
// 配色: 走 R3 token（color.surface / color.ink / color.lime / color.violet），
// 不沿用 v2 HTML 的米黄/橙系以保持 R3 视觉基线一致。
//
// 数据层:
//   - body / media / quote / place / topic: 走 CreatePost 命令（与旧 composer 同一链路）
//   - gif / poll / longText / 24h / threadNext: 纯本地状态，发布时序列化进 body
//   - 草稿持久化: 复用 expo-composer-draft-store（只存 body + media + quote + city + visibility，
//     视觉装饰项不持久化，重启后丢失。GIF/投票作为内容提示已被写入 body，重启后保留）
//
// 依赖注入: 父组件传入 localNet / mediaClient，组件自管所有 composer 状态。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CreatePostPayload, FeedPost } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type MediaClient } from "../media-client";
import { type SecureSessionStore } from "../secure-session";
import { SessionExpiredError } from "../auth-client";
import {
  createDraftMedia,
  draftMediaDragTarget,
  draftMediaRefs,
  MAX_ALT_LENGTH,
  mediaStatusLabel,
  moveDraftMedia,
  normalizeRestoredDraftMedia,
  pendingDraftMedia,
  type DraftMediaItem
} from "../composer-media";
import {
  clearComposerDraft,
  readComposerDraft,
  retainComposerImage,
  writeComposerDraft
} from "../expo-composer-draft-store";
import { mediaTypeForMime } from "../media-client";
import { color } from "../theme";
import { ProxyIcon } from "../components/proxy-icon";
import { LocationPickerSheet, type AnyLocation, DEFAULT_LOCATION } from "../components/location-picker-sheet";
import { VoiceToolButton } from "../components/VoiceToolButton";
import { TooltipOnLongPress } from "../components/TooltipOnLongPress";
import { assembleComposerBody, parseComposerBody, formatRelativeTime, describePollDuration, appendLongText, estimateAssembledBodyLength, insertAtCaret, shouldSerializePoll } from "../composer-body";
import { buildCreatePostPayload, newPublishIdempotencyKey } from "../composer-publish";
import { createProfileStore } from "../profile-store";
import { nativeSecureStorageDriver } from "../native-secure-storage";

// 在 composer 未选地点时给 location-picker-sheet 一个 fallback
const DEFAULT_LOCATION_FALLBACK: AnyLocation = DEFAULT_LOCATION as AnyLocation;

// FEED-OWN-001: 发布时读取与 me 页同源的 profile 记录，拿到用户自己设
// 过的真名；没设过则不传展示名（读端按 author id 兜底）。
const composerProfileStore = createProfileStore(nativeSecureStorageDriver);

const COMPOSER_MEDIA_ITEM_SPAN = 130;
const MAX_BODY_LENGTH = 500;
const MAX_MEDIA = 6;
const MAX_POLL_OPTIONS = 4;
// 串帖跟帖上限：主帖 + 8 条跟帖，发布时按 “2/ …”“3/ …” 拼进正文。
const MAX_THREAD_ENTRIES = 8;

const GIF_WORDS = ["YES!", "LOL", "WOW", "OK", "♥", "HEART", "HI", "?", "??", "👀", "👋", "👍"] as const;
const POLL_DURATIONS = ["1 天", "3 天", "7 天", "1 小时", "30 分钟"] as const;
const TOPIC_SUGGESTIONS = [
  "# 河内周末",
  "# 咖啡店",
  "# 今天去哪",
  "# 美食推荐",
  "# 在路上",
  "# 艺术展览"
] as const;

type ReplyPermission = "所有人" | "我关注的人" | "仅提及的人";
type QuotePermission = "所有人" | "我关注的人" | "不允许";

type ToastState = { visible: boolean; message: string };

type PollState = {
  open: boolean;
  options: string[];
  durationLabel: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPublished: () => void | Promise<void>;
  localNet: LocalNetClient;
  mediaClient: MediaClient;
  // R15.37: composet 需要知道当前 session 以供
  //   “未登录不发” + “未登录不点发布” 这两个 UI gate 用。
  secureSessionStore?: SecureSessionStore | undefined;
  // 从父组件传入的初始值（quote: 由 feed.tsx 的 openComposer(quoteId?) 透传）
  initialQuoteId?: string | null;
  posts: FeedPost[];
};

export function ComposerV2Screen({
  visible,
  onClose,
  onPublished,
  localNet,
  mediaClient,
  secureSessionStore,
  initialQuoteId,
  posts
}: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  // R15.37: P0 “未登录不发布” 强 gate — 准仅发布按钮状态。
  //   未设置 store (开发环境 / 离线 unit test) 默认为 “可发” 以免
  //   拑入别的 race; 运行时总是传入 store。
  const [isAuthenticatedForWrite, setIsAuthenticatedForWrite] = useState<boolean>(secureSessionStore === undefined);
  useEffect(() => {
    if (!secureSessionStore) return;
    let cancelled = false;
    void secureSessionStore.read().then((session) => {
      if (cancelled) return;
      // 1. 有 session.principal
      // 2. serverSession !== false (未签发的离线 fallback 不行)
      // 3. signedOut !== true (R15.39: 登出后设了 signedOut=true, 仍需
      //    silent re-auth 才能写)
      const ok = !!session?.principal && session.serverSession !== false && session.signedOut !== true;
      setIsAuthenticatedForWrite(ok);
    }).catch(() => {
      if (!cancelled) setIsAuthenticatedForWrite(false);
    });
    return () => {
      cancelled = true;
    };
  }, [secureSessionStore, visible]);
  // —— 顶层状态 ——
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<DraftMediaItem[]>([]);
  const [quoteId, setQuoteId] = useState<string | null>(initialQuoteId ?? null);
  const [visibility, setVisibility] = useState<"PUBLIC" | "FOLLOWERS">("PUBLIC");
  const [includeCity, setIncludeCity] = useState(true);
  const [error, setError] = useState<string>();

  // —— 视觉装饰状态（v2 引入）——
  const [place, setPlace] = useState<AnyLocation | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [gifWord, setGifWord] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollState>({ open: false, options: ["", ""], durationLabel: "1 天" });
  const [isGhost24h, setIsGhost24h] = useState(false);
  const [replyPerm, setReplyPerm] = useState<ReplyPermission>("所有人");
  const [quotePerm, setQuotePerm] = useState<QuotePermission>("所有人");
  const [longTextOpen, setLongTextOpen] = useState(false);
  const [longTextDraft, setLongTextDraft] = useState("");
  // 串帖跟帖：纯本地状态，发布时按编号拼进正文（见 threadedBody）。
  const [threadEntries, setThreadEntries] = useState<string[]>([]);

  // —— Sheet 显隐 ——
  const [openSheet, setOpenSheet] = useState<null | "reply" | "quote" | "gif" | "topic" | "more" | "location" | "quotePicker" | "pollDuration">(null);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // —— 上传/发布 内部管线 ——
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadActionsRef = useRef<Map<string, "PAUSE" | "CANCEL">>(new Map());
  const draftSequenceRef = useRef(0);
  const idempotencyRef = useRef<string | undefined>(undefined);
  const restoredRef = useRef(false);

  // —— 派生 ——
  const quoteTarget = useMemo(() => {
    if (!quoteId) return undefined;
    return posts.find((p) => p.postId === quoteId);
  }, [quoteId, posts]);

  // 如果用户选了某条帖文作为引用，但拉取 / 刷新后该帖不在当前列表里
  // （被删 / 被下架 / 后端无法解析），主动提醒 + 清空 quoteId，
  // 避免发送时出现 contextRef 指向不存在帖子。
  useEffect(() => {
    if (!quoteId) return;
    if (!quoteTarget) {
      setQuoteId(null);
      showToast("原帖已不可用，引用已取消。");
    }
  }, [quoteId, quoteTarget]);

  // 串帖正文：主帖 + 非空跟帖（2/ 3/ …编号），装饰计数与发布都以它为准。
  const threadedBody = useMemo(() => {
    const extras = threadEntries.map((t) => t.trim()).filter((t) => t.length > 0);
    if (extras.length === 0) return body;
    return [body.trim(), ...extras.map((t, i) => `${i + 2}/ ${t}`)].filter(Boolean).join("\n\n");
  }, [body, threadEntries]);

  // 估计最终 body 文本长度（装饰前缀计入）。这样用户在字符超限前可以准备截断。
  const effectiveBodyLength = estimateAssembledBodyLength({
    body: threadedBody,
    gifWord,
    poll,
    place: place ? { area: place.area } : null,
    topic,
    isGhost24h,
    quoteTarget,
    replyPerm,
    quotePerm
  });
  const hasAnyContent = !!(
    body.trim() ||
    threadEntries.some((t) => t.trim()) ||
    media.length > 0 ||
    gifWord ||
    shouldSerializePoll(poll) ||
    place ||
    topic ||
    quoteId
  );
  const isReady = hasAnyContent && !publishing && isAuthenticatedForWrite;
  const showCountWarn = effectiveBodyLength > MAX_BODY_LENGTH - 40;

  function showToast(message: string): void {
    setToast({ visible: true, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ visible: false, message: "" }), 1400);
  }

  // —— 草稿恢复 / 持久化 ——
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void readComposerDraft().then((snapshot) => {
      if (!active) return;
      if (snapshot) {
        // 从已发布的 body 文本里反向拆出可视装饰项
        // (重启后这些状态原本不持久化，恢复草稿时一并拿回来)
        const parsed = parseComposerBody(snapshot.body);
        setBody(parsed.cleanBody);
        if (parsed.isGhost24h) setIsGhost24h(true);
        if (parsed.gifWord) setGifWord(parsed.gifWord);
        if (parsed.poll) setPoll(parsed.poll);
        if (parsed.topic) setTopic(parsed.topic);
        if (parsed.replyPerm && (parsed.replyPerm === "我关注的人" || parsed.replyPerm === "仅提及的人")) setReplyPerm(parsed.replyPerm);
        if (parsed.quotePerm && (parsed.quotePerm === "我关注的人" || parsed.quotePerm === "不允许")) setQuotePerm(parsed.quotePerm);
        setMedia(normalizeRestoredDraftMedia(snapshot.media));
        setVisibility(snapshot.visibility);
        setIncludeCity(snapshot.includeCity);
        // 草稿里未绑定引用时才以本次传入的 quoteId 作为初始引用；
        // 避免覆盖用户之前手动选中的引用。
        if (!snapshot.quoteTargetId) {
          setQuoteId(initialQuoteId ?? null);
        }
        idempotencyRef.current = snapshot.publishIdempotencyKey;
      } else {
        setQuoteId(initialQuoteId ?? null);
      }
      restoredRef.current = true;
    });
    return () => {
      active = false;
    };
  }, [visible, initialQuoteId]);

  // 实时透传引用：composer 已开状态下再次点击 引用 ，立即换绑。
  useEffect(() => {
    if (!visible || !restoredRef.current) return;
    if (!initialQuoteId) return;
    setQuoteId((current) => (current === initialQuoteId ? current : initialQuoteId));
  }, [visible, initialQuoteId]);

  useEffect(() => {
    if (!visible || !restoredRef.current) return;
    const persist = (): void => {
      try {
        writeComposerDraft({
          version: 1,
          body,
          media,
          visibility,
          includeCity,
          quoteTargetId: quoteId,
          publishIdempotencyKey: idempotencyRef.current,
          updatedAt: new Date().toISOString()
        });
      } catch {
        // 草稿仅在内存中保留
      }
    };
    const timer = setTimeout(persist, 250);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "inactive" || state === "background") persist();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [body, media, visibility, includeCity, quoteId, visible]);

  // 关闭时清理
  useEffect(() => {
    if (visible) return;
    for (const controller of uploadControllersRef.current.values()) controller.abort();
    uploadControllersRef.current.clear();
    // 关闭时同时清理长文 modal 里的临时草稿，避免下次打开还残留
    setLongTextDraft("");
    setLongTextOpen(false);
  }, [visible]);

  // —— 媒体选择 / 替换 ——
  async function pickImages(source: "camera" | "library"): Promise<void> {
    setError(undefined);
    if (media.length >= MAX_MEDIA) {
      setError(`最多 ${MAX_MEDIA} 张照片`);
      return;
    }
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === "camera" ? "需要相机权限才能拍照。" : "需要照片权限才能选择图片。");
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, MAX_MEDIA - media.length),
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
        });
    if (result.canceled) return;
    const selected = result.assets.map((asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      ...(asset.fileName ? { fileName: asset.fileName } : {}),
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {})
    }));
    invalidatePublishAttempt();
    const items = selected.map((image) => {
      draftSequenceRef.current += 1;
      return createDraftMedia(image, `draft_media_${Date.now().toString(36)}_${draftSequenceRef.current.toString(36)}`);
    });
    let retentionFailed = false;
    const retained = await Promise.all(items.map(async (item) => {
      try {
        return await retainComposerImage(item);
      } catch {
        retentionFailed = true;
        return item;
      }
    }));
    setMedia((current) => [...current, ...retained].slice(0, MAX_MEDIA));
    if (retentionFailed) {
      setError("部分照片暂时无法复制到草稿目录；当前会话仍可发布，重启 App 前请完成或重新选择。");
    }
  }

  async function replaceImage(localId: string): Promise<void> {
    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("需要照片权限才能替换图片。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const current = media.find((item) => item.localId === localId);
    if (!current) return;
    invalidatePublishAttempt();
    const replacement = {
      ...createDraftMedia({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {})
      }, localId),
      altText: current.altText
    };
    try {
      const retained = await retainComposerImage(replacement);
      setMedia((items) => items.map((item) => item.localId === localId ? retained : item));
    } catch {
      setMedia((items) => items.map((item) => item.localId === localId ? replacement : item));
      setError("替换照片暂时无法复制到草稿目录；重启 App 前请完成发布或重新选择。");
    }
  }

  function invalidatePublishAttempt(): void {
    idempotencyRef.current = undefined;
  }

  // —— 序列化视觉装饰到正文（v2 没有对应后端字段前的过渡方案）——
  // —— 发布 ——
  async function publish(): Promise<void> {
    if (!isReady || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setError(undefined);
    try {
      const pending = pendingDraftMedia(media);
      if (pending.length > 0) {
        const pendingIds = new Set(pending.map((item) => item.localId));
        setMedia((current) => current.map((item) => pendingIds.has(item.localId)
          ? { ...item, status: "UPLOADING" as const, progress: item.progress ?? 0, error: undefined }
          : item));
      }
      let uploadPaused = false;
      const uploadResults = await Promise.allSettled(pending.map(async (item) => {
        const controller = new AbortController();
        uploadControllersRef.current.set(item.localId, controller);
        try {
          const mediaType = mediaTypeForMime(item.image.mimeType);
          const uploaded = await mediaClient.uploadMedia({
            ...item.image,
            mediaType,
            defaultMime: mediaType === "AUDIO" ? "audio/mp4" : mediaType === "VIDEO" ? "video/mp4" : "image/jpeg"
          }, {
            signal: controller.signal,
            ...(item.uploadSession ? { resumeSession: item.uploadSession } : {}),
            onProgress: (progress) => setMedia((current) => current.map((candidate) => candidate.localId === item.localId
              ? { ...candidate, progress }
              : candidate)),
            onSession: (uploadSession) => setMedia((current) => current.map((candidate) => candidate.localId === item.localId
              ? { ...candidate, uploadSession }
              : candidate))
          });
          setMedia((current) => current.map((candidate) => candidate.localId === item.localId
            ? { ...candidate, status: "READY" as const, progress: 1, mediaAssetId: uploaded.mediaAssetId, uploadSession: undefined, error: undefined }
            : candidate));
          return { localId: item.localId, mediaAssetId: uploaded.mediaAssetId };
        } catch (err) {
          const action = uploadActionsRef.current.get(item.localId);
          const paused = controller.signal.aborted && action === "PAUSE";
          if (paused) uploadPaused = true;
          const message = paused
            ? "上传已暂停，点击发布即可续传"
            : controller.signal.aborted
              ? "照片上传已取消"
              : err instanceof Error ? err.message : "上传失败";
          setMedia((current) => current.map((candidate) => candidate.localId === item.localId
            ? { ...candidate, status: paused ? "PAUSED" as const : "FAILED" as const, error: message }
            : candidate));
          throw err;
        } finally {
          uploadControllersRef.current.delete(item.localId);
          uploadActionsRef.current.delete(item.localId);
        }
      }));
      if (uploadResults.some((r) => r.status === "rejected")) {
        setError(uploadPaused
          ? "照片上传已暂停，草稿和断点均已保留；再次点击发布即可续传。"
          : "有照片上传或处理失败。失败项已保留，可直接重试；帖子尚未发布。");
        return;
      }
      const uploadedById = new Map(uploadResults.flatMap((r) => r.status === "fulfilled" ? [[r.value.localId, r.value.mediaAssetId] as const] : []));
      const completed = media.map((item) => {
        const id = uploadedById.get(item.localId) ?? item.mediaAssetId;
        return id ? { ...item, status: "READY" as const, progress: 1, mediaAssetId: id, uploadSession: undefined, error: undefined } : item;
      });
      setMedia(completed);
      const mediaRefs = draftMediaRefs(completed);
      if (completed.length > 0 && !mediaRefs) {
        setError("照片尚未全部就绪，帖子没有发布。请重试失败项。");
        return;
      }
      const finalBody = assembleComposerBody({
        body: threadedBody,
        gifWord,
        poll,
        place,
        topic,
        isGhost24h,
        quoteTarget,
        replyPerm,
        quotePerm
      });
      // 拼接 payload（交给 composer-publish 统一处理 ephemeralUntil / poll 字段映射）。
      // overrides：body / mediaRefs 由调用方指定（已 assemble 过 / 已上传完）。
      // FEED-OWN-001: 只传用户自己设过的真名；没设过就省略，绝不写死 "你"。
      const profileName = (await composerProfileStore.read().catch(() => undefined))?.name?.trim();
      const payload = buildCreatePostPayload(
        {
          body: threadedBody,
          media,
          visibility,
          includeCity,
          quoteTargetId: quoteTarget ? quoteId : null,
          place,
          topic,
          gifWord,
          poll,
          isGhost24h
        },
        quoteTarget,
        {
          body: finalBody,
          ...(mediaRefs && mediaRefs.length > 0 ? { mediaRefs } : {}),
          ...(profileName ? { authorDisplayName: profileName } : {})
        }
      );
      idempotencyRef.current ??= newPublishIdempotencyKey();
      await localNet.createPost(payload, idempotencyRef.current);
      // 重置
      setBody("");
      setThreadEntries([]);
      setMedia([]);
      setQuoteId(null);
      setPlace(null);
      setTopic(null);
      setGifWord(null);
      setPoll({ open: false, options: ["", ""], durationLabel: "1 天" });
      setIsGhost24h(false);
      setLongTextDraft("");
      setError(undefined);
      idempotencyRef.current = undefined;
      clearComposerDraft();
      showToast(isGhost24h ? "24h 动态已发布" : "已发布");
      await onPublished();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setIsAuthenticatedForWrite(false);
        setError("登录状态已失效，请重新验证账户后发布；草稿和媒体均已保留。");
      } else {
        setError(err instanceof Error ? err.message : "发布失败，请稍后重试。");
      }
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  function handleCancel(): void {
    if (hasAnyContent) {
      showToast("已保存到草稿");
    } else {
      showToast("已取消");
    }
    onClose();
  }

  function toggleComposer(): void {
    Keyboard.dismiss();
    onClose();
  }

  // @提及 插入位置。RN TextInput 通过 onSelectionChange 提供 caret 位置，
  // 拿不到 start/end 以外的精细状态。
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // 当 `body` 被程序改写（如 @提及 / 长文追加）时，同步选中点。
  function renderMediaGrid(): React.JSX.Element {
    // 预览里最多 4 个槽位；超过 4 时在第 4 个上叠 +N 角标
    // （用户需要从前面删除才能看到后面）。
    const visible = media.slice(0, 4);
    const hidden = Math.max(0, media.length - visible.length);
    const cls = media.length === 1 ? "one" : media.length === 2 ? "two" : "many";
    return (
      <View style={[styles.mediaGrid, cls === "one" ? styles.mediaGridOne : cls === "two" ? styles.mediaGridTwo : styles.mediaGridMany]}>
        {visible.map((item, index) => (
          <View key={item.localId} style={[styles.mediaCellWrap, cls === "one" ? styles.mediaCellWrapOne : null]}>
            <ComposerMediaCard
              index={index}
              item={item}
              itemCount={visible.length}
              onAltText={(alt) => {
                invalidatePublishAttempt();
                setMedia((current) => current.map((c) => c.localId === item.localId ? { ...c, altText: alt } : c));
              }}
              onCancel={() => {
                uploadActionsRef.current.set(item.localId, "CANCEL");
                uploadControllersRef.current.get(item.localId)?.abort();
                invalidatePublishAttempt();
                setMedia((current) => current.filter((c) => c.localId !== item.localId));
              }}
              onMove={(from, to) => {
                invalidatePublishAttempt();
                setMedia((current) => moveDraftMedia(current, from, to));
              }}
              onPause={() => {
                uploadActionsRef.current.set(item.localId, "PAUSE");
                uploadControllersRef.current.get(item.localId)?.abort();
              }}
              onRemove={() => {
                invalidatePublishAttempt();
                setMedia((current) => current.filter((c) => c.localId !== item.localId));
              }}
              onReplace={() => void replaceImage(item.localId)}
              publishing={publishing}
            />
            {hidden > 0 && index === visible.length - 1 ? (
              <View style={styles.mediaOverflowBadge}>
                <Text style={styles.mediaOverflowText}>+{hidden}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  // —— 视觉装饰 chip 行（地点 / 话题）——
  function renderChips(): React.JSX.Element {
    const list: Array<{ key: string; label: string; type: "place" | "topic"; onRemove: () => void }> = [];
    if (place) list.push({ key: "place", label: place.area, type: "place", onRemove: () => setPlace(null) });
    if (topic) list.push({ key: "topic", label: topic, type: "topic", onRemove: () => setTopic(null) });
    if (list.length === 0) return <></>;
    return (
      <View style={styles.chipRow}>
        {list.map((c) => (
          <Pressable key={c.key} onPress={c.onRemove} style={styles.chipActive}>
            {c.type === "place" ? (
              <ProxyIcon name="route" size={14} color={color.ink} />
            ) : (
              <Text style={styles.chipHash}>#</Text>
            )}
            <Text style={styles.chipActiveText}>{c.label}</Text>
            <Text style={styles.chipX}>×</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <Modal animationType="slide" onRequestClose={handleCancel} presentationStyle="fullScreen" visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <View style={{ height: insets.top }} />
        <View style={styles.topbar}>
          <Pressable accessibilityLabel="取消发帖" hitSlop={12} onPress={() => { Keyboard.dismiss(); handleCancel(); }} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Text style={styles.topbarTitle}>新动态</Text>
          <Pressable
            accessibilityLabel={publishing ? "发布中" : "发布动态"}
            accessibilityState={{ disabled: !isReady }}
            disabled={!isReady}
            onPress={() => void publish()}
            style={[styles.publishBtn, isReady ? styles.publishBtnReady : null]}
          >
            <Text style={[styles.publishBtnText, isReady ? styles.publishBtnTextReady : null]}>
              {publishing ? "发布中" : "发布"}
            </Text>
          </Pressable>
        </View>

        {/* R15.37: 未登录 / 离线 fallback 访客 的明确提示。
            发布按钮被 gate (见 isReady) 点不动; 报报说明为什么不能发布,
            提供 “去登录” 出口 避免用户在一个不能用的 composer 里干靠。 */}
        {secureSessionStore !== undefined && !isAuthenticatedForWrite ? (
          <View style={styles.authWall} accessibilityLiveRegion="polite">
            <Text style={styles.authWallTitle}>发布需登录</Text>
            <Text style={styles.authWallBody}>完成手机号 / 邮箱验证 或 Google 登录后, 才能在动态上发文、 送图。访客可以浏览、点赞、引用，但发布需要身份。</Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.composerBody} keyboardShouldPersistTaps="handled">
          <View style={styles.postRow}>
            <View style={styles.avatar}>
              <View style={styles.avatarArt}>
                <View style={styles.avatarHead} />
                <View style={styles.avatarBody} />
                <View style={styles.avatarBadge} />
              </View>
            </View>
            <View style={styles.postColumn}>
              <View style={styles.authorLine}>
                <Text style={styles.author}>Thanh</Text>
                <Text style={styles.handle}>@thanh</Text>
                {isGhost24h ? <View style={styles.modeBadge}><Text style={styles.modeBadgeText}>24h</Text></View> : null}
              </View>

              <TextInput
                autoFocus
                maxLength={MAX_BODY_LENGTH}
                multiline
                onChangeText={(v) => { invalidatePublishAttempt(); setBody(v); }}
                onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
                placeholder="分享此刻正在发生的事…"
                placeholderTextColor={color.muted}
                selection={selection}
                style={styles.textarea}
                value={body}
              />

              <View style={styles.attachments}>
                {renderChips()}
                {renderMediaGrid()}

                {gifWord ? (
                  <View style={styles.gifCard}>
                    <Text style={styles.gifWord}>{gifWord}</Text>
                    <View style={styles.gifLabel}><Text style={styles.gifLabelText}>GIF</Text></View>
                    <Pressable
                      accessibilityLabel="移除 GIF"
                      onPress={() => setGifWord(null)}
                      style={styles.gifRemove}
                    >
                      <ProxyIcon name="close" size={14} color="#fff" />
                    </Pressable>
                  </View>
                ) : null}

                {poll.open ? (
                  <View style={styles.pollCard}>
                    {poll.options.map((opt, idx) => (
                      <View key={idx} style={styles.pollRow}>
                        <TextInput
                          maxLength={50}
                          onChangeText={(v) => {
                            setPoll((p) => {
                              const next = [...p.options];
                              next[idx] = v;
                              return { ...p, options: next };
                            });
                          }}
                          placeholder={`选项 ${idx + 1}`}
                          placeholderTextColor={color.muted}
                          style={styles.pollInput}
                          value={opt}
                        />
                        <Pressable
                          disabled={poll.options.length <= 2}
                          onPress={() => setPoll((p) => ({ ...p, options: p.options.filter((_, i) => i !== idx) }))}
                          style={styles.pollX}
                        >
                          <Text style={styles.pollXText}>×</Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable
                      disabled={poll.options.length >= MAX_POLL_OPTIONS}
                      onPress={() => {
                        if (poll.options.length >= MAX_POLL_OPTIONS) {
                          showToast(`最多 ${MAX_POLL_OPTIONS} 个选项`);
                          return;
                        }
                        setPoll((p) => ({ ...p, options: [...p.options, ""] }));
                      }}
                      style={styles.pollAdd}
                    >
                      <Text style={styles.pollAddText}>＋ 添加选项</Text>
                    </Pressable>
                    <View style={styles.pollFoot}>
                      <Pressable onPress={() => setOpenSheet("pollDuration")} style={styles.pollDurationBtn}>
                        <Text style={styles.pollFootLabel}>投票时长 · {poll.durationLabel} ›</Text>
                      </Pressable>
                      <Pressable onPress={() => setPoll({ open: false, options: ["", ""], durationLabel: "1 天" })}>
                        <Text style={styles.pollRemove}>移除投票</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {quoteTarget ? (
                  <View style={styles.quoteCard}>
                    <View style={styles.quoteTag}>
                      <Text style={styles.quoteTagText}>引用帖文</Text>
                    </View>
                    <View style={styles.quoteHead}>
                      <View style={styles.quoteAvatar}>
                        <Text style={styles.quoteAvatarText}>{(quoteTarget.authorDisplayName ?? "·").charAt(0)}</Text>
                      </View>
                      <Text style={styles.quoteName}>{quoteTarget.authorDisplayName ?? "某人"}</Text>
                      <Text style={styles.quoteHandle}>@{quoteTarget.authorId}</Text>
                      <Pressable
                        accessibilityLabel="移除引用"
                        onPress={() => { invalidatePublishAttempt(); setQuoteId(null); }}
                        style={styles.quoteRemove}
                      >
                        <Text style={styles.quoteRemoveText}>移除</Text>
                      </Pressable>
                    </View>
                    <Text numberOfLines={3} style={styles.quoteText}>{quoteTarget.body}</Text>
                    <Text style={styles.quoteMeta}>{quoteTarget.cityScope === "hn" ? "Hanoi" : "—"} · {new Date(quoteTarget.createdAt).toLocaleString()}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {threadEntries.map((entry, idx) => (
            <View key={idx} style={styles.threadRow}>
              <Text style={styles.threadIndex}>{idx + 2}/</Text>
              <TextInput
                maxLength={MAX_BODY_LENGTH}
                onChangeText={(v) => {
                  invalidatePublishAttempt();
                  setThreadEntries((prev) => prev.map((t, i) => (i === idx ? v : t)));
                }}
                placeholder={`第 ${idx + 2} 条…`}
                placeholderTextColor={color.muted}
                style={styles.threadInput}
                value={entry}
                multiline
              />
              <Pressable
                accessibilityLabel={`删除第 ${idx + 2} 条`}
                onPress={() => { invalidatePublishAttempt(); setThreadEntries((prev) => prev.filter((_, i) => i !== idx)); }}
                style={styles.threadX}
              >
                <Text style={styles.threadXText}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            disabled={threadEntries.length >= MAX_THREAD_ENTRIES}
            onPress={() => {
              if (threadEntries.length >= MAX_THREAD_ENTRIES) {
                showToast(`最多 ${MAX_THREAD_ENTRIES} 条跟帖`);
                return;
              }
              invalidatePublishAttempt();
              setThreadEntries((prev) => [...prev, ""]);
              showToast("已添加下一条");
            }}
            style={styles.threadNext}
          >
            <View style={styles.threadPlus}>
              <ProxyIcon name="plus" size={13} color={color.muted} />
            </View>
            <Text style={styles.threadNextText}>添加下一条{threadEntries.length > 0 ? `（${threadEntries.length}/${MAX_THREAD_ENTRIES}）` : ""}</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {/* —— 底部工具栏：权限行 + 工具行 —— */}
        <View style={[styles.bottom, { paddingBottom: Math.max(9, insets.bottom) }]}>
          <View style={styles.permissions}>
            <Pressable accessibilityLabel={`谁可以回复：当前 ${replyPerm}`} onPress={() => setOpenSheet("reply")} style={styles.permission}>
              <ProxyIcon name="chat" size={17} color={color.muted} />
              <Text style={styles.permissionText}>{replyPerm}可回复</Text>
            </Pressable>
            <Pressable accessibilityLabel={`谁可以引用：当前 ${quotePerm}`} onPress={() => setOpenSheet("quote")} style={styles.permission}>
              <ProxyIcon name="mail" size={17} color={color.muted} />
              <Text style={styles.permissionText}>{quotePerm}可引用</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.toolbarContent} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.toolbar}>
            <TooltipOnLongPress label="引用其他人的帖文" onPress={() => setOpenSheet("quotePicker")}>
              <View style={[styles.quotePrimary, quoteId ? styles.quotePrimaryActive : null]}>
                <ProxyIcon name="route" size={16} color={quoteId ? "#fff" : color.ink} />
                <Text style={[styles.quotePrimaryText, quoteId ? styles.quotePrimaryTextActive : null]}>引用</Text>
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="添加照片" disabled={media.length >= MAX_MEDIA || publishing} onPress={() => void pickImages("library")}>
              <View style={[styles.tool, (media.length >= MAX_MEDIA || publishing) ? styles.toolDisabled : null]}>
                <ProxyIcon name="image" size={20} color={color.ink} />
                {media.length > 0 ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="添加 GIF 动图" onPress={() => setOpenSheet("gif")}>
              <View style={[styles.tool, gifWord ? styles.toolActive : null]}>
                <Text style={styles.gifToolText}>GIF</Text>
                {gifWord ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="添加投票" onPress={() => setPoll((p) => ({ ...p, open: !p.open }))}>
              <View style={[styles.tool, poll.open ? styles.toolActive : null]}>
                <PollIcon color={poll.open ? color.lime : color.ink} />
                {poll.open ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="插入 @ 提及" onPress={() => {
                const ins = "@Linh ";
                const { body: next, caret } = insertAtCaret(body, selection, ins);
                setBody(next);
                setTimeout(() => setSelection({ start: caret, end: caret }), 0);
                invalidatePublishAttempt();
              }}>
              <View style={styles.tool}>
                <Text style={styles.mentionText}>@</Text>
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="添加话题" onPress={() => setOpenSheet("topic")}>
              <View style={[styles.tool, topic ? styles.toolActive : null]}>
                <Text style={styles.topicText}>#</Text>
                {topic ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="录制语音" disabled={publishing || media.length >= MAX_MEDIA}>
              <VoiceToolButton
                disabled={publishing || media.length >= MAX_MEDIA}
                onDone={(recording) => {
                invalidatePublishAttempt();
                draftSequenceRef.current += 1;
                const localId = `draft_media_${Date.now().toString(36)}_${draftSequenceRef.current.toString(36)}`;
                const audioItem = {
                  localId,
                  image: {
                    uri: recording.uri,
                    mimeType: "audio/mp4",
                    width: 0,
                    height: 0
                  },
                  altText: `语音 ${Math.round(recording.durationMs / 1000)} 秒`,
                  status: "LOCAL" as const
                };
                setMedia((current) => [...current, audioItem].slice(0, MAX_MEDIA));
                showToast(`已添加语音 (${Math.round(recording.durationMs / 1000)}s)`);
              }}
            />
            </TooltipOnLongPress>

            <TooltipOnLongPress label="添加地点" onPress={() => setOpenSheet("location")}>
              <View style={[styles.tool, place ? styles.toolActive : null]}>
                <ProxyIcon name="route" size={20} color={color.ink} />
                {place ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <TooltipOnLongPress label="更多选项（24h临时、长文本等）" onPress={() => setOpenSheet("more")}>
              <View style={[styles.tool, isGhost24h ? styles.toolActive : null]}>
                <Text style={styles.moreText}>···</Text>
                {isGhost24h ? <View style={styles.dot} /> : null}
              </View>
            </TooltipOnLongPress>

            <Text
              accessibilityLabel={`正文有效长度 ${effectiveBodyLength}/${MAX_BODY_LENGTH}${showCountWarn ? "，接近上限" : ""}`}
              style={[styles.count, showCountWarn ? styles.countWarn : null]}
            >
              {effectiveBodyLength}/{MAX_BODY_LENGTH}
            </Text>
          </ScrollView>
        </View>

        {/* —— Toast —— */}
        {toast.visible ? (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        ) : null}

        {/* —— 引用长文编辑器 —— */}
        {longTextOpen ? (
          <Modal animationType="slide" onRequestClose={() => setLongTextOpen(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.longTextRoot}>
              <View style={styles.longTextHeader}>
                <Pressable
                  onPress={() => {
                    if (longTextDraft.trim()) {
                      Alert.alert(
                        "丢弃长文草稿？",
                        `当前编辑了 ${longTextDraft.length} 字，关闭后不会保留。`,
                        [
                          { text: "继续编辑", style: "cancel" },
                          { text: "丢弃", style: "destructive", onPress: () => { setLongTextDraft(""); setLongTextOpen(false); } }
                        ]
                      );
                    } else {
                      setLongTextOpen(false);
                    }
                  }}
                >
                  <Text style={styles.longTextCancel}>取消</Text>
                </Pressable>
                <Text style={styles.longTextTitle}>长文</Text>
                <Pressable
                  onPress={() => {
                    const { body: next, truncated } = appendLongText(body, longTextDraft, MAX_BODY_LENGTH * 4);
                    if (next === body) {
                      // room 为 0：extra 超长
                      setLongTextOpen(false);
                      showToast(`正文已达 ${MAX_BODY_LENGTH * 4} 字上限，不能再追加。`);
                      return;
                    }
                    setBody(next);
                    setTimeout(() => setSelection({ start: next.length, end: next.length }), 0);
                    setLongTextDraft("");
                    setLongTextOpen(false);
                    if (truncated) showToast("长文已追加，超出部分被截断。");
                    else showToast("已追加到正文");
                  }}
                >
                  <Text style={styles.longTextDone}>完成</Text>
                </Pressable>
              </View>
              <TextInput
                autoFocus
                multiline
                onChangeText={setLongTextDraft}
                placeholder="在这里写更长的正文…"
                placeholderTextColor={color.muted}
                style={styles.longTextInput}
                value={longTextDraft}
              />
              <View style={styles.longTextFoot}>
                <Text style={styles.longTextFootMeta}>
                  正文最多 {MAX_BODY_LENGTH * 4} 字。已用 {body.length}/{MAX_BODY_LENGTH * 4}{body.length > 0 ? "（追加到正文末尾）" : ""}
                </Text>
                <Text style={[styles.longTextCount, longTextDraft.length > MAX_BODY_LENGTH * 4 - body.length ? styles.longTextCountWarn : null]}>
                  {longTextDraft.length}/{MAX_BODY_LENGTH * 4 - body.length}
                </Text>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        ) : null}

        {/* —— 引用地点选择器（复用 v1 组件） —— */}
        <LocationPickerSheet
          current={place ?? DEFAULT_LOCATION_FALLBACK}
          onClose={() => setOpenSheet(null)}
          onSelect={(picked) => {
            setPlace(picked);
            setOpenSheet(null);
          }}
          open={openSheet === "location"}
        />

        {/* —— Sheets —— */}
        <Sheet visible={openSheet === "reply"} title="谁可以回复？" onClose={() => setOpenSheet(null)}>
          {(["所有人", "我关注的人", "仅提及的人"] as ReplyPermission[]).map((opt) => (
            <SheetOption
              key={opt}
              label={opt}
              selected={replyPerm === opt}
              onPress={() => { setReplyPerm(opt); setOpenSheet(null); }}
            />
          ))}
        </Sheet>

        <Sheet visible={openSheet === "quote"} title="谁可以引用？" onClose={() => setOpenSheet(null)}>
          {(["所有人", "我关注的人", "不允许"] as QuotePermission[]).map((opt) => (
            <SheetOption
              key={opt}
              label={opt}
              selected={quotePerm === opt}
              onPress={() => { setQuotePerm(opt); setOpenSheet(null); }}
            />
          ))}
        </Sheet>

        <Sheet visible={openSheet === "gif"} title="添加 GIF" onClose={() => setOpenSheet(null)}>
          <View style={styles.gifGrid}>
            {GIF_WORDS.map((w, i) => {
              // 按下标循环 alt 背景，避免出现 "仅 LOL/WOW/OK 有背景"
              const altStyle = i % 3 === 0
                ? styles.gifPickAlt1
                : i % 3 === 1
                  ? styles.gifPickAlt2
                  : styles.gifPickAlt3;
              const isSelected = gifWord === w;
              return (
                <Pressable
                  key={w}
                  accessibilityLabel={`选择 GIF：${w}${isSelected ? "，已选中" : ""}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => { setGifWord(w); setOpenSheet(null); }}
                  style={[styles.gifPick, altStyle, isSelected ? styles.gifPickSelected : null]}
                >
                  <Text style={styles.gifPickText}>{w}</Text>
                </Pressable>
              );
            })}
          </View>
        </Sheet>

        <Sheet visible={openSheet === "topic"} title="添加话题" onClose={() => setOpenSheet(null)}>
          {TOPIC_SUGGESTIONS.map((t) => (
            <SheetOption
              key={t}
              label={t}
              selected={topic === t}
              onPress={() => { setTopic(t); setOpenSheet(null); }}
            />
          ))}
        </Sheet>

        <Sheet visible={openSheet === "more"} title="更多" onClose={() => setOpenSheet(null)}>
          <SheetOption
            label="长文"
            description="附加更长的正文内容"
            showChevron
            onPress={() => { Keyboard.dismiss(); setLongTextOpen(true); setOpenSheet(null); }}
          />
          <SheetOption
            label="24h 动态"
            description="24 小时后自动从公开主页移除"
            selected={isGhost24h}
            onPress={() => { setIsGhost24h(!isGhost24h); setOpenSheet(null); showToast(isGhost24h ? "已关闭 24h" : "已设为 24h 动态"); }}
          />
        </Sheet>

        <Sheet visible={openSheet === "pollDuration"} title="投票时长" onClose={() => setOpenSheet(null)}>
          {POLL_DURATIONS.map((d) => (
            <SheetOption
              key={d}
              label={d}
              description={describePollDuration(d)}
              selected={poll.durationLabel === d}
              onPress={() => { setPoll((p) => ({ ...p, durationLabel: d })); setOpenSheet(null); }}
            />
          ))}
        </Sheet>

        <Sheet visible={openSheet === "quotePicker"} title="选择要引用的帖文" onClose={() => setOpenSheet(null)}>
          {posts.length === 0 ? (
            <View style={styles.quotePickerEmpty}>
              <Text style={styles.quotePickerEmptyText}>暂无可引用的帖文。退出后下拉刷新试试。</Text>
            </View>
          ) : (
            <QuotePickerSheetBody
              posts={posts}
              onPick={(postId) => {
                invalidatePublishAttempt();
                setQuoteId(postId);
                setOpenSheet(null);
                const target = posts.find((p) => p.postId === postId);
                showToast(`已引用 ${target?.authorDisplayName ?? "某人"}`);
              }}
            />
          )}
        </Sheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// —— 子组件：媒体卡（保留原 ComposerMediaCard 全部能力 + 适配 2 列宫格尺寸） ——

function ComposerMediaCard({
  item,
  index,
  itemCount,
  publishing,
  onAltText,
  onCancel,
  onMove,
  onPause,
  onRemove,
  onReplace
}: {
  item: DraftMediaItem;
  index: number;
  itemCount: number;
  publishing: boolean;
  onAltText: (altText: string) => void;
  onCancel: () => void;
  onMove: (from: number, to: number) => void;
  onPause: () => void;
  onRemove: () => void;
  onReplace: () => void;
}): React.JSX.Element {
  const dragX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const dragResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !publishing,
    onMoveShouldSetPanResponder: (_e, g) => !publishing && Math.abs(g.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_e, g) => dragX.setValue(g.dx),
    onPanResponderRelease: (_e, g) => {
      const target = draftMediaDragTarget(index, g.dx, COMPOSER_MEDIA_ITEM_SPAN, itemCount);
      dragX.setValue(0);
      setDragging(false);
      if (target !== index) onMove(index, target);
    },
    onPanResponderTerminate: () => { dragX.setValue(0); setDragging(false); }
  }), [dragX, index, itemCount, onMove, publishing]);

  return (
    <Animated.View style={[styles.mediaCard, dragging ? styles.mediaCardDragging : null, { transform: [{ translateX: dragX }] }]}>
      <View accessibilityLabel={`拖动第 ${index + 1} 张照片排序`} style={styles.mediaCardHandle} {...dragResponder.panHandlers}>
        <Text style={styles.mediaCardDragText}>第 {index + 1} 张</Text>
        <Text style={styles.mediaCardDragGlyph}>≡</Text>
      </View>
      <Image resizeMode="cover" source={{ uri: item.image.uri }} style={styles.mediaCardThumb} />
      <Text style={[styles.mediaCardStatus, item.status === "FAILED" ? styles.mediaCardStatusFailed : null]}>
        {mediaStatusLabel(item)}
      </Text>
      <TextInput
        editable={!publishing}
        maxLength={MAX_ALT_LENGTH}
        onChangeText={onAltText}
        placeholder="描述（可选）"
        placeholderTextColor={color.muted}
        style={styles.mediaCardAlt}
        value={item.altText}
      />
      <View style={styles.mediaCardActions}>
        <Pressable disabled={publishing || index === 0} onPress={() => onMove(index, index - 1)}>
          <Text style={[styles.mediaCardAction, index === 0 ? styles.actionDisabled : null]}>前移</Text>
        </Pressable>
        <Pressable disabled={publishing || index === itemCount - 1} onPress={() => onMove(index, index + 1)}>
          <Text style={[styles.mediaCardAction, index === itemCount - 1 ? styles.actionDisabled : null]}>后移</Text>
        </Pressable>
        {item.status === "UPLOADING" ? (
          <>
            <Pressable onPress={onPause}>
              <Text style={styles.mediaCardAction}>暂停</Text>
            </Pressable>
            <Pressable onPress={onCancel}>
              <Text style={styles.mediaCardRemove}>取消</Text>
            </Pressable>
          </>
        ) : (
          <Pressable disabled={publishing} onPress={onReplace}>
            <Text style={styles.mediaCardAction}>替换</Text>
          </Pressable>
        )}
        <Pressable disabled={publishing} onPress={onRemove}>
          <Text style={styles.mediaCardRemove}>移除</Text>
        </Pressable>
      </View>
      {item.error ? <Text numberOfLines={2} style={styles.mediaCardError}>{item.error}</Text> : null}
    </Animated.View>
  );
}

// —— 子组件：通用底部 Sheet ——

function Sheet({
  visible,
  title,
  onClose,
  children
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetGrab} />
        <Text style={styles.sheetTitle}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

function SheetOption({
  label,
  description,
  selected,
  showChevron,
  onPress
}: {
  label: string;
  description?: string;
  selected?: boolean;
  showChevron?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.sheetOption, selected ? styles.sheetOptionSelected : null]}>
      <View style={styles.sheetOptionText}>
        <Text style={styles.sheetOptionLabel}>{label}</Text>
        {description ? <Text style={styles.sheetOptionDesc}>{description}</Text> : null}
      </View>
      {showChevron ? <Text style={styles.sheetOptionRight}>›</Text> : null}
      {selected ? <Text style={styles.sheetOptionCheck}>✓</Text> : null}
    </Pressable>
  );
}

// —— 子组件：引用选择 sheet body（tabs + 搜索 + 列表）——

type QuoteFilter = "recommended" | "latest" | "local";

const QUOTE_FILTERS: ReadonlyArray<{ key: QuoteFilter; label: string }> = [
  { key: "recommended", label: "推荐" },
  { key: "latest", label: "最新" },
  { key: "local", label: "同城" }
];

function filterQuotePosts(posts: FeedPost[], filter: QuoteFilter): FeedPost[] {
  switch (filter) {
    case "latest":
      return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    case "local":
      return posts.filter((p) => p.cityScope === "hn");
    case "recommended":
    default:
      return posts;
  }
}

function QuotePickerSheetBody({
  posts,
  onPick
}: {
  posts: FeedPost[];
  onPick: (postId: string) => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState<QuoteFilter>("recommended");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const base = filterQuotePosts(posts, filter);
    if (!query.trim()) return base.slice(0, 20);
    const needle = query.trim().toLowerCase();
    return base
      .filter(
        (p) =>
          (p.body ?? "").toLowerCase().includes(needle) ||
          (p.authorDisplayName ?? "").toLowerCase().includes(needle) ||
          p.authorId.toLowerCase().includes(needle)
      )
      .slice(0, 20);
  }, [posts, filter, query]);

  return (
    <View>
      <View style={styles.quotePickerTabs}>
        {QUOTE_FILTERS.map((f) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.key }}
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.quotePickerTab, filter === f.key ? styles.quotePickerTabActive : null]}
          >
            <Text style={[styles.quotePickerTabText, filter === f.key ? styles.quotePickerTabTextActive : null]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="搜索引用帖文"
        onChangeText={setQuery}
        placeholder="搜索作者或正文关键词…"
        placeholderTextColor={color.muted}
        style={styles.quotePickerSearch}
        value={query}
      />
      {filtered.length === 0 ? (
        <View style={styles.quotePickerEmpty}>
          <Text style={styles.quotePickerEmptyText}>{query.trim() ? "无匹配结果" : "当前筛选下无帖文"}</Text>
        </View>
      ) : (
        <ScrollView style={styles.quotePickerScroll}>
          {filtered.map((post) => (
            <Pressable
              key={post.postId}
              onPress={() => onPick(post.postId)}
              style={styles.quotePickerItem}
            >
              <View style={styles.quotePickerHead}>
                <Text style={styles.quotePickerName}>{post.authorDisplayName ?? post.authorId}</Text>
                <Text style={styles.quotePickerMeta}>{formatRelativeTime(post.createdAt)}</Text>
              </View>
              <Text numberOfLines={2} style={styles.quotePickerBody}>
                {post.body || "（无正文）"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// 轻量相对时间格式化已迁出到 composer-body.ts (formatRelativeTime)，便于单测。

// —— 子组件：投票图标（SVG，避开 emoji 字体回退）——

function PollIcon({ color: c }: { color: string }): React.JSX.Element {
  return (
    <View style={styles.pollIconFrame}>
      <View style={[styles.pollIconBar, { backgroundColor: c, height: 7 }]} />
      <View style={[styles.pollIconBar, { backgroundColor: c, height: 12 }]} />
      <View style={[styles.pollIconBar, { backgroundColor: c, height: 9 }]} />
      <View style={[styles.pollIconBar, { backgroundColor: c, height: 14 }]} />
    </View>
  );
}

// —— 样式 ——

const styles = StyleSheet.create({
  root: { backgroundColor: color.surface, flex: 1 },
  // 顶栏
  topbar: {
    alignItems: "center",
    backgroundColor: color.white,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16
  },
  cancelBtn: { paddingVertical: 8, width: 88 },
  cancelText: { color: color.ink, fontSize: 15, fontWeight: "600" },
  topbarTitle: { color: color.ink, fontSize: 16, fontWeight: "700" },
  publishBtn: {
    alignItems: "center",
    backgroundColor: color.line,
    borderRadius: 18,
    height: 34,
    justifyContent: "center",
    minWidth: 68,
    paddingHorizontal: 16
  },
  publishBtnReady: { backgroundColor: color.ink },
  publishBtnText: { color: color.muted, fontSize: 14, fontWeight: "700" },
  publishBtnTextReady: { color: color.white },
  // R15.37: 未登录发不了帖子的提示条。
  //   与其他子页面的 “请先登录” 一致: 紫粉色填充 + 10pt 圆角 + 11px 文字。
  authWall: {
    backgroundColor: "#F4ECF4",
    borderColor: color.violet,
    borderRadius: 10,
    borderWidth: 1,
    margin: 12,
    marginBottom: 0,
    padding: 12
  },
  authWallTitle: {
    color: color.violet,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4
  },
  authWallBody: {
    color: color.ink,
    fontSize: 12,
    lineHeight: 18
  },
  // 主内容
  composerBody: { padding: 18, paddingBottom: 24 },
  postRow: { flexDirection: "row", gap: 12 },
  avatar: {
    backgroundColor: "#ECE7DD",
    borderColor: "#D7D1C7",
    borderRadius: 21,
    borderWidth: 1,
    height: 42,
    overflow: "hidden",
    width: 42
  },
  avatarArt: { alignItems: "center", height: "100%", justifyContent: "center", position: "relative", width: "100%" },
  avatarHead: { backgroundColor: "#191816", borderRadius: 7, height: 14, position: "absolute", top: 8, width: 14 },
  avatarBody: { backgroundColor: "#191816", bottom: 0, height: 16, left: 5, position: "absolute", right: 5 },
  avatarBadge: { backgroundColor: color.lime, borderRadius: 4, height: 9, position: "absolute", right: 4, top: 5, width: 9 },
  postColumn: { flex: 1 },
  authorLine: { alignItems: "center", flexDirection: "row", gap: 7, height: 24 },
  author: { color: color.ink, fontSize: 14, fontWeight: "700" },
  handle: { color: color.muted, fontSize: 13 },
  modeBadge: {
    backgroundColor: "#FFF0F6",
    borderRadius: 12,
    height: 23,
    justifyContent: "center",
    marginLeft: "auto",
    paddingHorizontal: 8
  },
  modeBadgeText: { color: "#7A0033", fontSize: 11, fontWeight: "700" },
  textarea: {
    color: color.ink,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 96,
    paddingTop: 6,
    textAlignVertical: "top"
  },
  attachments: { gap: 10, marginTop: 4 },
  // chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipActive: {
    alignItems: "center",
    backgroundColor: "#F8F5FA",
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 30,
    paddingHorizontal: 10
  },
  chipActiveText: { color: color.ink, fontSize: 12.5, fontWeight: "600" },
  chipX: { color: color.muted, fontSize: 12, opacity: 0.7 },
  chipHash: { color: color.ink, fontSize: 13, fontWeight: "800" },
  // media grid
  mediaGrid: { gap: 4 },
  mediaGridOne: { flexDirection: "column" },
  mediaGridTwo: { flexDirection: "row" },
  mediaGridMany: { flexDirection: "row", flexWrap: "wrap" },
  // 媒体卡 (2 列布局下, 单卡约 49% 宽；1 张图时取满宽)
  mediaCellWrap: { position: "relative", width: "49%" },
  mediaCellWrapOne: { width: "100%" },
  mediaOverflowBadge: {
    alignItems: "center",
    backgroundColor: "rgba(17,17,15,0.62)",
    borderRadius: 12,
    bottom: 8,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 9,
    paddingVertical: 3,
    position: "absolute",
    right: 0
  },
  mediaOverflowText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  mediaCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 8,
    padding: 8,
    width: "100%"
  },
  mediaCardDragging: { elevation: 8, opacity: 0.94, zIndex: 20 },
  mediaCardHandle: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 24 },
  mediaCardDragText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  mediaCardDragGlyph: { color: color.ink, fontSize: 16, fontWeight: "800" },
  mediaCardThumb: { backgroundColor: color.surface, borderRadius: 9, height: 96, marginTop: 4, width: "100%" },
  mediaCardStatus: { color: "#4F6840", fontSize: 11, fontWeight: "700", marginTop: 4 },
  mediaCardStatusFailed: { color: color.error },
  mediaCardAlt: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.ink,
    fontSize: 11,
    marginTop: 4,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  mediaCardActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  mediaCardAction: { color: color.violet, fontSize: 11, fontWeight: "700" },
  mediaCardRemove: { color: color.error, fontSize: 11, fontWeight: "700" },
  actionDisabled: { opacity: 0.4 },
  mediaCardError: { color: color.error, fontSize: 11, lineHeight: 14, marginTop: 2 },
  // GIF 卡
  gifCard: {
    aspectRatio: 16 / 9,
    backgroundColor: "#151515",
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative"
  },
  gifWord: { color: "#fff", fontSize: 48, fontWeight: "900", textAlign: "center", transform: [{ rotate: "-4deg" }] },
  gifLabel: { backgroundColor: "#fff", borderRadius: 6, bottom: 9, left: 10, paddingHorizontal: 5, paddingVertical: 3, position: "absolute" },
  gifLabelText: { color: "#111", fontSize: 11, fontWeight: "700" },
  gifRemove: {
    alignItems: "center",
    backgroundColor: "rgba(17,17,15,0.78)",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 28
  },
  // 投票卡
  pollCard: {
    backgroundColor: "#FFFDF6",
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    padding: 12
  },
  pollRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 8 },
  pollInput: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 10,
    borderWidth: 1,
    color: color.ink,
    flex: 1,
    fontSize: 13,
    height: 38,
    paddingHorizontal: 11
  },
  pollX: { alignItems: "center", height: 30, justifyContent: "center", width: 30 },
  pollXText: { color: "#aaa", fontSize: 18 },
  pollAdd: { paddingVertical: 6 },
  pollAddText: { color: color.muted, fontSize: 12.5, fontWeight: "600" },
  pollFoot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 8 },
  pollFootLabel: { color: color.muted, fontSize: 11.5 },
  pollRemove: { color: "#B36D31", fontSize: 11.5, fontWeight: "700" },
  pollDurationBtn: { paddingVertical: 2 },
  // 引用卡
  quoteCard: {
    backgroundColor: "#FFFAF0",
    borderColor: "#D9A33E",
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 13
  },
  quoteTag: {
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 12,
    height: 24,
    marginBottom: 10,
    paddingHorizontal: 8,
    justifyContent: "center"
  },
  quoteTagText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  quoteHead: { alignItems: "center", flexDirection: "row", gap: 7 },
  quoteAvatar: { alignItems: "center", backgroundColor: "#222", borderRadius: 12, height: 24, justifyContent: "center", width: 24 },
  quoteAvatarText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  quoteName: { color: color.ink, fontSize: 12.5, fontWeight: "700" },
  quoteHandle: { color: color.muted, fontSize: 12 },
  quoteRemove: { marginLeft: "auto", paddingHorizontal: 4, paddingVertical: 2 },
  quoteRemoveText: { color: color.error, fontSize: 11, fontWeight: "700" },
  quoteText: { color: color.ink, fontSize: 14, lineHeight: 20, marginTop: 9 },
  quoteMeta: { color: color.muted, fontSize: 11.5, marginTop: 8 },
  // 串帖
  threadNext: {
    alignItems: "center",
    color: color.muted,
    flexDirection: "row",
    fontSize: 13,
    gap: 10,
    marginLeft: 56,
    marginTop: 14,
    minHeight: 42
  },
  threadPlus: {
    alignItems: "center",
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26
  },
  threadNextText: { color: color.muted, fontSize: 13 },
  threadRow: { alignItems: "flex-start", flexDirection: "row", gap: 8, marginLeft: 56, marginTop: 10 },
  threadIndex: { color: color.muted, fontSize: 12, fontWeight: "800", marginTop: 12 },
  threadInput: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    color: color.ink,
    flex: 1,
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  threadX: { paddingHorizontal: 6, paddingVertical: 10 },
  threadXText: { color: color.muted, fontSize: 16, fontWeight: "700" },
  // 错误
  error: { color: color.error, fontSize: 12, marginTop: 8 },
  // 底部
  bottom: {
    backgroundColor: color.white,
    borderTopColor: color.line,
    borderTopWidth: 1,
    paddingBottom: 9,
    paddingHorizontal: 13,
    paddingTop: 7
  },
  permissions: { alignItems: "center", flexDirection: "row", gap: 8, paddingBottom: 4 },
  permission: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    height: 28,
    paddingHorizontal: 2
  },
  permissionText: { color: color.muted, fontSize: 12, fontWeight: "600" },
  // 工具栏
  toolbar: { height: 46 },
  toolbarContent: { alignItems: "center", paddingRight: 8 },
  tool: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    position: "relative",
    width: 40
  },
  toolActive: { backgroundColor: color.surface, borderRadius: 20 },
  toolDisabled: { opacity: 0.35 },
  dot: {
    backgroundColor: color.lime,
    borderRadius: 3,
    height: 6,
    position: "absolute",
    right: 5,
    top: 5,
    width: 6
  },
  count: { color: color.muted, fontSize: 12, marginRight: 8, minWidth: 42, textAlign: "right" },
  countWarn: { color: "#B9623D" },
  // 主工具按钮
  quotePrimary: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 17,
    flexDirection: "row",
    gap: 6,
    height: 34,
    justifyContent: "center",
    marginRight: 3,
    paddingHorizontal: 11
  },
  quotePrimaryActive: { backgroundColor: color.ink, borderColor: color.ink },
  quotePrimaryText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  quotePrimaryTextActive: { color: "#fff" },
  // 文本工具按钮
  gifToolText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  mentionText: { color: color.ink, fontSize: 18, fontWeight: "800" },
  topicText: { color: color.ink, fontSize: 18, fontWeight: "800" },
  moreText: { color: color.ink, fontSize: 22, fontWeight: "800", lineHeight: 22 },
  // 投票 icon
  pollIconFrame: { alignItems: "flex-end", flexDirection: "row", gap: 2, height: 16, width: 22 },
  pollIconBar: { borderRadius: 1, width: 3 },
  // Toast
  toast: {
    backgroundColor: color.ink,
    borderRadius: 18,
    bottom: 88,
    left: "50%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    position: "absolute",
    transform: [{ translateX: -50 }]
  },
  toastText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  // Sheet
  sheetBackdrop: {
    backgroundColor: "rgba(17,13,22,0.16)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  sheet: {
    backgroundColor: color.white,
    borderTopColor: color.line,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    bottom: 0,
    left: 0,
    padding: 16,
    paddingBottom: 24,
    position: "absolute",
    right: 0
  },
  sheetGrab: {
    alignSelf: "center",
    backgroundColor: color.line,
    borderRadius: 3,
    height: 4,
    marginBottom: 12,
    width: 36
  },
  sheetTitle: { color: color.ink, fontSize: 15, fontWeight: "700", marginBottom: 8 },
  sheetOption: {
    alignItems: "center",
    borderTopColor: color.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 50,
    paddingVertical: 8
  },
  sheetOptionSelected: { },
  sheetOptionText: { flex: 1 },
  sheetOptionLabel: { color: color.ink, fontSize: 14, fontWeight: "600" },
  sheetOptionDesc: { color: color.muted, fontSize: 11.5, marginTop: 2 },
  sheetOptionRight: { color: "#aaa", fontSize: 18, fontWeight: "500" },
  sheetOptionCheck: { color: color.ink, fontSize: 16, fontWeight: "800" },
  // GIF grid
  gifGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  gifPick: {
    alignItems: "center",
    aspectRatio: 1.3,
    backgroundColor: "#181818",
    borderRadius: 12,
    flexBasis: "48%",
    justifyContent: "center"
  },
  gifPickAlt1: { backgroundColor: "#2a2a2a" },
  gifPickAlt2: { backgroundColor: "#444" },
  gifPickAlt3: { backgroundColor: "#111" },
  gifPickSelected: { borderColor: color.lime, borderWidth: 2 },
  gifPickText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  // 长文编辑器
  longTextRoot: { backgroundColor: color.surface, flex: 1 },
  longTextHeader: {
    alignItems: "center",
    backgroundColor: color.white,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    height: 56,
    justifyContent: "space-between",
    paddingHorizontal: 16
  },
  longTextCancel: { color: color.ink, fontSize: 15, fontWeight: "600" },
  longTextTitle: { color: color.ink, fontSize: 16, fontWeight: "700" },
  longTextDone: { color: color.violet, fontSize: 15, fontWeight: "700" },
  longTextInput: {
    color: color.ink,
    flex: 1,
    fontSize: 17,
    lineHeight: 26,
    padding: 18,
    textAlignVertical: "top"
  },
  longTextFoot: {
    alignItems: "center",
    borderTopColor: color.line,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 8
  },
  longTextFootMeta: { color: color.muted, flex: 1, fontSize: 11, paddingRight: 12 },
  longTextCount: { color: color.muted, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "700" },
  longTextCountWarn: { color: color.error },
  // 引用选择 sheet
  quotePickerScroll: { marginTop: 4, maxHeight: 360 },
  quotePickerItem: {
    borderTopColor: color.line,
    borderTopWidth: 1,
    paddingVertical: 10
  },
  quotePickerHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  quotePickerName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  quotePickerMeta: { color: color.muted, fontSize: 11 },
  quotePickerBody: { color: color.ink, fontSize: 13, lineHeight: 18, marginTop: 4 },
  quotePickerEmpty: { alignItems: "center", padding: 20 },
  quotePickerEmptyText: { color: color.muted, fontSize: 12 },
  quotePickerTabs: { flexDirection: "row", gap: 6, marginBottom: 8 },
  quotePickerTab: {
    alignItems: "center",
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  quotePickerTabActive: { backgroundColor: color.ink, borderColor: color.ink },
  quotePickerTabText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  quotePickerTabTextActive: { color: "#fff" },
  quotePickerSearch: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 10,
    borderWidth: 1,
    color: color.ink,
    fontSize: 13,
    marginBottom: 8,
    paddingHorizontal: 11,
    paddingVertical: 8
  }
});
