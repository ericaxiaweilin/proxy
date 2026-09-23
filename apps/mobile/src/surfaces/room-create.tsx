import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationClient } from "../conversation-client";
import { resolveHomePersonAccountId, type RecommendPerson } from "../recommend-fixtures";
import { color, foundation } from "../theme";

// ROOM-CREATE-001（2026-09-22，用户原型 deepseek_html_20260922_c2625e.html
// 「创建房间」）：GROUP conversation + 场景元数据，见 conversation-client.ts
// 的 startConversation({conversationType:"GROUP", roomScene}) 与服务端
// ROOM-CREATE-001 校验。
//
// 邀请候选人只收窄到真实有服务端账号的那几个人（resolveHomePersonAccountId
// 能映射到 user_mockcreator_ 的）——「真人推荐」列表大部分是本地 fixture，
// 没有服务端账号；把那些人拉进房间会造出一个谁都打不开、成员条头像/名字
// 都解析不出来的空壳房间，属于假交互，本版直接过滤掉，不显示成可邀请。
//
// 没有 AI 场控员（原型里的"小助手"）——那需要真实 AI agent 编排，本轮不做。

// HOME-MORE-ROOMS-001：首页「更多 → 聊天房」的开房大卡直接复用这张表的前 4 项
// 做场景快捷入口（原型 deepseek_html_20260923_2308b7.html 的 create-scene-chip），
// 点哪个就带着哪个场景打开本页 —— 两边共用一张表，场景不会对不上。
export const SCENE_OPTIONS: ReadonlyArray<{ emoji: string; sceneName: string; sceneDesc: string; roomName: string; title: string; subtitle: string }> = [
  { emoji: "📷", sceneName: "City Walk + 拍照", sceneDesc: "老城区", roomName: "City Walk 拍照局", title: "City Walk", subtitle: "+ 拍照" },
  { emoji: "☕", sceneName: "咖啡 + 聊天", sceneDesc: "咖啡店", roomName: "咖啡聊天局", title: "咖啡", subtitle: "+ 聊天" },
  { emoji: "🖼️", sceneName: "一起看展", sceneDesc: "美术馆", roomName: "一起看展", title: "看展", subtitle: "+ 讲解" },
  { emoji: "🎲", sceneName: "桌游局", sceneDesc: "桌游吧", roomName: "桌游局", title: "桌游", subtitle: "狼人杀 / UNO" },
  { emoji: "💬", sceneName: "随便聊聊", sceneDesc: "无固定活动", roomName: "随便聊聊", title: "随便聊聊", subtitle: "无固定活动" },
];

export function RoomCreateSurface({ candidates, conversationClient, initialSceneIndex = 0, presentation = "modal", visible, onClose, onCreated }: {
  // HOME-MORE-ROOMS-002: "overlay" = 不包 Modal，直接叠在调用方所在的 Modal 里（「更多」整页）。
  presentation?: "modal" | "overlay";
  candidates: ReadonlyArray<RecommendPerson>;
  // 从开房大卡的场景 chip 进来时预选的场景（SCENE_OPTIONS 下标）。
  initialSceneIndex?: number;
  conversationClient: ConversationClient;
  visible: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}): React.JSX.Element | null {
  const safeArea = useSafeAreaInsets();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [roomName, setRoomName] = useState(SCENE_OPTIONS[0]!.roomName);
  const [roomNameEdited, setRoomNameEdited] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  // 每次打开都按入口预选场景；用户已经改过房名就不覆盖（pickScene 的同一条规则）。
  useEffect(() => {
    if (visible && SCENE_OPTIONS[initialSceneIndex]) pickScene(initialSceneIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialSceneIndex]);

  const scene = SCENE_OPTIONS[sceneIndex]!;
  // 只留有服务端账号的候选人（见文件头注释）；同 id 去重（不同场景 feed 可能重复出现同一个人）。
  const invitable = useMemo(() => {
    const seen = new Set<string>();
    return candidates.filter((p) => {
      if (resolveHomePersonAccountId(p.id) === p.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [candidates]);

  function pickScene(index: number): void {
    setSceneIndex(index);
    if (!roomNameEdited) setRoomName(SCENE_OPTIONS[index]!.roomName);
  }

  function onRoomNameInput(value: string): void {
    setRoomName(value);
    setRoomNameEdited(value.trim() !== "" && value !== scene.roomName);
  }

  function toggleInvite(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function reset(): void {
    setSceneIndex(0);
    setRoomName(SCENE_OPTIONS[0]!.roomName);
    setRoomNameEdited(false);
    setSelected(new Set());
    setError(undefined);
  }

  async function create(): Promise<void> {
    if (selected.size === 0 || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const participantIds = Array.from(selected).map((id) => resolveHomePersonAccountId(id));
      const finalRoomName = roomName.trim() || scene.roomName;
      const result = await conversationClient.startConversation({
        originType: "HOME", originId: "room", conversationType: "GROUP",
        participantIds, firstMessage: "房间已创建",
        roomScene: { emoji: scene.emoji, sceneName: scene.sceneName, sceneDesc: scene.sceneDesc, roomName: finalRoomName },
      });
      const payload = typeof result.operationRef === "string" ? JSON.parse(result.operationRef) as { conversationId?: string } : {};
      if (!payload.conversationId) throw new Error("创建房间失败：服务端未返回会话 id");
      reset();
      onCreated(payload.conversationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建房间失败，请重试");
    } finally {
      setCreating(false);
    }
  }

  const body = (
    <View style={[styles.root, presentation === "overlay" && styles.overlay, { paddingTop: safeArea.top }]}>
      <View style={styles.navBar}>
        <Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => { reset(); onClose(); }} style={styles.navBack}>
          <Text style={styles.navBackText}>‹</Text>
        </Pressable>
        <Text style={styles.navTitle}>创建房间</Text>
        <Pressable
          accessibilityLabel="创建"
          disabled={selected.size === 0 || creating}
          onPress={() => void create()}
          style={[styles.navAction, selected.size > 0 && !creating && styles.navActionReady]}
        >
          <Text style={[styles.navActionText, selected.size > 0 && !creating && styles.navActionTextReady]}>{creating ? "创建中…" : "创建"}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.preview}>
          <View style={styles.previewTop}>
            <Text style={styles.previewEmoji}>{scene.emoji}</Text>
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle}>{roomName.trim() || scene.roomName}</Text>
              <Text style={styles.previewSub}>{scene.sceneName} · {scene.sceneDesc}</Text>
            </View>
          </View>
          <View style={styles.previewMembers}>
            <Text style={styles.previewCount}>{selected.size === 0 ? "还没有邀请人" : `${selected.size} 人已选`}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>选择场景</Text>
        <View style={styles.sceneGrid}>
          {SCENE_OPTIONS.map((option, index) => (
            <Pressable
              key={option.roomName}
              accessibilityLabel={`选择场景 ${option.title}`}
              onPress={() => pickScene(index)}
              style={[styles.sceneOpt, index === sceneIndex && styles.sceneOptSelected]}
            >
              <Text style={styles.sceneOptEmoji}>{option.emoji}</Text>
              <View style={styles.sceneOptInfo}>
                <Text style={styles.sceneOptTitle}>{option.title}</Text>
                <Text style={styles.sceneOptSub}>{option.subtitle}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>房间名</Text>
        <View style={styles.roomNameWrap}>
          <TextInput
            accessibilityLabel="房间名"
            onChangeText={onRoomNameInput}
            style={styles.roomNameInput}
            value={roomName}
          />
          <View style={[styles.roomNameBadge, roomNameEdited && styles.roomNameBadgeEdited]}>
            <Text style={[styles.roomNameBadgeText, roomNameEdited && styles.roomNameBadgeTextEdited]}>{roomNameEdited ? "已修改" : "自动"}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>邀请谁进来</Text>
        {invitable.length === 0 ? (
          <Text style={styles.empty}>暂时没有可邀请的人。</Text>
        ) : (
          invitable.map((p) => {
            const on = selected.has(p.id);
            return (
              <Pressable
                key={p.id}
                accessibilityLabel={`邀请 ${p.name}${on ? "，已选中" : ""}`}
                onPress={() => toggleInvite(p.id)}
                style={[styles.inviteItem, on && styles.inviteItemSelected]}
              >
                {p.photoUri ? <Image source={{ uri: p.photoUri }} style={styles.inviteAvatar} /> : (
                  <View style={styles.inviteAvatarFallback}><Text style={styles.inviteAvatarFallbackText}>{p.initials}</Text></View>
                )}
                <View style={styles.inviteInfo}>
                  <Text style={styles.inviteName}>{p.name}</Text>
                  <Text style={styles.inviteDesc} numberOfLines={1}>{p.bio}</Text>
                </View>
                <View style={[styles.inviteCheck, on && styles.inviteCheckOn]}>
                  {on ? <Text style={styles.inviteCheckMark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );

  if (presentation === "overlay") return visible ? body : null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  navBar: { alignItems: "center", borderBottomColor: color.cardBorder, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  navBack: { alignItems: "center", height: 28, justifyContent: "center", width: 24 },
  navBackText: { color: foundation.ink, fontSize: 24, fontWeight: "600" },
  navTitle: { color: foundation.ink, flex: 1, fontSize: 16, fontWeight: "800" },
  navAction: { backgroundColor: color.chipNeutralBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  navActionReady: { backgroundColor: foundation.ink },
  navActionText: { color: color.muted, fontSize: 13, fontWeight: "800" },
  navActionTextReady: { color: color.white },

  body: { padding: 20 },
  preview: { backgroundColor: "#1a1a1a", borderRadius: 18, marginBottom: 20, padding: 20 },
  previewTop: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 14 },
  previewEmoji: { fontSize: 32 },
  previewInfo: { flex: 1 },
  previewTitle: { color: color.white, fontSize: 17, fontWeight: "800", marginBottom: 3 },
  previewSub: { color: "rgba(255,255,255,0.65)", fontSize: 12 },
  previewMembers: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, paddingTop: 12 },
  previewCount: { color: "rgba(255,255,255,0.65)", fontSize: 11.5, fontWeight: "600" },

  sectionTitle: { color: color.muted, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10, marginTop: 6, textTransform: "uppercase" },

  sceneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  sceneOpt: { alignItems: "center", backgroundColor: "#f9f9f9", borderColor: "transparent", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 14, width: "48%" },
  sceneOptSelected: { backgroundColor: color.white, borderColor: foundation.ink },
  sceneOptEmoji: { fontSize: 20 },
  sceneOptInfo: { flex: 1 },
  sceneOptTitle: { color: foundation.ink, fontSize: 12.5, fontWeight: "800", marginBottom: 1 },
  sceneOptSub: { color: color.muted, fontSize: 11, fontWeight: "500" },

  roomNameWrap: { marginBottom: 20, position: "relative" },
  roomNameInput: { backgroundColor: "#fafafa", borderColor: color.cardBorder, borderRadius: 14, borderWidth: 1.5, color: foundation.ink, fontSize: 14, paddingHorizontal: 16, paddingRight: 80, paddingVertical: 14 },
  roomNameBadge: { backgroundColor: color.chipNeutralBg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, position: "absolute", right: 12, top: "50%", transform: [{ translateY: -11 }] },
  roomNameBadgeEdited: { backgroundColor: "#fff8e6" },
  roomNameBadgeText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  roomNameBadgeTextEdited: { color: "#a06a2c" },

  empty: { color: color.muted, fontSize: 13, paddingVertical: 12 },
  inviteItem: { alignItems: "center", backgroundColor: color.white, borderColor: "#f0f0f0", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 12, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 12 },
  inviteItemSelected: { backgroundColor: "#fafafa", borderColor: foundation.ink },
  inviteAvatar: { borderRadius: 22, height: 44, width: 44 },
  inviteAvatarFallback: { alignItems: "center", backgroundColor: color.chipNeutralBg, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  inviteAvatarFallbackText: { color: foundation.ink, fontSize: 14, fontWeight: "800" },
  inviteInfo: { flex: 1 },
  inviteName: { color: foundation.ink, fontSize: 13.5, fontWeight: "800", marginBottom: 2 },
  inviteDesc: { color: color.muted, fontSize: 11, fontWeight: "500" },
  inviteCheck: { alignItems: "center", borderColor: "#ddd", borderRadius: 11, borderWidth: 1.5, height: 22, justifyContent: "center", width: 22 },
  inviteCheckOn: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  inviteCheckMark: { color: color.white, fontSize: 12, fontWeight: "800" },

  error: { color: "#b91c1c", fontSize: 12, paddingVertical: 8 },
});
