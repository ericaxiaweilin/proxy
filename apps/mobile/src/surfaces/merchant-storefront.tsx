// MERCHANT_STOREFRONT — R18.x 真接商家店铺
// 之前 43 行只列账号；现在拉 account + store + photo album + lines +
// spend_daily + member_directory, 全部 server-authoritative.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { color, shadows } from "../theme";
import { retainStorePhoto, type RetainedStorePhoto } from "../expo-composer-draft-store";
import type { BusinessClient } from "../business-client";

type Account = { id: string; name: string; status: string };
type Store = { id: string; businessId: string; name: string; address: string; status: string };
type StorePhoto = { id: string; storeId: string; businessId: string; uploadedBy: string; assetPath: string; caption: string; sortOrder: number; createdAt: string };
type StoreLines = { storeId: string; logoAssetPath: string; description: string; hoursJson: string; contactPhone: string; contactEmail: string; updatedAt: string };
type MemberDirectory = { businessId: string; userId: string; displayName: string; role: string; status: string; joinedAt: string };
type SpendDaily = { businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number };

function formatVnd(minor: number): string {
  const vnd = Math.round(minor / 1000);
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr VND`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k VND`;
  return `${vnd} VND`;
}

function linesAsHoursObject(hoursJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(hoursJson) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch { /* fall through */ }
  return {};
}

export function MerchantStorefrontSurface({ client, viewerAccountId }: { client: BusinessClient; viewerAccountId?: string | undefined }): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stores, setStores] = useState<Record<string, Store[]>>({});
  const [photos, setPhotos] = useState<Record<string, StorePhoto[]>>({});
  const [lines, setLines] = useState<Record<string, StoreLines | undefined>>({});
  const [members, setMembers] = useState<Record<string, MemberDirectory[]>>({});
  const [spend, setSpend] = useState<Record<string, { totalOrders: number; totalGrossMinor: number; days: SpendDaily[] } | undefined>>({});
  const [uploadingStoreId, setUploadingStoreId] = useState<string | undefined>(undefined);
  // 建店：账号+首店一次建完（之前两处空态互相指“去别处建”，实际无入口）。
  const [newShopName, setNewShopName] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreAddr, setNewStoreAddr] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  async function createShop(): Promise<void> {
    if (creating || !newShopName.trim() || !newStoreName.trim()) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const { businessId } = await client.createAccount(newShopName.trim());
      await client.createStore(businessId, newStoreName.trim(), newStoreAddr.trim());
      const a = await client.listMyAccounts();
      setAccounts(a);
      await refreshOne(businessId);
      setNewShopName("");
      setNewStoreName("");
      setNewStoreAddr("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setCreating(false);
    }
  }

  async function addStore(businessId: string): Promise<void> {
    if (creating || !newStoreName.trim()) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      await client.createStore(businessId, newStoreName.trim(), newStoreAddr.trim());
      await refreshOne(businessId);
      setNewStoreName("");
      setNewStoreAddr("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "添加失败，请重试");
    } finally {
      setCreating(false);
    }
  }

  const refreshOne = useCallback(async (accountId: string) => {
    try {
      const s = await client.listStores(accountId);
      setStores((prev) => ({ ...prev, [accountId]: s }));
      const photoMap: Record<string, StorePhoto[]> = {};
      const linesMap: Record<string, StoreLines> = {};
      await Promise.all(s.map(async (store) => {
        try {
          photoMap[store.id] = await client.listStorePhotos(store.id);
        } catch {
          photoMap[store.id] = [];
        }
        try {
          linesMap[store.id] = await client.getStoreLines(store.id);
        } catch { /* missing store_lines is not a failure */ }
      }));
      setPhotos((prev) => ({ ...prev, ...photoMap }));
      setLines((prev) => ({ ...prev, ...linesMap }));
      try {
        const dir = await client.listMemberDirectory(accountId);
        setMembers((prev) => ({ ...prev, [accountId]: dir }));
      } catch { /* not authorised to read member directory is not a failure */ }
      try {
        const sd = await client.listSpendDaily({ businessId: accountId, sinceDays: 7 });
        setSpend((prev) => ({ ...prev, [accountId]: { totalOrders: sd.totalOrders, totalGrossMinor: sd.totalGrossMinor, days: sd.days } }));
      } catch { /* finance read is owner/admin only — fall through silently */ }
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await client.listMyAccounts();
        if (cancelled) return;
        setAccounts(a);
        await Promise.all(a.map((acc) => refreshOne(acc.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [client, refreshOne]);

  async function pickAndUploadPhoto(storeId: string): Promise<void> {
    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("需要照片权限才能上传店铺相册。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const localId = `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let retained: RetainedStorePhoto;
    try {
      retained = await retainStorePhoto({
        localId,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setUploadingStoreId(storeId);
    try {
      const created = await client.addStorePhoto({
        storeId,
        assetPath: retained.assetPath,
        caption: asset.fileName ?? "",
        sortOrder: Date.now() % 1000,
      });
      retained.photoId = created.id;
      setPhotos((prev) => ({
        ...prev,
        [storeId]: [created, ...(prev[storeId] ?? [])],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingStoreId(undefined);
    }
  }

  async function deletePhoto(storeId: string, photoId: string): Promise<void> {
    try {
      await client.deleteStorePhoto(storeId, photoId);
      setPhotos((prev) => ({
        ...prev,
        [storeId]: (prev[storeId] ?? []).filter((p) => p.id !== photoId),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.title}>商家店铺</Text>
      <Text style={styles.sub}>来自 Business Workspace 真实数据 · server-authoritative.</Text>
      {accounts === undefined && !error ? <ActivityIndicator /> : null}
      {error ? <View style={styles.card}><Text style={styles.errorText}>加载失败：{error}</Text></View> : null}
      {accounts !== undefined && accounts.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.createTitle}>创建我的店铺</Text>
          <Text style={styles.empty}>先有店，相册和“以店铺名义发布”才可用。</Text>
          <TextInput value={newShopName} onChangeText={setNewShopName} placeholder="商家名称（对外展示）" placeholderTextColor={color.muted} style={styles.createInput} />
          <TextInput value={newStoreName} onChangeText={setNewStoreName} placeholder="首店店名" placeholderTextColor={color.muted} style={styles.createInput} />
          <TextInput value={newStoreAddr} onChangeText={setNewStoreAddr} placeholder="首店地址（可选）" placeholderTextColor={color.muted} style={styles.createInput} />
          {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
          <Pressable disabled={creating} onPress={() => void createShop()} style={styles.createBtn}>
            <Text style={styles.createBtnText}>{creating ? "创建中…" : "创建店铺"}</Text>
          </Pressable>
        </View>
      ) : null}
      {accounts?.map((a) => {
        const aStores = stores[a.id] ?? [];
        const aMembers = members[a.id] ?? [];
        const aSpend = spend[a.id];
        return (
          <View key={a.id} style={styles.accountCard}>
            <View style={styles.accountHead}>
              <Text style={styles.accountName}>{a.name}</Text>
              <Text style={styles.accountMeta}>{a.id.slice(0, 8)} · {a.status}</Text>
            </View>
            {aStores.length === 0 ? (
              <View>
                <Text style={styles.empty}>暂无店铺，在下面直接加一家。</Text>
                <TextInput value={newStoreName} onChangeText={setNewStoreName} placeholder="店名" placeholderTextColor={color.muted} style={styles.createInput} />
                <TextInput value={newStoreAddr} onChangeText={setNewStoreAddr} placeholder="地址（可选）" placeholderTextColor={color.muted} style={styles.createInput} />
                <Pressable disabled={creating} onPress={() => void addStore(a.id)} style={styles.createBtn}>
                  <Text style={styles.createBtnText}>{creating ? "添加中…" : "新增店铺"}</Text>
                </Pressable>
              </View>
            ) : null}
            {aStores.map((s) => {
              const sPhotos = photos[s.id] ?? [];
              const sLines = lines[s.id];
              return (
                <View key={s.id} style={styles.storeCard}>
                  <View style={styles.storeHead}>
                    <Text style={styles.storeName}>{s.name}</Text>
                    <Text style={styles.storeMeta}>{s.address || "—"} · {s.status}</Text>
                  </View>

                  {sLines ? (
                    <View style={styles.linesBlock}>
                      <Text style={styles.linesDescription}>{sLines.description || "（暂无简介）"}</Text>
                      <Text style={styles.linesContact}>
                        {[sLines.contactPhone, sLines.contactEmail].filter(Boolean).join(" · ") || "联系方式未填写"}
                      </Text>
                      {Object.keys(linesAsHoursObject(sLines.hoursJson)).length > 0 ? (
                        <Text style={styles.linesHours}>
                          {Object.entries(linesAsHoursObject(sLines.hoursJson)).map(([k, v]) => `${k} ${v}`).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.photoHead}>
                    <Text style={styles.photoHeadTitle}>店铺相册</Text>
                    <Text style={styles.photoHeadMeta}>{sPhotos.length} 张</Text>
                  </View>
                  <Pressable
                    onPress={() => pickAndUploadPhoto(s.id)}
                    disabled={uploadingStoreId === s.id}
                    style={[styles.uploadButton, uploadingStoreId === s.id ? styles.uploadButtonBusy : null]}
                  >
                    <Text style={styles.uploadButtonText}>
                      {uploadingStoreId === s.id ? "上传中…" : "+ 上传照片"}
                    </Text>
                  </Pressable>
                  {sPhotos.length === 0 ? (
                    <Text style={styles.empty}>暂无照片 — 点上面按钮上传第一张</Text>
                  ) : null}
                  {sPhotos.map((p) => (
                    <View key={p.id} style={styles.photoRow}>
                      <View style={styles.photoRowMain}>
                        <Text style={styles.photoAssetPath} numberOfLines={1}>{p.assetPath}</Text>
                        <Text style={styles.photoMeta}>
                          {p.caption ? `${p.caption} · ` : ""}{new Date(p.createdAt).toLocaleString()}
                        </Text>
                      </View>
                      {viewerAccountId && viewerAccountId === p.uploadedBy ? (
                        <Pressable onPress={() => deletePhoto(s.id, p.id)} style={styles.deleteButton}>
                          <Text style={styles.deleteButtonText}>删除</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              );
            })}

            {aMembers.length > 0 ? (
              <View style={styles.membersBlock}>
                <Text style={styles.sectionTitle}>成员目录</Text>
                {aMembers.map((m) => (
                  <View key={m.userId} style={styles.memberRow}>
                    <Text style={styles.memberName}>{m.displayName || m.userId}</Text>
                    <Text style={styles.memberMeta}>{m.role} · {m.status}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {aSpend && aSpend.totalOrders > 0 ? (
              <View style={styles.spendBlock}>
                <Text style={styles.sectionTitle}>近 7 天销售</Text>
                <View style={styles.spendRow}>
                  <View style={styles.spendItem}>
                    <Text style={styles.spendValue}>{aSpend.totalOrders}</Text>
                    <Text style={styles.spendLabel}>订单</Text>
                  </View>
                  <View style={styles.spendItem}>
                    <Text style={styles.spendValue}>{formatVnd(aSpend.totalGrossMinor)}</Text>
                    <Text style={styles.spendLabel}>成交额</Text>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 10, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  accountCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, gap: 12, ...shadows.card },
  accountHead: { gap: 2 },
  accountName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  accountMeta: { color: color.muted, fontSize: 11 },
  storeCard: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  storeHead: { gap: 2 },
  storeName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  storeMeta: { color: color.muted, fontSize: 11 },
  linesBlock: { gap: 2, paddingVertical: 4 },
  linesDescription: { color: color.ink, fontSize: 12 },
  linesContact: { color: color.muted, fontSize: 11 },
  linesHours: { color: color.muted, fontSize: 11 },
  photoHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoHeadTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  photoHeadMeta: { color: color.muted, fontSize: 11 },
  uploadButton: { alignSelf: "flex-start", backgroundColor: color.lime, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  uploadButtonBusy: { opacity: 0.5 },
  uploadButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.white, borderColor: color.line, borderRadius: 8, borderWidth: 1, padding: 8 },
  photoRowMain: { flex: 1, gap: 2 },
  photoAssetPath: { color: color.ink, fontSize: 11, fontWeight: "600" },
  photoMeta: { color: color.muted, fontSize: 11 },
  deleteButton: { backgroundColor: "#fde7e7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  deleteButtonText: { color: "#a32020", fontSize: 11, fontWeight: "800" },
  membersBlock: { gap: 4, paddingTop: 6, borderTopColor: color.line, borderTopWidth: 1 },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  memberRow: { flexDirection: "row", justifyContent: "space-between" },
  memberName: { color: color.ink, fontSize: 12, fontWeight: "700" },
  memberMeta: { color: color.muted, fontSize: 11 },
  spendBlock: { gap: 6, paddingTop: 6, borderTopColor: color.line, borderTopWidth: 1 },
  spendRow: { flexDirection: "row", gap: 16 },
  spendItem: { gap: 2 },
  spendValue: { color: color.ink, fontSize: 16, fontWeight: "900" },
  spendLabel: { color: color.muted, fontSize: 11 },
  empty: { color: color.muted, fontSize: 12, paddingVertical: 4 },
  errorText: { color: "#a32020", fontSize: 12 },
  createTitle: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  createInput: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  createBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 10, paddingVertical: 12 },
  createBtnText: { color: color.white, fontSize: 13, fontWeight: "800" },
});
