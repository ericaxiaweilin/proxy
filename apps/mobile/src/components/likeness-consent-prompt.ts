import { Alert } from "react-native";

// AI-MANAGE-010（2026-09-23，用户：「点击进入自动默认授权 但是要弹授权提示」）：进入 AI 分身 / AI 管理时
// 如果还没授权，弹这个提示；本人点「同意授权」才建分身、写形象授权（AiPersonaClient.grantLikeness）。
// 「暂不」= 什么都不建，页面显示未授权态，可以之后再点「授权」。
// 以后「接单权限 / 小美验证」上线后，入口本身只对小美展示；这里只管授权这一步。
export function promptLikenessConsent(onAgree: () => void, onDecline?: () => void): void {
  Alert.alert(
    "授权 AI 使用你的形象",
    "开启 AI 分身需要你授权：AI 可以读取你个人主页图库里你自己上传的照片，用来生成你的形象图。只用于你自己的 AI 分身，可以随时在「我的 → AI 管理」撤回。",
    [
      { text: "暂不", style: "cancel", ...(onDecline ? { onPress: onDecline } : {}) },
      { text: "同意授权", onPress: onAgree },
    ],
  );
}
