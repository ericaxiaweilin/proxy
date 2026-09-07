// HomeChatBox：R15.12.7 Universal Home Intent Composer（r1572HomeComposer）。
// 所有身份共用的统一对话式 Intent 入口，输入 → Model Intent → Workspace / Search / Conversation。
// R15.12.7 冻结：顶部「和 Proxy 说一句」+ 身份 span；底部一行语义快捷按钮 = 体验 / 机会 / 活动
// （SERVICE / ORDER / ACTIVITY）；提示只说明语义作用，不把用户带离 Home。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from "expo-speech-recognition";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { color } from "../theme";

export type HomeIntentMode = "SERVICE" | "ORDER" | "ACTIVITY";
export type HomeAttachment = {
  uri: string;
  fileName?: string;
  mimeType?: string;
  width: number;
  height: number;
};

interface HomeChatBoxProps {
  contextLabel: string;
  placeholder?: string;
  mode?: HomeIntentMode | undefined;
  onSelectMode?: ((mode: HomeIntentMode) => void) | undefined;
  onSend: (text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void;
}

const SEMANTIC_MODES: ReadonlyArray<{ id: HomeIntentMode; icon: ProxyIconName; label: string; placeholder: string }> = [
  { id: "SERVICE", icon: "target", label: "体验", placeholder: "例如：周六下午想在西湖拍一组人像" },
  { id: "ORDER", icon: "diamond", label: "机会", placeholder: "例如：看看今天附近有什么可接的机会" },
  { id: "ACTIVITY", icon: "circle", label: "活动", placeholder: "例如：看看本周末有什么摄影或咖啡活动" }
];

const INPUT_PROMPTS = [
  "说说你现在想完成什么…",
  "例如：周六下午想在西湖拍一组人像",
  "例如：看看附近有什么可参加的体验",
  "例如：带着照片，帮我找相似体验"
] as const;

export function HomeChatBox({
  contextLabel,
  placeholder = "直接告诉 Proxy 你现在想做什么…",
  mode,
  onSelectMode,
  onSend
}: HomeChatBoxProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [voiceState, setVoiceState] = useState<"IDLE" | "LISTENING" | "DONE">("IDLE");
  const [photo, setPhoto] = useState<HomeAttachment>();
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [toolError, setToolError] = useState<string>();
  const [promptIndex, setPromptIndex] = useState(0);
  const promptOpacity = useRef(new Animated.Value(1)).current;
  const selectedMode = SEMANTIC_MODES.find((entry) => entry.id === mode);

  useSpeechRecognitionEvent("start", () => {
    setToolError(undefined);
    setVoiceState("LISTENING");
  });
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (transcript) setText(transcript);
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

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(promptOpacity, { duration: 220, toValue: 0, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setPromptIndex((current) => (current + 1) % INPUT_PROMPTS.length);
        Animated.timing(promptOpacity, { duration: 320, toValue: 1, useNativeDriver: true }).start();
      });
    }, 3200);
    return () => clearInterval(interval);
  }, [promptOpacity]);

  useEffect(() => () => {
    ExpoSpeechRecognitionModule.abort();
  }, []);

  function handleSend(): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, mode, photo);
    setText("");
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
      if (!text) setText(source === "CAMERA" ? "请根据我拍的照片帮我看看" : "请根据这张照片帮我找相关体验");
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "照片选择失败");
    }
  }

  const promptCycle = selectedMode ? [selectedMode.placeholder, ...INPUT_PROMPTS] : INPUT_PROMPTS;
  const rotatingPrompt = promptCycle[promptIndex % promptCycle.length];

  return (
    <View style={styles.container}>
      {/* 首页不再额外占标题：循环提示直接在输入框内引导用户表达意图。 */}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={`向 Proxy 输入需求（${contextLabel}）`}
          multiline
          maxLength={500}
          onChangeText={setText}
          placeholder=""
          placeholderTextColor="#A9A2B0"
          style={styles.input}
          value={text}
        />
        {!text ? (
          <Animated.Text pointerEvents="none" style={[styles.rotatingPrompt, { opacity: promptOpacity }]}>
            {rotatingPrompt || placeholder}
          </Animated.Text>
        ) : null}
        <View style={styles.embeddedTools}>
          <Pressable accessibilityLabel="添加照片" onPress={() => setPhotoMenuOpen((open) => !open)} style={styles.toolBtn}>
            <CameraIcon color={color.ink} />
          </Pressable>
          <Pressable
            accessibilityLabel={voiceState === "LISTENING" ? "结束语音" : "语音输入"}
            onPress={() => void toggleVoice()}
            style={[styles.toolBtn, voiceState === "LISTENING" && styles.toolBtnListening]}
          >
            <MicrophoneIcon color={color.ink} />
          </Pressable>
        </View>
        <Pressable
          accessibilityLabel="发送"
          disabled={!text.trim()}
          onPress={handleSend}
          hitSlop={8}
          style={styles.sendBtn}
        >
          <ProxyIcon color={color.ink} name="arrowUp" size={26} />
        </Pressable>
      </View>

      {photo ? (
        <View style={styles.photoPreviewRow}>
          <Image accessibilityLabel="已选择的照片" source={{ uri: photo.uri }} style={styles.photoPreview} />
          <View style={styles.photoPreviewCopy}>
            <Text numberOfLines={1} style={styles.photoMenuTitle}>{photo.fileName || "已选择照片"}</Text>
            <Text style={styles.photoMenuSub}>发送时将安全上传到当前会话</Text>
          </View>
          <Pressable accessibilityLabel="移除照片" onPress={() => setPhoto(undefined)} style={styles.photoRemoveButton}>
            <Text style={styles.photoMenuRemove}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {toolError ? <Text accessibilityLiveRegion="polite" style={styles.toolError}>{toolError}</Text> : null}

      {photoMenuOpen ? (
        <View style={styles.photoMenu}>
          <Pressable accessibilityLabel="拍照" onPress={() => void choosePhoto("CAMERA")} style={styles.photoMenuItem}>
            <CameraIcon color={color.ink} />
            <View>
              <Text style={styles.photoMenuTitle}>拍照</Text>
              <Text style={styles.photoMenuSub}>加入当前输入，不会自动发布</Text>
            </View>
          </Pressable>
          <Pressable accessibilityLabel="从相册选择" onPress={() => void choosePhoto("LIBRARY")} style={styles.photoMenuItem}>
            <PhotoIcon color={color.ink} />
            <View>
              <Text style={styles.photoMenuTitle}>选择照片</Text>
              <Text style={styles.photoMenuSub}>从系统相册选择一张照片</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {/* 体验 / 机会 / 活动快捷路由已移除（产品转向直接下单/接单/参加活动，
          路由识别后续优化）。mode 透传保留，UI 不再展示。 */}
    </View>
  );
}

function MicrophoneIcon({ color: iconColor }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={iconColor} name="microphone" size={26} />;
}

function CameraIcon({ color: iconColor }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={iconColor} name="camera" size={26} />;
}

function PhotoIcon({ color: iconColor }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={iconColor} name="image" size={24} />;
}

const styles = StyleSheet.create({
  // 基线 .r157Composer：bg #fff border ln radius 20 padding 12 shadow 0 8 22 rgba(32,16,50,.05) margin 7 0 12。
  container: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16
  },
  // R3：输入区容纳相机 / 语音 / 发送三个 56×56 中性按钮，增加纵向表达空间。
  inputRow: {
    backgroundColor: color.homeIntentInputBg,
    borderColor: color.homeIntentBorder,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 176,
    padding: 14,
    position: "relative"
  },
  input: {
    backgroundColor: "transparent",
    color: color.ink,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 132,
    minHeight: 116,
    paddingBottom: 68,
    paddingHorizontal: 2,
    paddingTop: 2,
    textAlignVertical: "top"
  },
  rotatingPrompt: { color: "#A9A2B0", fontSize: 14, left: 16, lineHeight: 20, position: "absolute", right: 18, top: 16 },
  embeddedTools: { alignItems: "center", bottom: 14, flexDirection: "row", gap: 10, left: 14, position: "absolute" },
  // Module Logo Master R3：white neutral box 56×56 / radius 16 / glyph 26 / stroke 2.2。
  sendBtn: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    bottom: 14,
    height: 56,
    justifyContent: "center",
    position: "absolute",
    right: 14,
    width: 56
  },
  toolBtn: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56
  },
  toolBtnListening: { backgroundColor: color.white, borderColor: color.ink },
  toolBtnText: { color: "#5F5664", fontSize: 11, fontWeight: "700" },
  toolBtnTextListening: { color: color.ink },
  toolIcon: { height: 24, position: "relative", width: 24 },
  micHead: { borderRadius: 5, borderWidth: 1.5, height: 7, left: 3.5, position: "absolute", top: 0, width: 6 },
  micArc: { borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderRadius: 6, borderRightWidth: 1.5, bottom: 3, height: 7, left: 1.2, position: "absolute", width: 10.6 },
  micStem: { bottom: 0.8, height: 3.2, left: 6, position: "absolute", width: 1.5 },
  micBase: { bottom: 0, height: 1.5, left: 3.8, position: "absolute", width: 6 },
  cameraBody: { borderRadius: 2, borderWidth: 1.5, bottom: 0.8, height: 8, left: 0.5, position: "absolute", width: 12 },
  cameraTop: { height: 2, left: 3, position: "absolute", top: 2, width: 4.5 },
  cameraLens: { borderRadius: 3, borderWidth: 1.3, height: 5, left: 4, position: "absolute", top: 5, width: 5 },
  photoFrame: { borderRadius: 1.5, borderWidth: 1.5, height: 10.5, left: 1, position: "absolute", top: 1.2, width: 11 },
  photoMountain: { borderBottomWidth: 1.4, borderRightWidth: 1.4, bottom: 2.7, height: 5, left: 3.2, position: "absolute", transform: [{ rotate: "-45deg" }], width: 6 },
  photoSun: { borderRadius: 1.5, height: 3, position: "absolute", right: 3, top: 3.5, width: 3 },
  photoMenu: { backgroundColor: color.white, borderColor: "#E7E1EA", borderRadius: 12, borderWidth: 1, marginTop: 7, overflow: "hidden" },
  photoMenuItem: { alignItems: "center", flexDirection: "row", gap: 9, paddingHorizontal: 10, paddingVertical: 9 },
  photoMenuTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  photoMenuSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  photoMenuRemove: { color: color.error, fontSize: 19, lineHeight: 20, width: 13 },
  photoPreviewRow: { alignItems: "center", backgroundColor: "#FCFBFD", borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 8 },
  photoPreview: { borderRadius: 10, height: 52, width: 52 },
  photoPreviewCopy: { flex: 1 },
  photoRemoveButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  toolError: { color: color.error, fontSize: 11, lineHeight: 15, marginTop: 7 },
  // 基线 .r157Quick：3 列 grid，active = ink 底白字。
  quick: {
    flexDirection: "row",
    gap: 7,
    marginTop: 9
  },
  quickBtn: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    paddingVertical: 9
  },
  quickBtnActive: { backgroundColor: color.ink, borderColor: color.ink },
  quickIcon: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  quickLabel: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  quickLabelActive: { color: color.white },
});
