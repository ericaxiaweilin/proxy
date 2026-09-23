import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VoiceToolButton } from "../components/VoiceToolButton";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";
import { ProxyIcon } from "../components/proxy-icon";
import type { ConversationClient, ConversationInboxItem, Meetup } from "../conversation-client";
import type { MediaClient } from "../media-client";
import type { ProfileClient, ProfileWire } from "../profile-client";
import { color, foundation } from "../theme";

// ROOM-CREATE-001（2026-09-22，用户原型 deepseek_html_20260922_c2625e.html
// 「房间」页）：真实 GROUP conversation 聊天 + 见面邀约状态机（ProposeMeetup
// /AcceptMeetup/NudgeMeetup/ArriveMeetup/CompleteMeetup，见服务端 room.go）。
//
// 没做的（原型里有，本轮不做，理由跟 AI 分身的图库/帖文编排收窄同一套——
// 宁可留白也不做"点了没反应"的假交互）：
//   · AI 场控员（"小助手"自动联系/推荐地点/发提醒）——需要真实 AI agent
//     编排，2026-09-22 用户决定先做人工发起 + 状态机，AI 场控员留到下一轮。
//   · "⋯" 更多菜单 / 场景banner"修改"按钮——没有对应的服务端命令
//     （改场景/群管理），不伪造下拉菜单。
//   · "+" 更多附件入口——原型里本身也只是弹 toast，没有真功能；相机（图片）
//     已经是真实附件，语音走 VoiceToolButton，够用了。

type WireProxyObject = { objectType?: string; objectId?: string; snapshot?: Record<string, unknown>; liveState?: Record<string, unknown> };
type WireMessage = {
  messageId: string;
  senderId: string;
  senderSnapshot?: { displayName?: string; avatarRef?: string };
  messageType: string;
  body?: string;
  mediaRef?: string;
  proxyObject?: WireProxyObject;
  createdAt: string;
};

const MEET_SCENE_OPTIONS: ReadonlyArray<{ emoji: string; sceneName: string; place: string }> = [
  { emoji: "📷", sceneName: "City Walk + 拍照", place: "老城区 · 湖畔咖啡馆" },
  { emoji: "☕", sceneName: "咖啡 + 聊天", place: "日落咖啡" },
  { emoji: "🖼️", sceneName: "一起看展", place: "美术馆" },
  { emoji: "🎲", sceneName: "桌游局", place: "桌游吧" },
];
const MEET_TIME_OPTIONS: ReadonlyArray<string> = ["今天 15:00", "今天 17:00", "明天 10:00", "明天 14:00", "明天 16:00"];
const QUICK_REPLIES: ReadonlyArray<{ label: string; text: string }> = [
  { label: "👋 大家好啊！", text: "大家好啊！" },
  { label: "⏰ 什么时候方便？", text: "什么时候方便？" },
  { label: "📍 在哪碰头？", text: "在哪碰头？" },
];

export function RoomSurface({ conversationId, conversationClient, mediaClient, profileClient, presentation = "modal", visible, onClose }: {
  // HOME-MORE-ROOMS-002: 从「更多 → 聊天房」进房时叠在「更多」整页 Modal 里（overlay）；
  // 从消息页进房仍是独立 Modal。
  presentation?: "modal" | "overlay";
  conversationId: string;
  conversationClient: ConversationClient;
  mediaClient: MediaClient;
  profileClient: ProfileClient;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const safeArea = useSafeAreaInsets();
  const [conv, setConv] = useState<ConversationInboxItem>();
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [actorId, setActorId] = useState<string>();
  const [profiles, setProfiles] = useState<Map<string, ProfileWire>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [meetSheetOpen, setMeetSheetOpen] = useState(false);
  const [meetSceneIndex, setMeetSceneIndex] = useState(0);
  const [meetTimeIndex, setMeetTimeIndex] = useState(0);
  const [meetPlace, setMeetPlace] = useState(MEET_SCENE_OPTIONS[0]!.place);
  const [meetBusy, setMeetBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [inbox, msgResult] = await Promise.all([
        conversationClient.listConversations(),
        conversationClient.listMessages(conversationId),
      ]);
      const found = inbox.find((item) => item.conversation.conversationId === conversationId);
      if (found) setConv(found);
      const payload = typeof msgResult.operationRef === "string" ? JSON.parse(msgResult.operationRef) as { messages?: WireMessage[]; actorId?: string } : {};
      if (Array.isArray(payload.messages)) setMessages(payload.messages);
      if (payload.actorId) setActorId(payload.actorId);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载房间失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [conversationClient, conversationId]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let foreground = AppState.currentState === "active";
    const tick = async (): Promise<void> => { if (foreground && !cancelled) await refresh(); };
    setLoading(true);
    void tick();
    const timer = setInterval(() => void tick(), 3_000);
    const sub = AppState.addEventListener("change", (state) => { foreground = state === "active"; if (foreground) void tick(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [visible, refresh]);

  const participants = conv?.conversation.participants ?? [];
  useEffect(() => {
    if (participants.length === 0) return;
    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled(participants.map((id) => profileClient.getProfile(id)));
      if (cancelled) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        settled.forEach((result, index) => { if (result.status === "fulfilled") next.set(participants[index]!, result.value); });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.join(","), profileClient]);

  function displayName(userId: string | undefined): string {
    if (!userId) return "";
    if (userId === actorId) return "我";
    return profiles.get(userId)?.name || userId;
  }
  function avatarUri(userId: string | undefined): string | undefined {
    const path = userId ? profiles.get(userId)?.avatarPath : undefined;
    return path ? `${conversationClient.baseUrl}/v1/media/thumb/${encodeURIComponent(path)}` : undefined;
  }

  async function sendText(text: string): Promise<void> {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await conversationClient.sendMessage(conversationId, body);
      setDraft("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  async function sendPhoto(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("请允许 Proxy 读取照片才能发送图片。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.uri) return;
    setSending(true);
    try {
      const uploaded = await mediaClient.uploadImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width ?? 0, height: asset.height ?? 0 });
      await conversationClient.sendImageMessage(conversationId, uploaded.mediaAssetId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(recording: { uri: string; durationMs: number }): Promise<void> {
    setSending(true);
    try {
      const uploaded = await mediaClient.uploadMedia({ uri: recording.uri, width: 0, height: 0, durationMs: recording.durationMs, mediaType: "AUDIO", defaultMime: "audio/m4a" });
      await conversationClient.sendAudioMessage(conversationId, uploaded.mediaAssetId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "语音发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  function openMeetSheet(): void {
    setMeetSceneIndex(0);
    setMeetTimeIndex(0);
    setMeetPlace(MEET_SCENE_OPTIONS[0]!.place);
    setMeetSheetOpen(true);
  }

  async function sendMeetInvite(): Promise<void> {
    if (meetBusy) return;
    setMeetBusy(true);
    try {
      const scene = MEET_SCENE_OPTIONS[meetSceneIndex]!;
      await conversationClient.proposeMeetup(conversationId, {
        sceneEmoji: scene.emoji, sceneName: scene.sceneName,
        place: meetPlace.trim() || scene.place, timeLabel: MEET_TIME_OPTIONS[meetTimeIndex]!,
      });
      setMeetSheetOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发起见面失败，请重试");
    } finally {
      setMeetBusy(false);
    }
  }

  async function acceptActiveMeetup(meetupId: string): Promise<void> {
    setMeetBusy(true);
    try { await conversationClient.acceptMeetup(conversationId, meetupId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setMeetBusy(false); }
  }

  async function nudgeActiveMeetup(meetupId: string): Promise<void> {
    setMeetBusy(true);
    try { await conversationClient.nudgeMeetup(conversationId, meetupId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setMeetBusy(false); }
  }

  async function arriveActiveMeetup(meetupId: string): Promise<void> {
    setMeetBusy(true);
    try { await conversationClient.arriveMeetup(conversationId, meetupId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setMeetBusy(false); }
  }

  async function completeActiveMeetup(meetupId: string): Promise<void> {
    setMeetBusy(true);
    try { await conversationClient.completeMeetup(conversationId, meetupId); await refresh(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setMeetBusy(false); }
  }

  const meetup: Meetup | undefined = conv?.activeMeetup;
  const roomScene = conv?.conversation.roomScene;
  const roomName = roomScene?.roomName || "群聊";

  const body = (
    <View style={[styles.root, presentation === "overlay" && styles.overlay, { paddingTop: safeArea.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回" hitSlop={12} onPress={onClose} style={styles.headerBack}>
          <Text selectable style={styles.headerBackText}>‹</Text>
        </Pressable>
        <View style={styles.headerInfo}>
          <Text selectable style={styles.headerName} numberOfLines={1}>{roomName}</Text>
          <Text selectable style={styles.headerSub}>{participants.length} 人</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={color.muted} /></View>
      ) : (
        <>
          {roomScene ? (
            <View style={styles.sceneBanner}>
              <Text selectable style={styles.sceneBannerEmoji}>{roomScene.emoji}</Text>
              <View style={styles.sceneBannerInfo}>
                <Text selectable style={styles.sceneBannerTitle}>{roomScene.sceneName}</Text>
                <Text selectable style={styles.sceneBannerDetail}>{roomScene.sceneDesc}</Text>
              </View>
            </View>
          ) : null}

          {meetup ? <MeetStatusBar busy={meetBusy} meetup={meetup} onArrive={() => void arriveActiveMeetup(meetup.meetupId)} onComplete={() => void completeActiveMeetup(meetup.meetupId)} onNudge={() => void nudgeActiveMeetup(meetup.meetupId)} selfIsProposer={meetup.proposerId === actorId} /> : null}

          {/* SWIPE-RAIL-001：成员头像横滑不能触发外层切页。子项无按钮，轻点选择文本不受影响。 */}
          <HorizontalSwipeRail contentContainerStyle={styles.membersStripContent} preserveChildPresses style={styles.membersStrip} threshold={3}>
            {participants.map((id) => {
              const uri = avatarUri(id);
              return (
                <View key={id} style={styles.memberItem}>
                  {uri ? <Image source={{ uri }} style={styles.memberAvatar} /> : (
                    <View style={styles.memberAvatarFallback}><Text selectable style={styles.memberAvatarFallbackText}>{displayName(id).slice(0, 1)}</Text></View>
                  )}
                  <Text selectable numberOfLines={1} style={styles.memberName}>{displayName(id)}</Text>
                </View>
              );
            })}
          </HorizontalSwipeRail>

          <ScrollView
            contentContainerStyle={styles.chatContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            ref={scrollRef}
            style={styles.chat}
          >
            {messages.map((m) => (
              <MessageRow
                key={m.messageId}
                isOwn={m.senderId === actorId}
                meetup={meetup}
                message={m}
                onAccept={() => void acceptActiveMeetup(m.proxyObject?.objectId ?? "")}
                senderName={displayName(m.senderId)}
                meetupActionsBusy={meetBusy}
                baseUrl={conversationClient.baseUrl}
                selfId={actorId}
              />
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.quickReplies} horizontal showsHorizontalScrollIndicator={false}>
            {!meetup ? (
              <Pressable accessibilityLabel="发起见面" onPress={openMeetSheet} style={[styles.qrBtn, styles.qrBtnMeet]}>
                <Text selectable style={styles.qrBtnMeetText}>📍 发起见面</Text>
              </Pressable>
            ) : null}
            {QUICK_REPLIES.map((qr) => (
              <Pressable accessibilityLabel={qr.label} key={qr.text} onPress={() => void sendText(qr.text)} style={styles.qrBtn}>
                <Text selectable style={styles.qrBtnText}>{qr.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {error ? <Text selectable style={styles.error}>{error}</Text> : null}

          <View style={styles.inputBar}>
            <Pressable accessibilityLabel="发送图片" disabled={sending} onPress={() => void sendPhoto()} style={styles.inputIconBtn}>
              <ProxyIcon color={foundation.ink} name="camera" size={22} />
            </Pressable>
            <TextInput
              accessibilityLabel="消息"
              onChangeText={setDraft}
              placeholder="消息"
              placeholderTextColor={color.muted}
              style={styles.textInput}
              value={draft}
            />
            {draft.trim() ? (
              <Pressable accessibilityLabel="发送" disabled={sending} onPress={() => void sendText(draft)} style={styles.sendBtn}>
                <Text selectable style={styles.sendBtnText}>发送</Text>
              </Pressable>
            ) : (
              <VoiceToolButton disabled={sending} onDone={(recording) => void sendVoice(recording)} />
            )}
          </View>
        </>
      )}

      {meetSheetOpen ? (
        <Pressable accessibilityLabel="关闭发起见面" onPress={() => setMeetSheetOpen(false)} style={styles.sheetBackdrop}>
          <View onStartShouldSetResponder={() => true} style={[styles.meetSheet, { paddingBottom: safeArea.bottom + 16 }]}>
            <View style={styles.sheetGrab} />
            <Text selectable style={styles.sheetTitle}>发起线下见面</Text>
            <Text selectable style={styles.sheetSub}>房间成员会收到邀请，全部同意后生效</Text>

            <Text selectable style={styles.sheetLabel}>选场景</Text>
            <View style={styles.meetSceneGrid}>
              {MEET_SCENE_OPTIONS.map((option, index) => (
                <Pressable
                  accessibilityLabel={`选择场景 ${option.sceneName}`}
                  key={option.sceneName}
                  onPress={() => { setMeetSceneIndex(index); setMeetPlace(option.place); }}
                  style={[styles.meetSceneOpt, index === meetSceneIndex && styles.meetSceneOptSelected]}
                >
                  <Text selectable style={styles.meetSceneEmoji}>{option.emoji}</Text>
                  <Text selectable style={styles.meetSceneName}>{option.sceneName}</Text>
                </Pressable>
              ))}
            </View>

            <Text selectable style={styles.sheetLabel}>选时间</Text>
            <View style={styles.meetTimeChips}>
              {MEET_TIME_OPTIONS.map((option, index) => (
                <Pressable
                  accessibilityLabel={`选择时间 ${option}`}
                  key={option}
                  onPress={() => setMeetTimeIndex(index)}
                  style={[styles.meetTimeChip, index === meetTimeIndex && styles.meetTimeChipSelected]}
                >
                  <Text selectable style={[styles.meetTimeChipText, index === meetTimeIndex && styles.meetTimeChipTextSelected]}>{option}</Text>
                </Pressable>
              ))}
            </View>

            <Text selectable style={styles.sheetLabel}>碰头地点</Text>
            <TextInput accessibilityLabel="碰头地点" onChangeText={setMeetPlace} style={styles.meetPlaceInput} value={meetPlace} />

            <View style={styles.meetSheetFooter}>
              <Pressable accessibilityLabel="取消" onPress={() => setMeetSheetOpen(false)} style={[styles.meetFooterBtn, styles.meetFooterBtnSecondary]}>
                <Text selectable style={styles.meetFooterBtnSecondaryText}>取消</Text>
              </Pressable>
              <Pressable accessibilityLabel="发到房间" disabled={meetBusy} onPress={() => void sendMeetInvite()} style={[styles.meetFooterBtn, styles.meetFooterBtnPrimary]}>
                <Text selectable style={styles.meetFooterBtnPrimaryText}>{meetBusy ? "发送中…" : "发到房间"}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );

  if (presentation === "overlay") return visible ? body : null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      {body}
    </Modal>
  );
}

function MeetStatusBar({ meetup, selfIsProposer, busy, onNudge, onArrive, onComplete }: {
  meetup: Meetup; selfIsProposer: boolean; busy: boolean;
  onNudge: () => void; onArrive: () => void; onComplete: () => void;
}): React.JSX.Element {
  if (meetup.status === "PENDING") {
    return (
      <View style={[styles.meetStatusBar, styles.meetStatusBarPending]}>
        <Text selectable style={styles.meetStatusIcon}>⏰</Text>
        <View style={styles.meetStatusInfo}>
          <Text selectable style={styles.meetStatusTitle}>等待成员接受见面</Text>
          <Text selectable style={styles.meetStatusDesc}>{meetup.timeLabel} · {meetup.place}</Text>
        </View>
        {selfIsProposer ? (
          <Pressable accessibilityLabel="催一下" disabled={busy} onPress={onNudge} style={styles.meetStatusActionOutline}>
            <Text selectable style={styles.meetStatusActionOutlineText}>催一下</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (meetup.status === "CONFIRMED") {
    return (
      <View style={[styles.meetStatusBar, styles.meetStatusBarConfirmed]}>
        <Text selectable style={styles.meetStatusIcon}>✅</Text>
        <View style={styles.meetStatusInfo}>
          <Text selectable style={styles.meetStatusTitle}>已约定 · 记得准时</Text>
          <Text selectable style={styles.meetStatusDesc}>{meetup.timeLabel} · {meetup.place}</Text>
        </View>
        <Pressable accessibilityLabel="我已到达" disabled={busy} onPress={onArrive} style={styles.meetStatusActionGreen}>
          <Text selectable style={styles.meetStatusActionGreenText}>📍 我已到达</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.meetStatusBar, styles.meetStatusBarOngoing]}>
      <Text selectable style={styles.meetStatusIcon}>🟢</Text>
      <View style={styles.meetStatusInfo}>
        <Text selectable style={[styles.meetStatusTitle, styles.meetStatusTitleOngoing]}>进行中 · 已见面</Text>
        <Text selectable style={[styles.meetStatusDesc, styles.meetStatusDescOngoing]}>{meetup.timeLabel} · {meetup.place}</Text>
      </View>
      <Pressable accessibilityLabel="结束见面" disabled={busy} onPress={onComplete} style={styles.meetStatusActionDark}>
        <Text selectable style={styles.meetStatusActionDarkText}>✅ 结束</Text>
      </Pressable>
    </View>
  );
}

function MessageRow({ message, isOwn, senderName, meetup, meetupActionsBusy, onAccept, baseUrl, selfId }: {
  message: WireMessage; isOwn: boolean; senderName: string; meetup: Meetup | undefined;
  meetupActionsBusy: boolean; onAccept: () => void; baseUrl: string; selfId: string | undefined;
}): React.JSX.Element {
  if (message.messageType === "SYSTEM_CONTEXT") {
    return <View style={styles.sysMsgWrap}><Text selectable style={styles.sysMsg}>{message.body}</Text></View>;
  }
  if (message.messageType === "STRUCTURED_SUGGESTION" && message.proxyObject?.objectType === "invitation") {
    const snapshot = message.proxyObject.snapshot ?? {};
    const isLive = meetup !== undefined && meetup.meetupId === message.proxyObject.objectId;
    const status = isLive ? meetup.status : "COMPLETED";
    const alreadyAccepted = isLive && selfId !== undefined && meetup.acceptedBy.includes(selfId);
    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowMe]}>
        <View style={styles.meetInviteCard}>
          <Text selectable style={styles.meetInviteBadge}>📍 见面邀约</Text>
          <Text selectable style={styles.meetInviteTitle}>{String(snapshot.sceneEmoji ?? "")} {String(snapshot.sceneName ?? "")}</Text>
          <View style={styles.meetInviteRow}><Text selectable style={styles.meetInviteLabel}>时间</Text><Text selectable style={styles.meetInviteValue}>{String(snapshot.timeLabel ?? "")}</Text></View>
          <View style={styles.meetInviteRow}><Text selectable style={styles.meetInviteLabel}>地点</Text><Text selectable style={styles.meetInviteValue}>{String(snapshot.place ?? "")}</Text></View>
          {isLive && status === "PENDING" && !isOwn && !alreadyAccepted ? (
            <Pressable accessibilityLabel="接受见面邀约" disabled={meetupActionsBusy} onPress={onAccept} style={styles.meetInviteAcceptBtn}>
              <Text selectable style={styles.meetInviteAcceptText}>接受</Text>
            </Pressable>
          ) : (
            <Text selectable style={styles.meetInviteStatusText}>{status === "PENDING" ? "等待接受" : status === "CONFIRMED" ? "✓ 已约定" : status === "ONGOING" ? "进行中" : "已结束"}</Text>
          )}
        </View>
      </View>
    );
  }
  if (message.messageType === "IMAGE" && message.mediaRef) {
    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowMe]}>
        {!isOwn ? <Text selectable style={styles.msgName}>{senderName}</Text> : null}
        <Image contentFit="cover" source={{ uri: `${baseUrl}/v1/media/thumb/${encodeURIComponent(message.mediaRef)}` }} style={styles.msgImage} />
      </View>
    );
  }
  if (message.messageType === "AUDIO" && message.mediaRef) {
    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowMe]}>
        {!isOwn ? <Text selectable style={styles.msgName}>{senderName}</Text> : null}
        <ChatAudio uri={`${baseUrl}/v1/media/play/${encodeURIComponent(message.mediaRef)}`} />
      </View>
    );
  }
  return (
    <View style={[styles.msgRow, isOwn && styles.msgRowMe]}>
      {!isOwn ? <Text selectable style={styles.msgName}>{senderName}</Text> : null}
      <View style={[styles.msgBubble, isOwn && styles.msgBubbleMe]}>
        <Text selectable style={[styles.msgBubbleText, isOwn && styles.msgBubbleTextMe]}>{message.body}</Text>
      </View>
    </View>
  );
}

function ChatAudio({ uri }: { uri: string }): React.JSX.Element {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const player = createAudioPlayer({ uri });
    playerRef.current = player;
    const subscription = player.addListener("playbackStatusUpdate", (status) => { if (status.didJustFinish) setPlaying(false); });
    return () => { subscription.remove(); player.remove(); playerRef.current = null; };
  }, [uri]);
  return (
    <Pressable
      accessibilityLabel={playing ? "暂停语音" : "播放语音"}
      onPress={() => { const player = playerRef.current; if (!player) return; if (playing) player.pause(); else player.play(); setPlaying(!playing); }}
      style={styles.audioBubble}
    >
      <Text selectable style={styles.audioBubbleGlyph}>{playing ? "❚❚" : "▶"}</Text>
      <Text selectable style={styles.audioBubbleLabel}>语音</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  header: { alignItems: "center", borderBottomColor: color.cardBorder, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  headerBack: { alignItems: "center", height: 30, justifyContent: "center", width: 26 },
  headerBackText: { color: foundation.ink, fontSize: 24, fontWeight: "600" },
  headerInfo: { flex: 1 },
  headerName: { color: foundation.ink, fontSize: 15, fontWeight: "800" },
  headerSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  centerFill: { alignItems: "center", flex: 1, justifyContent: "center" },

  sceneBanner: { alignItems: "center", backgroundColor: "#1a1a1a", borderRadius: 16, flexDirection: "row", gap: 12, margin: 12, padding: 14 },
  sceneBannerEmoji: { fontSize: 26 },
  sceneBannerInfo: { flex: 1 },
  sceneBannerTitle: { color: color.white, fontSize: 14, fontWeight: "800", marginBottom: 3 },
  sceneBannerDetail: { color: "rgba(255,255,255,0.65)", fontSize: 11 },

  meetStatusBar: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 12, marginHorizontal: 12, marginBottom: 12, padding: 12 },
  meetStatusBarPending: { backgroundColor: "#fff8e6" },
  meetStatusBarConfirmed: { backgroundColor: "#eef7f0" },
  meetStatusBarOngoing: { backgroundColor: "#1a1a1a" },
  meetStatusIcon: { fontSize: 20 },
  meetStatusInfo: { flex: 1 },
  meetStatusTitle: { color: foundation.ink, fontSize: 13, fontWeight: "800", marginBottom: 2 },
  meetStatusTitleOngoing: { color: color.white },
  meetStatusDesc: { color: color.muted, fontSize: 11 },
  meetStatusDescOngoing: { color: "rgba(255,255,255,0.7)" },
  meetStatusActionOutline: { backgroundColor: "transparent", borderColor: "#f0e4d4", borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  meetStatusActionOutlineText: { color: "#a06a2c", fontSize: 12, fontWeight: "800" },
  meetStatusActionGreen: { backgroundColor: "#4caf7d", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  meetStatusActionGreenText: { color: color.white, fontSize: 12, fontWeight: "800" },
  meetStatusActionDark: { backgroundColor: color.white, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  meetStatusActionDarkText: { color: foundation.ink, fontSize: 12, fontWeight: "800" },

  membersStrip: { borderBottomColor: color.cardBorder, borderBottomWidth: 1, borderTopColor: color.cardBorder, borderTopWidth: 1, flexGrow: 0 },
  membersStripContent: { alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  memberItem: { alignItems: "center", width: 44 },
  memberAvatar: { borderRadius: 20, height: 40, width: 40 },
  memberAvatarFallback: { alignItems: "center", backgroundColor: color.chipNeutralBg, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  memberAvatarFallbackText: { color: foundation.ink, fontSize: 13, fontWeight: "800" },
  memberName: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 3 },

  chat: { flex: 1 },
  chatContent: { gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sysMsgWrap: { alignItems: "center" },
  sysMsg: { backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 12, color: color.muted, fontSize: 11, fontWeight: "500", paddingHorizontal: 12, paddingVertical: 5 },
  msgRow: { alignItems: "flex-start" },
  msgRowMe: { alignItems: "flex-end" },
  msgName: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 2, paddingHorizontal: 4 },
  msgBubble: { backgroundColor: color.white, borderColor: "#f0f0f0", borderRadius: 16, borderWidth: 1, maxWidth: "78%", paddingHorizontal: 14, paddingVertical: 10 },
  msgBubbleMe: { backgroundColor: "#1a1a1a", borderWidth: 0 },
  msgBubbleText: { color: foundation.ink, fontSize: 14, lineHeight: 19 },
  msgBubbleTextMe: { color: color.white },
  msgImage: { borderRadius: 12, height: 160, width: 160 },
  audioBubble: { alignItems: "center", backgroundColor: color.white, borderColor: "#f0f0f0", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  audioBubbleGlyph: { color: foundation.ink, fontSize: 13 },
  audioBubbleLabel: { color: color.muted, fontSize: 12, fontWeight: "700" },

  meetInviteCard: { backgroundColor: color.white, borderColor: foundation.ink, borderRadius: 16, borderWidth: 1.5, maxWidth: 280, padding: 16 },
  meetInviteBadge: { color: color.muted, fontSize: 11, fontWeight: "800", marginBottom: 6 },
  meetInviteTitle: { color: foundation.ink, fontSize: 14, fontWeight: "800", marginBottom: 10 },
  meetInviteRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  meetInviteLabel: { color: color.muted, fontSize: 12.5, fontWeight: "600", minWidth: 48 },
  meetInviteValue: { color: foundation.ink, flex: 1, fontSize: 12.5, fontWeight: "700" },
  meetInviteAcceptBtn: { backgroundColor: foundation.ink, borderRadius: 10, marginTop: 10, paddingVertical: 10 },
  meetInviteAcceptText: { color: color.white, fontSize: 12.5, fontWeight: "800", textAlign: "center" },
  meetInviteStatusText: { color: color.muted, fontSize: 11.5, fontWeight: "700", marginTop: 10, textAlign: "center" },

  quickReplies: { alignItems: "center", flexGrow: 0, gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  qrBtn: { backgroundColor: color.chipNeutralBg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  qrBtnText: { color: foundation.ink, fontSize: 12.5, fontWeight: "700" },
  qrBtnMeet: { backgroundColor: "#fff8f0", borderColor: "#f0e4d4", borderWidth: 1 },
  qrBtnMeetText: { color: "#a06a2c", fontSize: 12.5, fontWeight: "700" },

  error: { color: "#b91c1c", fontSize: 12, paddingBottom: 6, paddingHorizontal: 16 },

  inputBar: { alignItems: "center", borderTopColor: color.cardBorder, borderTopWidth: 1, flexDirection: "row", gap: 6, paddingBottom: 12, paddingHorizontal: 12, paddingTop: 8 },
  inputIconBtn: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  textInput: { backgroundColor: color.chipNeutralBg, borderRadius: 20, color: foundation.ink, flex: 1, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { backgroundColor: foundation.ink, borderRadius: 18, height: 36, justifyContent: "center", paddingHorizontal: 16 },
  sendBtnText: { color: color.white, fontSize: 13, fontWeight: "800" },

  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.4)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  meetSheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, bottom: 0, left: 0, maxHeight: "85%", paddingHorizontal: 20, position: "absolute", right: 0 },
  sheetGrab: { alignSelf: "center", backgroundColor: "#e0e0e0", borderRadius: 2, height: 4, marginBottom: 8, marginTop: 10, width: 36 },
  sheetTitle: { color: foundation.ink, fontSize: 16, fontWeight: "800", textAlign: "center" },
  sheetSub: { color: color.muted, fontSize: 12, marginBottom: 16, marginTop: 4, textAlign: "center" },
  sheetLabel: { color: color.muted, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10, marginTop: 6, textTransform: "uppercase" },
  meetSceneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  meetSceneOpt: { alignItems: "center", backgroundColor: "#f9f9f9", borderColor: "transparent", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 12, width: "48%" },
  meetSceneOptSelected: { backgroundColor: color.white, borderColor: foundation.ink },
  meetSceneEmoji: { fontSize: 18 },
  meetSceneName: { color: foundation.ink, flex: 1, fontSize: 12, fontWeight: "700" },
  meetTimeChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  meetTimeChip: { backgroundColor: color.chipNeutralBg, borderColor: "transparent", borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 9 },
  meetTimeChipSelected: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  meetTimeChipText: { color: "#555", fontSize: 12.5, fontWeight: "700" },
  meetTimeChipTextSelected: { color: color.white },
  meetPlaceInput: { backgroundColor: "#fafafa", borderColor: color.cardBorder, borderRadius: 14, borderWidth: 1.5, color: foundation.ink, fontSize: 14, marginBottom: 20, paddingHorizontal: 16, paddingVertical: 14 },
  meetSheetFooter: { borderTopColor: color.cardBorder, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 },
  meetFooterBtn: { alignItems: "center", borderRadius: 14, flex: 1, paddingVertical: 14 },
  meetFooterBtnSecondary: { backgroundColor: color.chipNeutralBg },
  meetFooterBtnSecondaryText: { color: foundation.ink, fontSize: 14, fontWeight: "800" },
  meetFooterBtnPrimary: { backgroundColor: foundation.ink },
  meetFooterBtnPrimaryText: { color: color.white, fontSize: 14, fontWeight: "800" },
});
