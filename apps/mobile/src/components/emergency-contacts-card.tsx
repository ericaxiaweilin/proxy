// SAFETY-NET-001：紧急联系人卡片。1–3 位，按优先级排序。
//
// 三条口径，都是刻意的：
//
// 1. **没有「已核验」标志**。服务端只存用户自己声明的
//    permissionAttestedAt（"我确认这个人同意被列入"）。我们没有任何
//    核验该联系人身份或意愿的通道，所以界面也不许画一个绿勾说"已验证"。
//
// 2. **不说"平台会通知他们"**。本仓库没有向任意用户送达的通道
//    （见 emergency-client.ts 文件头）。卡片里写明这一点，否则用户会
//    以为出事时联系人已经收到消息，于是不去自己打电话。
//
// 3. **电话号码是第三方的个人信息**。加进来是为了让用户自己拨，不是
//    为了让我们分发。界面不做任何"分享给商家/匹配对象"的入口。
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import {
  MAX_EMERGENCY_CONTACTS,
  type EmergencyClient,
  type EmergencyContact,
  EmergencyError,
} from "../emergency-client";

export function EmergencyContactsCard({
  client,
  skipInitialFetch,
}: {
  client: EmergencyClient;
  skipInitialFetch?: boolean;
}): React.JSX.Element {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [limit, setLimit] = useState(MAX_EMERGENCY_CONTACTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  // 默认 **false**。默认 true 等于替用户声明了一件他没说过的事，
  // 而那一列存在的意义正是"这是用户说的"。
  const [attested, setAttested] = useState(false);

  const reload = useCallback(async () => {
    try {
      const page = await client.listContacts();
      setContacts(page.contacts);
      setLimit(page.limit);
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [client]);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await client.listContacts();
        if (!cancelled) {
          setContacts(page.contacts);
          setLimit(page.limit);
        }
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, skipInitialFetch]);

  const atLimit = contacts.length >= limit;

  const submit = async () => {
    if (!attested) {
      setError("请先确认已获得该联系人同意 —— 没有这一条，服务端不会保存。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.upsertContact({
        displayName: name.trim(),
        phone: phone.trim(),
        ...(relation.trim() ? { relation: relation.trim() } : {}),
        // 优先级取下一个空位；服务端对 (user, priority) 有部分唯一索引，
        // 撞号会被拒，所以这里按现有数量顺推。
        priority: contacts.length + 1,
      });
      setName("");
      setPhone("");
      setRelation("");
      setAttested(false);
      setFormOpen(false);
      await reload();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (contactId: string) => {
    setBusy(true);
    setError(null);
    try {
      await client.deleteContact(contactId);
      await reload();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text selectable style={styles.title}>紧急联系人</Text>
      <Text selectable style={styles.desc}>
        最多 {limit} 位，按优先级联系。这是你自己的安全网名单 —— 平台目前不会自动通知他们，只在你主动求助时协助你拨号或转交短信。
      </Text>

      {contacts.map((c) => (
        <View key={c.contactId} style={styles.contactRow}>
          <View style={styles.contactCopy}>
            <Text selectable style={styles.contactName}>
              {c.priority}. {c.displayName}
              {c.relation ? ` · ${c.relation}` : ""}
            </Text>
            <Text selectable style={styles.contactPhone}>{c.phone}</Text>
          </View>
          <Pressable
            accessibilityLabel={`移除 ${c.displayName}`}
            disabled={busy}
            onPress={() => void remove(c.contactId)}
            style={styles.removeBtn}
          >
            <Text selectable style={styles.removeText}>移除</Text>
          </Pressable>
        </View>
      ))}

      {contacts.length === 0 ? (
        <Text selectable style={styles.empty}>还没有紧急联系人。</Text>
      ) : null}

      {atLimit && !formOpen ? (
        <Text selectable style={styles.hint}>
          已达上限（{limit} 位）。要先移除一位才能再加。
        </Text>
      ) : null}

      {formOpen ? (
        <View style={styles.form}>
          <Text selectable style={styles.label}>称呼</Text>
          <TextInput
            onChangeText={setName}
            placeholder="例如：Nguyễn Thị Hương"
            placeholderTextColor={color.muted}
            style={styles.input}
            value={name}
          />
          <Text selectable style={styles.label}>手机号（国际格式）</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="phone-pad"
            onChangeText={setPhone}
            placeholder="+84912345678"
            placeholderTextColor={color.muted}
            style={styles.input}
            value={phone}
          />
          <Text selectable style={styles.label}>关系（可选）</Text>
          <TextInput
            onChangeText={setRelation}
            placeholder="家人 / 朋友 / 同事"
            placeholderTextColor={color.muted}
            style={styles.input}
            value={relation}
          />
          {/* 这一条必须由用户自己勾。默认不勾、不预填。 */}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: attested }}
            onPress={() => setAttested((v) => !v)}
            style={styles.attestRow}
          >
            <View style={[styles.checkbox, attested ? styles.checkboxOn : null]}>
              {attested ? <Text selectable style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text selectable style={styles.attestText}>
              我已告知并取得该联系人的同意，把他/她的姓名和电话存进我的紧急联系人名单。
            </Text>
          </Pressable>
          <View style={styles.formActions}>
            <Pressable
              disabled={busy || !name.trim() || !phone.trim() || !attested}
              onPress={() => void submit()}
              style={[styles.primaryBtn, busy || !name.trim() || !phone.trim() || !attested ? styles.btnDisabled : null]}
            >
              <Text selectable style={styles.primaryBtnText}>{busy ? "保存中…" : "保存"}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => {
                setFormOpen(false);
                setError(null);
              }}
              style={styles.secondaryBtn}
            >
              <Text selectable style={styles.secondaryBtnText}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : !atLimit ? (
        <Pressable disabled={busy} onPress={() => setFormOpen(true)} style={styles.addBtn}>
          <Text selectable style={styles.addBtnText}>＋ 添加紧急联系人</Text>
        </Pressable>
      ) : null}

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof EmergencyError) {
    switch (e.code) {
      case "EMERGENCY_CONTACT_LIMIT_REACHED":
        return `最多只能有 ${MAX_EMERGENCY_CONTACTS} 位紧急联系人，请先移除一位。`;
      case "EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED":
        return "需要先确认已获得该联系人同意。";
      case "INVALID_EMERGENCY_CONTACT":
        return "信息不完整或手机号格式不对（需要国际格式，例如 +84912345678）。";
      case "EMERGENCY_CONTACT_NOT_FOUND":
        return "这位联系人已经不在名单里了，请刷新后重试。";
      case "AUTH_REQUIRED":
        return "登录已过期，请重新登录。";
      default:
        return `保存失败（${e.code}）。`;
    }
  }
  if (e instanceof Error) return e.message;
  return "出错了，请稍后重试。";
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  title: { color: color.ink, fontSize: 16, fontWeight: "700" },
  desc: { color: color.muted, fontSize: 12.5, lineHeight: 19, marginTop: 8 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  contactCopy: { flex: 1, paddingRight: 10 },
  contactName: { color: color.ink, fontSize: 14.5, fontWeight: "600" },
  contactPhone: { color: color.muted, fontSize: 12.5, marginTop: 3 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  removeText: { color: color.error, fontSize: 13 },
  empty: { color: color.muted, fontSize: 12.5, marginTop: 12 },
  hint: { color: color.muted, fontSize: 12.5, marginTop: 10 },
  addBtn: {
    marginTop: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.line,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  addBtnText: { color: color.ink, fontSize: 14, fontWeight: "600" },
  form: { marginTop: 14 },
  label: { color: color.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    color: color.ink,
    fontSize: 15,
    paddingVertical: 8,
  },
  attestRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 14 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: color.line,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: color.violet, borderColor: color.violet },
  checkboxMark: { color: color.white, fontSize: 12, fontWeight: "700" },
  attestText: { flex: 1, color: color.ink, fontSize: 12.5, lineHeight: 18 },
  formActions: { flexDirection: "row", marginTop: 16, gap: 10 },
  primaryBtn: {
    flex: 1,
    backgroundColor: color.ink,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: color.white, fontSize: 14.5, fontWeight: "600" },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: {
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: color.ink, fontSize: 14.5 },
  error: { color: color.error, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
