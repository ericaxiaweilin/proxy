// HomeSearchDock — 对齐 Proxy_Home_Search_Conversation_v3 原型
// 顶部唯一输入入口：搜索、模型对话、照片和语音共用一个容器。
import React, { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { ProxyIcon } from "./proxy-icon";
import { color, shadows } from "../theme";
import { type HomeAttachment } from "./home-chat-box";
import { type HomeSearchSuggestion } from "../home-search-intent";

const SLOT_LABEL: Record<HomeSearchSuggestion["slot"], string> = {
  person: "人",
  time: "时段",
  activity: "活动",
  place: "地点"
};

export interface HomeSearchDockProps {
  placeholder?: string | undefined;
  value: string;
  onChangeText: (text: string) => void;
  suggestions: ReadonlyArray<HomeSearchSuggestion>;
  onApplySuggestion: (s: HomeSearchSuggestion) => void;
  // 意图执行（原型 clarify / remix）
  intentRemix: boolean;
  intentSlot: HomeSearchSuggestion["slot"] | null;
  onRemix: () => void;
  onExchange: (slot: HomeSearchSuggestion["slot"]) => void;
  // 执行查询 / 对话
  onExecute: (text: string, attachment?: HomeAttachment) => void;
  // AI 响应条状态
  responseText?: string | undefined;
  responseWhy?: string | undefined;
  onWhyPress?: ((whyText: string) => void) | undefined;
  // 澄清选项 chips (例如 ["下午", "晚上"])
  clarifyQuestion?: string | undefined;
  clarifyChoices?: ReadonlyArray<string> | undefined;
  onSelectClarify?: ((choice: string) => void) | undefined;
  // 左侧 AI 标识是显式的模型会话入口；普通输入保持搜索语义。
  onOpenConversation: () => void;
}

export function HomeSearchDock({
  placeholder = "想找谁、去哪、做什么？",
  value,
  onChangeText,
  suggestions,
  onApplySuggestion,
  intentRemix,
  intentSlot,
  onRemix,
  onExchange,
  onExecute,
  responseText,
  responseWhy,
  onWhyPress,
  clarifyQuestion,
  clarifyChoices,
  onSelectClarify,
  onOpenConversation
}: HomeSearchDockProps): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const [voiceState, setVoiceState] = useState<"IDLE" | "LISTENING" | "DONE">("IDLE");
  const [photo, setPhoto] = useState<HomeAttachment>();
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [toolError, setToolError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [toastMessage, setToastMessage] = useState<string>();

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(undefined), 2200);
  };

  useSpeechRecognitionEvent("start", () => {
    setToolError(undefined);
    setVoiceState("LISTENING");
  });
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (transcript) {
      setDraft(transcript);
      onChangeText(transcript);
    }
    if (event.isFinal) setVoiceState("DONE");
  });
  useSpeechRecognitionEvent("end", () => {
    setVoiceState((current) => current === "LISTENING" ? "DONE" : current);
  });
  useSpeechRecognitionEvent("error", (event) => {
    setVoiceState("IDLE");
    if (event.error !== "aborted") {
      setToolError(event.error === "not-allowed" ? "请在系统设置中允许麦克风和语音识别。" : `语音识别暂不可用：${event.message || event.error}`);
    }
  });

  useEffect(() => () => {
    ExpoSpeechRecognitionModule.abort();
  }, []);

  function handleSend(): void {
    const text = (value || draft).trim();
    if (!text && !photo) return;
    onExecute(text, photo);
    setDraft("");
    onChangeText("");
    setPhoto(undefined);
    setVoiceState("IDLE");
  }

  async function toggleVoice(): Promise<void> {
    if (voiceState === "LISTENING") {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setToolError(undefined);
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setToolError("请允许麦克风和语音识别后再使用语音输入。");
        return;
      }
      const speechLocale = Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN";
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true
      });
    } catch (error) {
      setVoiceState("IDLE");
      setToolError(error instanceof Error ? error.message : "语音识别启动失败");
    }
  }

  async function choosePhoto(source: "CAMERA" | "LIBRARY"): Promise<void> {
    setPhotoMenuOpen(false);
    setToolError(undefined);
    setVoiceState("IDLE");
    try {
      const permission = source === "CAMERA"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setToolError(source === "CAMERA" ? "请在系统设置中允许 Proxy 使用相机。" : "请在系统设置中允许 Proxy 读取照片。");
        return;
      }
      const result = source === "CAMERA"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, selectionLimit: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      setPhoto({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {})
      });
      showToast("图片直接参与当前对话");
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "照片选择失败");
    }
  }

  const canSend = Boolean((value || draft).trim() || photo);

  return (
    <View style={styles.dock}>
      <View style={styles.searchShell}>
      {/* 搜索与模型对话共用这一行；页面内不得再出现第二个 composer。 */}
      <View style={styles.searchRow}>
        <Pressable
          accessibilityLabel="打开 Proxy AI 对话"
          onPress={onOpenConversation}
          style={styles.threadBtn}
        >
          <ProxyIcon color="#66511F" name="spark" size={25} />
        </Pressable>

        <TextInput
          ref={inputRef}
          accessibilityLabel="搜索人、活动、地点或时间"
          maxLength={500}
          onChangeText={(next) => { setDraft(next); onChangeText(next); }}
          placeholder={placeholder}
          placeholderTextColor="#8C867E"
          returnKeyType="send"
          onSubmitEditing={handleSend}
          style={styles.input}
          value={value || draft}
        />

        <Pressable
          accessibilityLabel="添加照片"
          onPress={() => setPhotoMenuOpen((open) => !open)}
          style={styles.toolBtn}
        >
          <ProxyIcon color={color.ink} name="camera" size={24} />
        </Pressable>

        <Pressable
          accessibilityLabel={voiceState === "LISTENING" ? "结束语音" : "语音输入"}
          onPress={() => void toggleVoice()}
          style={[styles.toolBtn, voiceState === "LISTENING" && styles.toolBtnListening]}
        >
          <ProxyIcon color={color.ink} name="microphone" size={24} />
        </Pressable>

        <Pressable
          accessibilityLabel="发送"
          disabled={!canSend}
          onPress={handleSend}
          hitSlop={6}
          style={[styles.goBtn, !canSend && styles.goBtnDisabled]}
        >
          <Text style={styles.goGlyph}>→</Text>
        </Pressable>
      </View>

      {/* 回复属于同一个搜索/对话容器，不另造一个“接收框”。 */}
      {responseText ? (
        <View style={styles.responseBar}>
          <View style={styles.responseInner}>
            <Text style={styles.responseText} numberOfLines={2}>
              <Text style={styles.responseBrand}>Proxy </Text>
              {responseText}
            </Text>
            {responseWhy ? (
              <Pressable
                onPress={() => onWhyPress ? onWhyPress(responseWhy) : showToast(responseWhy)}
                style={styles.whyBtn}
                accessibilityLabel="为什么"
              >
                <Text style={styles.whyBtnText}>为什么</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      </View>

      {/* Toast 提示 */}
      {toastMessage ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* 照片选择预览 */}
      {photo ? (
        <View style={styles.photoPreviewRow}>
          <Image accessibilityLabel="已选择的照片" source={{ uri: photo.uri }} style={styles.photoPreview} />
          <Text numberOfLines={1} style={styles.photoPreviewText}>{photo.fileName || "照片参与当前对话"}</Text>
          <Pressable accessibilityLabel="移除照片" onPress={() => setPhoto(undefined)} style={styles.photoRemove}>
            <Text style={styles.photoRemoveText}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {toolError ? <Text accessibilityLiveRegion="polite" style={styles.toolError}>{toolError}</Text> : null}

      {/* 澄清选项 Clarify Chips */}
      {clarifyChoices && clarifyChoices.length > 0 ? (
        <View style={styles.clarifyBox}>
          {clarifyQuestion ? <Text style={styles.clarifyQuestion}>{clarifyQuestion}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clarifyRow}>
            {clarifyChoices.map((c) => (
              <Pressable
                key={c}
                onPress={() => onSelectClarify?.(c)}
                style={styles.clarifyChip}
                accessibilityLabel={`选择 ${c}`}
              >
                <Text style={styles.clarifyChipText}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 全站搜索联想候选 chips */}
      {suggestions.length > 0 ? (
        <View style={styles.chipWrap}>
          {suggestions.map((s) => (
            <Pressable
              key={`${s.slot}:${s.id}`}
              accessibilityLabel={`套入${SLOT_LABEL[s.slot]} ${s.label}`}
              onPress={() => onApplySuggestion(s)}
              style={styles.chip}
            >
              <Text style={styles.chipSlot}>{SLOT_LABEL[s.slot]}</Text>
              <Text numberOfLines={1} style={styles.chipLabel}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* 意图执行 chips */}
      {intentRemix ? (
        <Pressable accessibilityLabel="整组换一套候选" onPress={onRemix} style={styles.actionChip}>
          <Text style={styles.actionChipText}>✦ 帮你整组换一套 →</Text>
        </Pressable>
      ) : null}
      {intentSlot ? (
        <Pressable
          accessibilityLabel={`更换${SLOT_LABEL[intentSlot]}候选`}
          onPress={() => onExchange(intentSlot)}
          style={styles.actionChip}
        >
          <Text style={styles.actionChipText}>换{SLOT_LABEL[intentSlot]}，选一个 →</Text>
        </Pressable>
      ) : null}

      {/* 相机/相册选择弹窗 */}
      {photoMenuOpen ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPhotoMenuOpen(false)}>
          <Pressable onPress={() => setPhotoMenuOpen(false)} style={styles.menuBackdrop}>
            <View style={styles.menuSheet} onStartShouldSetResponder={() => true}>
              <Text style={styles.menuTitle}>添加照片</Text>
              <Pressable accessibilityLabel="拍照" onPress={() => void choosePhoto("CAMERA")} style={styles.menuItem}>
                <ProxyIcon color={color.ink} name="camera" size={20} />
                <Text style={styles.menuItemText}>拍照</Text>
              </Pressable>
              <Pressable accessibilityLabel="从相册选择" onPress={() => void choosePhoto("LIBRARY")} style={styles.menuItem}>
                <ProxyIcon color={color.ink} name="image" size={20} />
                <Text style={styles.menuItemText}>从相册选择</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    marginVertical: 6,
    zIndex: 8,
  },
  searchShell: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 27,
    borderWidth: 1,
    overflow: "hidden",
    ...shadows.card
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 54,
    paddingLeft: 8,
    paddingRight: 7
  },
  threadBtn: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    position: "relative",
    width: 38
  },
  input: {
    color: color.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    height: "100%",
    paddingVertical: 0
  },
  toolBtn: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38
  },
  toolBtnListening: {
    opacity: 0.45
  },
  goBtn: {
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  goBtnDisabled: {
    opacity: 0.3
  },
  goGlyph: {
    color: color.white,
    fontSize: 15,
    fontWeight: "800"
  },

  responseBar: {
    borderTopColor: color.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 7
  },
  responseInner: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 32
  },
  responseText: {
    color: "#6F6962",
    flex: 1,
    fontSize: 11,
    lineHeight: 16
  },
  responseBrand: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "900"
  },
  whyBtn: {
    marginLeft: 8,
    padding: 4
  },
  whyBtnText: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "800"
  },

  // Clarify Box
  clarifyBox: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    marginTop: 8,
    padding: 10
  },
  clarifyQuestion: {
    color: color.ink,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 8
  },
  clarifyRow: {
    flexDirection: "row",
    gap: 7
  },
  clarifyChip: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  clarifyChipText: {
    color: color.ink,
    fontSize: 11,
    fontWeight: "600"
  },

  // Toast
  toast: {
    alignSelf: "center",
    backgroundColor: "#111111",
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    zIndex: 30
  },
  toastText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700"
  },

  photoPreviewRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginTop: 7,
    padding: 7
  },
  photoPreview: {
    borderRadius: 10,
    height: 40,
    width: 40
  },
  photoPreviewText: {
    color: color.muted,
    flex: 1,
    fontSize: 11
  },
  photoRemove: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
  },
  photoRemoveText: {
    color: color.error,
    fontSize: 18
  },
  toolError: {
    color: color.error,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 8
  },
  chip: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  chipSlot: {
    color: color.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  chipLabel: {
    color: color.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  actionChip: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 16,
    marginTop: 7,
    paddingVertical: 10
  },
  actionChipText: {
    color: color.white,
    fontSize: 12,
    fontWeight: "800"
  },
  menuBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    flex: 1,
    justifyContent: "center"
  },
  menuSheet: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    minWidth: 220,
    padding: 12
  },
  menuTitle: {
    color: color.muted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4
  },
  menuItem: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 6,
    paddingVertical: 11
  },
  menuItemText: {
    color: color.ink,
    fontSize: 14,
    fontWeight: "700"
  },
});
