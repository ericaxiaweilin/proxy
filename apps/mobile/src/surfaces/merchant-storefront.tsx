// MERCHANT_STOREFRONT — R18.x 真接商家店铺
// 之前 43 行只列账号；现在拉 account + store + photo album + lines +
// spend_daily + member_directory, 全部 server-authoritative.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { color, shadows } from "../theme";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
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

export function MerchantStorefrontSurface({ client, viewerAccountId, header }: { client: BusinessClient; viewerAccountId?: string | undefined; header?: ReactNode }): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stores, setStores] = useState<Record<string, Store[]>>({});
  const [photos, setPhotos] = useState<Record<string, StorePhoto[]>>({});
  const [lines, setLines] = useState<Record<string, StoreLines | undefined>>({});
  // R18.x LINES-EDITOR-001: the storefront now lets a
  // BUSINESS_WRITE_REQUIRED viewer edit logo / description /
  // hours / contact for each store. The form is inline
  // (no modal): editing toggles a few TextInputs and a
  // 保存 button, mirrors the photo uploader pattern.
  const [editingLinesFor, setEditingLinesFor] = useState<string | undefined>(undefined);
  const [editingDescription, setEditingDescription] = useState<string>("");
  const [editingContactPhone, setEditingContactPhone] = useState<string>("");
  const [editingContactEmail, setEditingContactEmail] = useState<string>("");
  const [editingHoursJson, setEditingHoursJson] = useState<string>("");
  const [editingLogoPath, setEditingLogoPath] = useState<string>("");
  const [savingLinesFor, setSavingLinesFor] = useState<string | undefined>(undefined);
  const [linesError, setLinesError] = useState<string | undefined>(undefined);
  const [members, setMembers] = useState<Record<string, MemberDirectory[]>>({});
  const [spend, setSpend] = useState<Record<string, { totalOrders: number; totalGrossMinor: number; days: SpendDaily[] } | undefined>>({});
  const [uploadingStoreId, setUploadingStoreId] = useState<string | undefined>(undefined);
  const [activeManager, setActiveManager] = useState<{ storeId: string; section: "INFO" | "PHOTOS" } | undefined>(undefined);
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

  // R18.x LINES-EDITOR-001: open the inline edit form.
  // Pre-fills from the current lines row; if the store
  // has no row yet, all fields are blank. The user can
  // also paste a JSON object for hours, with an inline
  // error if the JSON is malformed (validated client-side
  // before sending to the server).
  function startEditLines(storeId: string, current: StoreLines | undefined): void {
    setLinesError(undefined);
    setEditingLinesFor(storeId);
    setEditingDescription(current?.description ?? "");
    setEditingContactPhone(current?.contactPhone ?? "");
    setEditingContactEmail(current?.contactEmail ?? "");
    setEditingHoursJson(current?.hoursJson ?? "{}");
    setEditingLogoPath(current?.logoAssetPath ?? "");
  }

  async function saveLines(storeId: string): Promise<void> {
    setLinesError(undefined);
    // Validate hours JSON before sending: business server
    // will reject empty / non-object hoursJson, but a
    // local pre-check gives the user a clearer error.
    let hoursJson = editingHoursJson.trim() || "{}";
    if (hoursJson.length > 0) {
      try {
        const parsed: unknown = JSON.parse(hoursJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setLinesError("营业时间必须是 JSON 对象，例如 {周一至周五:09:00-18:00}");
          return;
        }
      } catch {
        setLinesError("营业时间 JSON 格式不正确");
        return;
      }
    }
    setSavingLinesFor(storeId);
    try {
      const saved = await client.upsertStoreLines({
        storeId,
        logoAssetPath: editingLogoPath,
        description: editingDescription,
        hoursJson,
        contactPhone: editingContactPhone,
        contactEmail: editingContactEmail,
      });
      setLines((prev) => ({ ...prev, [storeId]: saved }));
      setEditingLinesFor(undefined);
    } catch (e) {
      setLinesError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLinesFor(undefined);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      {header}
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
        const aSpend = spend[a.id];
        const newCustomers = aSpend?.days.reduce((sum, day) => sum + day.newCustomerCount, 0) ?? 0;
        const returningCustomers = aSpend?.days.reduce((sum, day) => sum + day.returningCustomerCount, 0) ?? 0;
        return (
          <View key={a.id} style={styles.accountCard}>
            <View style={styles.accountHead}>
              <Text style={styles.accountName}>{a.name}</Text>
              <Text style={styles.accountMeta}>{a.status} · {aStores.length} 家门店</Text>
            </View>
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>{a.name}</Text>
              <Text style={styles.summaryMeta}>线上店铺 · 近 7 天真实数据</Text>
              <View style={styles.summaryStats}>{[[aStores.length.toString(), "门店"], [(aSpend?.totalOrders ?? 0).toString(), "订单"], [newCustomers.toString(), "新客"], [returningCustomers.toString(), "复购"]].map(([value, label]) => <View key={label} style={styles.summaryStat}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>)}</View>
            </View>
            <Text style={styles.blockTitle}>访问 → 行动</Text>
            <View style={styles.funnel}>{[[(aSpend?.totalOrders ?? 0).toString(), "订单"], [newCustomers.toString(), "新客"], [returningCustomers.toString(), "复购"], [aSpend ? formatVnd(aSpend.totalGrossMinor) : "—", "成交额"]].map(([value, label]) => <View key={label} style={styles.funnelItem}><Text numberOfLines={1} style={styles.funnelValue}>{value}</Text><Text style={styles.funnelLabel}>{label}</Text></View>)}</View>
            <View style={styles.sourceBox}><Text style={styles.blockTitleInside}>流量来源</Text><Text style={styles.empty}>归因接口尚未提供来源拆分；不使用历史假百分比。</Text></View>
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

                  <Text style={styles.blockTitleInside}>店铺管理</Text>
                  <View style={styles.manageGrid}>
                    {([
                      ["storeLines", "店铺信息", sLines ? "名称 · Logo · 地址 · 营业时间" : "待完善", () => { setActiveManager({ storeId: s.id, section: "INFO" }); setEditingLinesFor(undefined); }],
                      ["storefront", "菜单与价格", "等待商品接口", undefined],
                      ["target", "相册", `${sPhotos.length} 张`, () => setActiveManager({ storeId: s.id, section: "PHOTOS" })],
                      ["spark", "当前展示", "活动 · 券 · 推荐内容", undefined],
                    ] as const).map(([icon, title, meta, action]) => <Pressable disabled={!action} key={title} onPress={action} style={styles.manageCard}><View style={styles.manageIcon}><ProxyIcon color={color.ink} name={icon as ProxyIconName} size={23} /></View><Text style={styles.manageTitle}>{title}</Text><Text style={styles.manageMeta}>{meta}</Text></Pressable>)}
                  </View>

                  {activeManager?.storeId === s.id && activeManager.section === "INFO" && sLines ? (
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

                  {/* R18.x LINES-EDITOR-001: inline edit form. */}
                  {activeManager?.storeId === s.id && activeManager.section === "INFO" && editingLinesFor === s.id ? (
                    <View style={styles.linesEditForm}>
                      <Text style={styles.linesEditLabel}>店铺简介</Text>
                      <TextInput
                        value={editingDescription}
                        onChangeText={setEditingDescription}
                        placeholder="一句话讲清这家店是做什么的"
                        placeholderTextColor={color.muted}
                        multiline
                        style={[styles.createInput, styles.linesEditTextarea]}
                      />
                      <Text style={styles.linesEditLabel}>联系手机</Text>
                      <TextInput
                        value={editingContactPhone}
                        onChangeText={setEditingContactPhone}
                        placeholder="可选"
                        placeholderTextColor={color.muted}
                        keyboardType="phone-pad"
                        style={styles.createInput}
                      />
                      <Text style={styles.linesEditLabel}>联系邮箱</Text>
                      <TextInput
                        value={editingContactEmail}
                        onChangeText={setEditingContactEmail}
                        placeholder="可选"
                        placeholderTextColor={color.muted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      <Text style={styles.linesEditLabel}>营业时间 (JSON 对象，如 {"{周一至周五 09:00-18:00}"}）</Text>
                      <TextInput
                        value={editingHoursJson}
                        onChangeText={setEditingHoursJson}
                        placeholder="{}"
                        placeholderTextColor={color.muted}
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      <Text style={styles.linesEditLabel}>Logo 资产路径 (assets/... 或 ai-personas/...)</Text>
                      <TextInput
                        value={editingLogoPath}
                        onChangeText={setEditingLogoPath}
                        placeholder="可选, 例如 assets/store-logo.jpg"
                        placeholderTextColor={color.muted}
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      {linesError ? <Text style={styles.errorText}>{linesError}</Text> : null}
                      <View style={styles.linesEditActions}>
                        <Pressable
                          disabled={savingLinesFor === s.id}
                          onPress={() => {
                            setEditingLinesFor(undefined);
                            setLinesError(undefined);
                          }}
                          style={[styles.createBtn, styles.linesEditCancel]}
                        >
                          <Text style={styles.createBtnText}>取消</Text>
                        </Pressable>
                        <Pressable
                          disabled={savingLinesFor === s.id}
                          onPress={() => void saveLines(s.id)}
                          style={[styles.createBtn, savingLinesFor === s.id && styles.createBtnBusy]}
                        >
                          <Text style={styles.createBtnText}>
                            {savingLinesFor === s.id ? "保存中…" : "保存"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : activeManager?.storeId === s.id && activeManager.section === "INFO" ? (
                    <Pressable
                      onPress={() => startEditLines(s.id, sLines)}
                      style={styles.linesEditToggle}
                    >
                      <Text style={styles.linesEditToggleText}>
                        {sLines ? "编辑主页 / 联系方式 / 营业时间" : "填写主页 / 联系方式 / 营业时间"}
                      </Text>
                    </Pressable>
                  ) : null}

                  {activeManager?.storeId === s.id && activeManager.section === "PHOTOS" ? <View style={styles.managerPanel}><View style={styles.photoHead}>
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
                  ))}</View> : null}
                </View>
              );
            })}
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
  accountCard: { gap: 12 },
  accountHead: { gap: 2 },
  accountName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  accountMeta: { color: color.muted, fontSize: 11 },
  storeCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 14, gap: 8, ...shadows.card },
  summary: { backgroundColor: color.deep, borderRadius: 24, padding: 15 },
  summaryTitle: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  summaryMeta: { color: "#D7D0DD", fontSize: 12, lineHeight: 17, marginTop: 4 },
  summaryStats: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryStat: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)", borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 },
  summaryValue: { color: color.white, fontSize: 15, fontWeight: "900" },
  summaryLabel: { color: "#D8D1DD", fontSize: 10, fontWeight: "600", marginTop: 3 },
  blockTitle: { color: color.ink, fontSize: 17, fontWeight: "800", marginTop: 4 },
  blockTitleInside: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 2 },
  funnel: { flexDirection: "row", gap: 8 },
  funnelItem: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingHorizontal: 3, paddingVertical: 10 },
  funnelValue: { color: color.ink, fontSize: 13, fontWeight: "900" },
  funnelLabel: { color: color.muted, fontSize: 10, fontWeight: "600", marginTop: 3 },
  sourceBox: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 14 },
  manageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  manageCard: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 20, borderWidth: 1, minHeight: 132, padding: 14, width: "48.4%" },
  manageIcon: { alignItems: "center", backgroundColor: color.lime, borderRadius: 14, height: 44, justifyContent: "center", marginBottom: 9, width: 44 },
  manageTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  manageMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  storeHead: { gap: 2 },
  storeName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  storeMeta: { color: color.muted, fontSize: 11 },
  linesBlock: { gap: 2, paddingVertical: 4 },
  linesDescription: { color: color.ink, fontSize: 12 },
  linesContact: { color: color.muted, fontSize: 11 },
  linesHours: { color: color.muted, fontSize: 11 },
  managerPanel: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 8, marginTop: 4, padding: 12 },
  // R18.x LINES-EDITOR-001
  linesEditToggle: { paddingVertical: 6 },
  linesEditToggleText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  linesEditForm: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 12, borderWidth: 1, gap: 6, padding: 10 },
  linesEditLabel: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 4 },
  linesEditTextarea: { minHeight: 60, textAlignVertical: "top" },
  linesEditActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 6 },
  linesEditCancel: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
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
  createBtnBusy: { opacity: 0.6 },
  createBtnText: { color: color.white, fontSize: 13, fontWeight: "800" },
});
