// FacetHomeSurface — R15.25 FACET 对象化内容运营 (Phase 1.5).
//
// 设计来源: Proxy_COMPLETE_FiveRoot_FACET_v11.html (section FACET HOME + FACET OBJECTS list)
// 原则 "Not a sixth root" — FACET 是 ME tab 内的 deep module.
// 顶部 hero: Otter logo (真实 PNG, 非 emoji) + "对象化内容运营" + stats + nav + 对象 list.
// Phase 1.5 在 Phase 1 基础上补齐：真实 logo、ProxyIcon、重试/下拉刷新、对象预览与 LIBRARY/OBJECTS/OPS 子页.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { extractShownCount } from "./extract-shown-count";
import type { FacetConfig, FacetObject, FacetSideSpacePost, ListFacetObjectsPayload, SideSpaceCatalogPost } from "@proxy/contracts";
import { FacetClient, FacetProtocolError } from "../facet-client";
import { ProxyIcon } from "../components/proxy-icon";
import { Gradient, color, shadows } from "../theme";

const OTTER_LOGO = require("../../assets/otter-logo.png");

const RELATION_PILL: Record<FacetObject["relation"], string> = {
  BUILDING_TRUST: "重点关系",
  SHARED_INTEREST: "朋友",
  CREATOR_COLLAB: "合作",
};

// R15.43: FacetRecommendedKind 中文 label（副空间项 / 缺口推荐都用）
const KIND_LABEL: Record<string, string> = {
  "personal/real-life": "真实日常",
  "personal/honest": "真实软肋",
  "city/travel": "城市 · 旅行",
  "photo": "摄影",
  "shared-experience": "共同回忆",
  "portfolio/capability": "作品 · 能力",
  "intro/services": "服务介绍"
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function formatAddedAt(iso: string): string {
  // Phase 1.5: 简单转 "MM-DD HH:mm"，避免 Intl 依赖 (Hermes 不全)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Phase = "LOADING" | "READY" | "ERROR";
type FacetView = "HOME" | "LIBRARY" | "OBJECTS" | "OPS" | "PREVIEW";

type FacetHomeSurfaceProps = {
  client: FacetClient;
  onBack: () => void;
  onComingSoon?: (label: string) => void;
};

export function FacetHomeSurface({ client, onBack, onComingSoon }: FacetHomeSurfaceProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [payload, setPayload] = useState<ListFacetObjectsPayload | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [view, setView] = useState<FacetView>("HOME");
  const [previewObject, setPreviewObject] = useState<FacetObject | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  // R15.43: 副空间 state — catalog / add modal / 局部错误
  const [sideSpaceCatalog, setSideSpaceCatalog] = useState<SideSpaceCatalogPost[]>([]);
  const [sideSpaceAddOpen, setSideSpaceAddOpen] = useState(false);
  const [sideSpaceError, setSideSpaceError] = useState<string | undefined>();
  const [sideSpaceBusy, setSideSpaceBusy] = useState(false);

  const fetchObjects = useCallback(async (showLoading: boolean) => {
    if (showLoading) setPhase("LOADING");
    try {
      const data = await client.listObjects();
      setPayload(data);
      setPhase("READY");
      setErrorMessage(undefined);
      // R15.43: 同步拿副空间 catalog（Phase 1.5 = 5 条 mock），用于“添加副空间”选择器
      try {
        const cat = await client.listSideSpaceCatalog();
        setSideSpaceCatalog(cat.posts);
      } catch {
        // catalog 拿不到不影响主列表，setSideSpaceCatalog 保持空
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof FacetProtocolError ? err.message : "FACET 服务暂时不可用");
      setPhase("ERROR");
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    setPhase("LOADING");
    client.listObjects()
      .then((data: ListFacetObjectsPayload) => {
        if (cancelled) return;
        setPayload(data);
        setPhase("READY");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof FacetProtocolError ? err.message : "FACET 服务暂时不可用");
        setPhase("ERROR");
      });
    return () => { cancelled = true; };
  }, [client]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchObjects(false);
  }, [fetchObjects]);

  const handleRetry = useCallback(() => {
    void fetchObjects(true);
  }, [fetchObjects]);

  // ---------- R15.43 副空间操作 ----------
  // 乐观更新策略: add/remove 后本地立刻改 sideSpacePosts + previewObject，
  // 失败时回滚 + 错误提示。这样用户看到是瞬间响应，不需要重新拉列表。

  const refreshPreviewSideSpace = useCallback(async (objectId: string) => {
    try {
      const out = await client.listSideSpacePosts(objectId);
      setPayload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map((o) => o.id === objectId ? { ...o, sideSpacePosts: out.posts } : o)
        };
      });
      setPreviewObject((prev) => prev && prev.id === objectId ? { ...prev, sideSpacePosts: out.posts } : prev);
    } catch {
      // 静默: 乐观更新已经够用
    }
  }, [client]);

  const handleOpenAddSideSpace = useCallback(() => {
    if (sideSpaceCatalog.length === 0) {
      setSideSpaceError("副空间 catalog 尚未加载，请稍后再试");
      return;
    }
    setSideSpaceError(undefined);
    setSideSpaceAddOpen(true);
  }, [sideSpaceCatalog.length]);

  const handleAddSideSpacePost = useCallback(async (postId: string) => {
    if (!previewObject) return;
    setSideSpaceBusy(true);
    setSideSpaceError(undefined);
    // 乐观加一条到本地
    const cat = sideSpaceCatalog.find((p) => p.id === postId);
    if (cat) {
      const optimistic: FacetSideSpacePost = {
        id: cat.id, kind: cat.kind, title: cat.title, imageUrl: cat.imageUrl,
        addedAt: new Date().toISOString()
      };
      setPayload((prev) => prev ? {
        ...prev,
        objects: prev.objects.map((o) => o.id === previewObject.id
          ? { ...o, sideSpacePosts: [optimistic, ...o.sideSpacePosts] }
          : o)
      } : prev);
      setPreviewObject({ ...previewObject, sideSpacePosts: [optimistic, ...previewObject.sideSpacePosts] });
    }
    try {
      await client.addSideSpacePost(previewObject.id, postId);
      setSideSpaceAddOpen(false);
      // 服务器返回准确 addedAt，重新拉一次
      await refreshPreviewSideSpace(previewObject.id);
    } catch (err) {
      // 回滚乐观
      setPayload((prev) => prev ? {
        ...prev,
        objects: prev.objects.map((o) => o.id === previewObject.id
          ? { ...o, sideSpacePosts: o.sideSpacePosts.filter((p) => p.id !== postId) }
          : o)
      } : prev);
      setPreviewObject((prev) => prev ? {
        ...prev,
        sideSpacePosts: prev.sideSpacePosts.filter((p) => p.id !== postId)
      } : prev);
      setSideSpaceError(err instanceof FacetProtocolError ? err.message : "加入副空间失败");
    } finally {
      setSideSpaceBusy(false);
    }
  }, [client, previewObject, sideSpaceCatalog, refreshPreviewSideSpace]);

  const handleRemoveSideSpacePost = useCallback(async (postId: string) => {
    if (!previewObject) return;
    setSideSpaceBusy(true);
    setSideSpaceError(undefined);
    // 乐观移除
    const removed = previewObject.sideSpacePosts.find((p) => p.id === postId);
    setPayload((prev) => prev ? {
      ...prev,
      objects: prev.objects.map((o) => o.id === previewObject.id
        ? { ...o, sideSpacePosts: o.sideSpacePosts.filter((p) => p.id !== postId) }
        : o)
    } : prev);
    setPreviewObject({
      ...previewObject,
      sideSpacePosts: previewObject.sideSpacePosts.filter((p) => p.id !== postId)
    });
    try {
      await client.removeSideSpacePost(previewObject.id, postId);
    } catch (err) {
      // 回滚
      if (removed) {
        setPayload((prev) => prev ? {
          ...prev,
          objects: prev.objects.map((o) => o.id === previewObject.id
            ? { ...o, sideSpacePosts: [removed, ...o.sideSpacePosts] }
            : o)
        } : prev);
        setPreviewObject((prev) => prev ? {
          ...prev,
          sideSpacePosts: [removed, ...prev.sideSpacePosts]
        } : prev);
      }
      setSideSpaceError(err instanceof FacetProtocolError ? err.message : "移除副空间内容失败");
    } finally {
      setSideSpaceBusy(false);
    }
  }, [client, previewObject]);

  function openPreview(obj: FacetObject): void {
    setPreviewObject(obj);
    setView("PREVIEW");
  }

  function handleNav(label: string, target: FacetView): void {
    if (onComingSoon) {
      // 保持兼容：仍回调但同时进入内部子页，避免纯 stub “开发中” 无功能
      onComingSoon(label);
    }
    setView(target);
  }

  // 子页：PREVIEW / LIBRARY / OBJECTS / OPS
  if (view === "PREVIEW" && previewObject) {
    return (
      <>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setView("HOME")} style={styles.backRow}>
            <Text style={styles.backText}>‹ 返回 FACET</Text>
          </Pressable>
          <View style={styles.previewHead}>
            <View style={styles.previewAvatar}><Text style={styles.previewAvatarText}>{previewObject.displayName.charAt(0)}</Text></View>
            <View style={styles.previewCopy}>
              <View style={styles.objectNameRow}>
                <Text style={styles.objectName}>{previewObject.displayName}</Text>
                <View style={styles.objectPill}><Text style={styles.objectPillText}>{RELATION_PILL[previewObject.relation]}</Text></View>
              </View>
              <Text style={styles.previewSub}>{previewObject.currentState}</Text>
            </View>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>关系目标</Text>
            <Text style={styles.sectionCardBody}>{previewObject.goal}</Text>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>当前缺口</Text>
            <Text style={styles.sectionCardBody}>{previewObject.gap.summary}</Text>
            <Text style={styles.sectionCardAccent}>下一次：{previewObject.gap.nextShowAt}</Text>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>TA 将看到的你</Text>
            <Text style={styles.sectionCardHint}>同一份真实素材，按对象重新组织 · 人没有变，只是最相关的一面被优先呈现</Text>
            <View style={styles.previewFeed}>
              {/* R15.50: 预览 feed 从 server 字段生成 (不再 hardcode) */}
              {/* 1) 下一次推荐 — 来自 AI recommendedKind + gap */}
              <View style={styles.previewFeedItem}>
                <Text style={styles.previewFeedLabel}>优先 · {KIND_LABEL[previewObject.recommendedKind] ?? "未推荐"}</Text>
                <Text style={styles.previewFeedText}>
                  {previewObject.gap.summary} · 下次“{previewObject.gap.nextShowAt}”补 1 条
                </Text>
              </View>
              {/* 2) 现状计数 — 从 currentState 拆出“已展示 N 条” */}
              {(() => {
                const shown = extractShownCount(previewObject.currentState);
                return (
                  <View style={styles.previewFeedItem}>
                    <Text style={styles.previewFeedLabel}>已展示</Text>
                    <Text style={styles.previewFeedText}>
                      {shown !== null ? `已展示 ${shown} 条` : previewObject.currentState}
                    </Text>
                  </View>
                );
              })()}
              {/* 3) 副空间补充 — 仅合作方 (CREATOR_COLLAB) 显示, 拿 sideSpacePosts.length */}
              {previewObject.relation === "CREATOR_COLLAB" ? (
                <View style={styles.previewFeedItem}>
                  <Text style={styles.previewFeedLabel}>副空间 · 合作方可见</Text>
                  <Text style={styles.previewFeedText}>
                    {previewObject.sideSpaceFulfilled
                      ? `已补 ${previewObject.sideSpacePosts.length} 条 · 足够`
                      : previewObject.sideSpacePosts.length > 0
                      ? `已补 ${previewObject.sideSpacePosts.length} 条 · 还需 ${previewObject.sideSpaceGap.replace(/^还差\s*/, "") || "更多"}`
                      : "尚未补充副空间 · TA 看不到你隐藏的一面"}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          {/* R15.43: 副空间面板 — 仅合作方（CREATOR_COLLAB）显示 */}
          {previewObject.relation === "CREATOR_COLLAB" ? (
            <View style={styles.sectionCard}>
              <View style={styles.sideSpaceHeaderRow}>
                <Text style={styles.sectionCardTitle}>副空间</Text>
                <View style={styles.sideSpaceHeaderRight}>
                  {previewObject.sideSpaceFulfilled ? (
                    <View style={styles.sideSpaceFulfilledChip}>
                      <Text style={styles.sideSpaceFulfilledChipText}>✓ 已足够</Text>
                    </View>
                  ) : null}
                  <View style={styles.sideSpaceCountChip}>
                    <Text style={styles.sideSpaceCountChipText}>{previewObject.sideSpacePosts.length} 条</Text>
                  </View>
                </View>
              </View>
              {previewObject.sideSpaceGap ? (
                <View style={[styles.sideSpaceGapBlock, previewObject.sideSpaceFulfilled ? styles.sideSpaceGapBlockFulfilled : null]}>
                  <Text style={styles.sideSpaceGapLabel}>{previewObject.sideSpaceFulfilled ? "AI 副空间已足够" : "AI 副空间缺口"}</Text>
                  <Text style={styles.sideSpaceGapText}>{previewObject.sideSpaceGap}</Text>
                </View>
              ) : null}
              <View style={styles.sideSpaceList}>
                {previewObject.sideSpacePosts.length === 0 ? (
                  <Text style={styles.sideSpaceEmpty}>副空间还空，添加内容后只对{previewObject.displayName}可见</Text>
                ) : (
                  previewObject.sideSpacePosts.map((post) => (
                    <View key={post.id} style={styles.sideSpaceRow}>
                      <View style={styles.sideSpaceImagePlaceholder}><Text style={styles.sideSpaceImagePlaceholderText}>图</Text></View>
                      <View style={styles.sideSpaceRowCopy}>
                        <Text style={styles.sideSpaceRowTitle}>{post.title}</Text>
                        <Text style={styles.sideSpaceRowMeta}>{kindLabel(post.kind)} · {formatAddedAt(post.addedAt)}</Text>
                      </View>
                      <Pressable
                        onPress={() => { void handleRemoveSideSpacePost(post.id); }}
                        disabled={sideSpaceBusy}
                        style={styles.sideSpaceRemoveBtn}
                      >
                        <Text style={styles.sideSpaceRemoveBtnText}>移除</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
              {sideSpaceError ? <Text style={styles.sideSpaceError}>{sideSpaceError}</Text> : null}
              <Pressable
                onPress={handleOpenAddSideSpace}
                disabled={sideSpaceBusy}
                style={styles.sideSpaceAddBtn}
              >
                <Text style={styles.sideSpaceAddBtnText}>+ 添加到副空间</Text>
              </Pressable>
              <Text style={styles.sectionCardHint}>仅 {previewObject.displayName} 在“合作方副空间”看到这个池子，不会进入主空间 feed</Text>
            </View>
          ) : null}
          <Text style={styles.previewFoot}>Phase 1.5：预览为本地组织逻辑演示，后续接入真实素材分发</Text>
        </ScrollView>
      </View>
      <SideSpaceAddModal
        open={sideSpaceAddOpen}
        catalog={sideSpaceCatalog}
        existing={previewObject.sideSpacePosts}
        busy={sideSpaceBusy}
        onClose={() => setSideSpaceAddOpen(false)}
        onAdd={handleAddSideSpacePost}
      />
      </>
    );
  }

  if (view === "LIBRARY" || view === "OBJECTS" || view === "OPS") {
    const titles: Record<string, { title: string; desc: string }> = {
      LIBRARY: { title: "内容库", desc: "已展示 / 草稿 / 备选 · 同一份素材按对象复用" },
      OBJECTS: { title: "对象列表", desc: "按关系分组 · 每个对象独立的展示策略" },
      OPS: { title: "运营", desc: "边界 / 规则 / 高级生成 · 后续版本开放" },
    };
    const metaVal = titles[view as "LIBRARY" | "OBJECTS" | "OPS"] ?? titles.LIBRARY;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setView("HOME")} style={styles.backRow}>
            <Text style={styles.backText}>‹ 返回 FACET</Text>
          </Pressable>
          <Text style={styles.subPageTitle}>{metaVal!.title}</Text>
          <Text style={styles.subPageDesc}>{metaVal!.desc}</Text>
          {view === "LIBRARY" && payload ? (
            <View style={styles.subPageCard}>
              <SubRow label="已展示" value={`${payload.shownAssets} 条`} />
              <SubRow label="新鲜素材" value={`${payload.freshAssets} 个`} />
              <SubRow label="草稿" value="12 条 · 本地" />
              <SubRow label="备选" value="5 条 · 待审核" />
              <Text style={styles.subPageHint}>Phase 1.5：内容库为统计视图，上传与审核在后续版本</Text>
            </View>
          ) : null}
          {view === "OBJECTS" && payload ? (
            <View style={styles.subPageCard}>
              {(["BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB"] as const).map((rel) => {
                const group = payload.objects.filter((o: FacetObject) => o.relation === rel);
                if (group.length === 0) return null;
                return (
                  <View key={rel} style={styles.groupBlock}>
                    <Text style={styles.groupTitle}>{RELATION_PILL[rel]} · {group.length}</Text>
                    {group.map((o: FacetObject) => (
                      <Pressable key={o.id} onPress={() => openPreview(o)} style={styles.groupRow}>
                        <View style={styles.groupAvatar}><Text style={styles.groupAvatarText}>{o.displayName.charAt(0)}</Text></View>
                        <View style={styles.groupCopy}><Text style={styles.groupName}>{o.displayName}</Text><Text style={styles.groupState}>{o.currentState}</Text></View>
                        <Text style={styles.groupChevron}>›</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : null}
          {view === "OPS" ? (
            <OpsConfigPanel
              client={client}
              onClose={() => setView("HOME")}
            />
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.magenta} />}
      >
        <Pressable onPress={onBack} style={styles.backRow}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>

        {/* Hero — 使用真实 otter-logo.png + 渐变圆背景 */}
        <View style={styles.hero}>
          <View style={styles.heroBrand}>
            <Gradient from={color.magenta} to={color.violet} style={styles.heroOtter}>
              <Image accessibilityLabel="Proxy" source={OTTER_LOGO} style={styles.heroOtterImage} resizeMode="contain" />
            </Gradient>
            <View style={styles.heroWordWrap}>
              <Text style={styles.heroWord}>
                F<Text style={styles.heroAccent}>A</Text>CET
              </Text>
              <Text style={styles.heroTag}>对象化内容运营</Text>
            </View>
          </View>
          <Text style={styles.heroLead}>
            同一份真实素材，针对不同对象重新组织呈现方式。
            <Text style={styles.heroLeadSmall}>人没有变，只是最相关的一面被优先呈现。</Text>
          </Text>
        </View>

        {/* Stats */}
        {phase === "READY" && payload ? (
          <View style={styles.stats}>
            <StatBlock value={payload.totalObjects} label="对象" />
            <StatBlock value={payload.freshAssets} label="新鲜素材" />
            <StatBlock value={payload.shownAssets} label="已展示" />
          </View>
        ) : null}

        {phase === "LOADING" ? (
          <View style={styles.stateBlock}><ActivityIndicator color={color.magenta} /></View>
        ) : null}
        {phase === "ERROR" ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>FACET 服务暂时不可用</Text>
            <Text style={styles.errorHint}>{errorMessage ?? "请稍后重试"}</Text>
            <Pressable onPress={handleRetry} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>重试</Text>
            </Pressable>
            <Pressable onPress={onRefresh} style={styles.retrySubBtn}>
              <Text style={styles.retrySubText}>下拉也可刷新</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Nav cards — 使用 ProxyIcon 替代 unicode 占位 */}
        {phase === "READY" ? (
          <View style={styles.navGrid}>
            <NavCard label="内容库" sub="已展示 / 草稿 / 备选" iconName="image" onPress={() => handleNav("内容库", "LIBRARY")} />
            <NavCard label="对象列表" sub="按关系分组" iconName="target" onPress={() => handleNav("对象列表", "OBJECTS")} />
            <NavCard label="运营" sub="边界 / 规则 / 高级生成" iconName="settings" onPress={() => handleNav("运营", "OPS")} />
          </View>
        ) : null}

        {phase === "READY" && payload ? (
          <View style={styles.objectsSection}>
            <Text style={styles.sectionTitle}>对象</Text>
            <Text style={styles.sectionNote}>FACET 当前为每个对象独立判断展示方向</Text>
            <View style={styles.objectsList}>
              {payload.objects.length === 0 ? (
                <View style={styles.emptyCard}><Text style={styles.emptyText}>还没有对象</Text><Text style={styles.emptyHint}>创建首个对象后，这里会显示关系与缺口</Text></View>
              ) : payload.objects.map((obj: FacetObject) => (
                <ObjectCard
                  key={obj.id}
                  object={obj}
                  expanded={expandedId === obj.id}
                  onToggle={() => setExpandedId((current) => current === obj.id ? undefined : obj.id)}
                  onPreview={() => openPreview(obj)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.scopeFooter}>
          <Text style={styles.scopeFooterText}>
            Phase 1.5：列表 + 预览 + 内容库/分组/运营视图。真实图片与规则引擎在后续版本。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StatBlock({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function NavCard({ label, sub, iconName, onPress }: { label: string; sub: string; iconName: "image" | "target" | "settings" | "spark"; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.navCard}>
      <View style={styles.navIcon}><ProxyIcon color={color.ink} name={iconName} size={18} /></View>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navSub}>{sub}</Text>
    </Pressable>
  );
}

function ObjectCard({ object: obj, expanded, onToggle, onPreview }: { object: FacetObject; expanded: boolean; onToggle: () => void; onPreview: () => void }): React.JSX.Element {
  const initial = obj.displayName.charAt(0);
  return (
    <Pressable onPress={onToggle} style={styles.objectCard}>
      <View style={styles.objectHead}>
        <View style={styles.objectAvatar}><Text style={styles.objectAvatarText}>{initial}</Text></View>
        <View style={styles.objectHeadCopy}>
          <View style={styles.objectNameRow}>
            <Text style={styles.objectName}>{obj.displayName}</Text>
            <View style={styles.objectPill}><Text style={styles.objectPillText}>{RELATION_PILL[obj.relation]}</Text></View>
          </View>
          <Text style={styles.objectState} numberOfLines={expanded ? undefined : 2}>
            {obj.currentState}
          </Text>
        </View>
        <Text style={styles.objectChevron}>{expanded ? "▾" : "›"}</Text>
      </View>
      {expanded ? (
        <View style={styles.objectDetail}>
          <DetailRow label="关系目标" value={obj.goal} />
          <DetailRow label="当前缺口" value={obj.gap.summary} />
          <DetailRow label="下一次展示" value={obj.gap.nextShowAt} accent />
          <Pressable onPress={onPreview} style={styles.objectDetailBtn}>
            <Text style={styles.objectDetailBtnText}>查看 {obj.displayName} 看到的我</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, accent ? styles.detailValueAccent : null]}>{value}</Text>
    </View>
  );
}

function SubRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.subRow}>
      <Text style={styles.subRowLabel}>{label}</Text>
      <Text style={styles.subRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 10 },
  backRow: { paddingVertical: 6 },
  backText: { color: color.magenta, fontSize: 14, fontWeight: "800" },

  hero: { paddingBottom: 10, paddingTop: 4 },
  heroBrand: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 4 },
  heroOtter: { alignItems: "center", borderRadius: 16, height: 52, justifyContent: "center", overflow: "hidden", width: 52 },
  heroOtterImage: { height: 36, width: 36 },
  heroWordWrap: { flex: 1 },
  heroWord: { color: color.ink, fontSize: 28, fontWeight: "300", letterSpacing: 6 },
  heroAccent: { color: color.magenta, fontStyle: "normal" },
  heroTag: { color: color.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginTop: 4 },
  heroLead: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 21, marginTop: 14, paddingHorizontal: 2 },
  heroLeadSmall: { color: color.muted, fontSize: 10, fontWeight: "500", marginTop: 4 },

  stats: { flexDirection: "row", gap: 7, marginTop: 10 },
  statBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flex: 1, padding: 10, ...shadows.card },
  statValue: { color: color.ink, fontSize: 18, fontWeight: "800" },
  statLabel: { color: color.muted, fontSize: 9, fontWeight: "600", marginTop: 2 },

  stateBlock: { alignItems: "center", paddingVertical: 24 },
  errorText: { color: color.magenta, fontSize: 13, fontWeight: "700" },
  errorHint: { color: color.muted, fontSize: 11, marginTop: 4 },
  retryBtn: { backgroundColor: color.ink, borderRadius: 10, marginTop: 12, paddingHorizontal: 18, paddingVertical: 9 },
  retryBtnText: { color: color.white, fontSize: 12, fontWeight: "800" },
  retrySubBtn: { marginTop: 8, paddingVertical: 4 },
  retrySubText: { color: color.muted, fontSize: 11 },

  navGrid: { flexDirection: "row", gap: 7, marginTop: 18 },
  navCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 82, padding: 10 },
  navIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 9, height: 28, justifyContent: "center", width: 28 },
  navLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 },
  navSub: { color: color.muted, fontSize: 9, lineHeight: 12, marginTop: 3 },

  objectsSection: { marginTop: 18 },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  sectionNote: { color: color.muted, fontSize: 10, marginTop: 3 },
  objectsList: { gap: 8, marginTop: 10 },
  emptyCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 18 },
  emptyText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  emptyHint: { color: color.muted, fontSize: 11, marginTop: 4 },

  objectCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, padding: 11, ...shadows.card },
  objectHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  objectAvatar: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 21, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  objectAvatarText: { color: color.ink, fontSize: 16, fontWeight: "800" },
  objectHeadCopy: { flex: 1, minWidth: 0 },
  objectNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  objectName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  objectPill: { backgroundColor: color.attentionBg, borderColor: color.attentionBorder, borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  objectPillText: { color: color.magenta, fontSize: 9, fontWeight: "700" },
  objectState: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  objectChevron: { color: color.muted, fontSize: 18, fontWeight: "300" },

  objectDetail: { borderColor: color.line, borderTopWidth: 1, gap: 6, marginTop: 9, paddingTop: 9 },
  detailRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  detailLabel: { color: color.muted, fontSize: 10, fontWeight: "700", width: 64 },
  detailValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  detailValueAccent: { color: color.magenta, fontWeight: "800" },
  objectDetailBtn: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, marginTop: 8, paddingVertical: 10 },
  objectDetailBtnText: { color: color.magenta, fontSize: 11, fontWeight: "700" },

  scopeFooter: { marginTop: 18, paddingTop: 12 },
  scopeFooterText: { color: color.muted, fontSize: 10, lineHeight: 15, textAlign: "center" },

  // Preview / subpage
  previewHead: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 10, padding: 14, ...shadows.card },
  previewAvatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 16, height: 56, justifyContent: "center", width: 56 },
  previewAvatarText: { color: color.ink, fontSize: 16, fontWeight: "900" },
  previewCopy: { flex: 1 },
  previewSub: { color: color.muted, fontSize: 11, marginTop: 4 },
  sectionCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  sectionCardTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  sectionCardBody: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 6 },
  sectionCardHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  sectionCardAccent: { color: color.magenta, fontSize: 11, fontWeight: "800", marginTop: 6 },
  previewFeed: { gap: 8, marginTop: 10 },
  previewFeedItem: { backgroundColor: color.surface, borderRadius: 12, padding: 10 },
  previewFeedLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  previewFeedText: { color: color.muted, fontSize: 11, marginTop: 4 },
  previewFoot: { color: color.muted, fontSize: 10, lineHeight: 15, marginTop: 14, textAlign: "center" },
  // R15.43 副空间样式
  sideSpaceHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sideSpaceCountChip: { backgroundColor: "rgba(139, 92, 246, 0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sideSpaceCountChipText: { color: "#7c3aed", fontSize: 11, fontWeight: "600" },
  sideSpaceGapBlock: { backgroundColor: "rgba(245, 158, 11, 0.12)", borderLeftColor: "#f59e0b", borderLeftWidth: 3, borderRadius: 6, padding: 10, marginBottom: 12 },
  sideSpaceGapBlockFulfilled: { backgroundColor: "rgba(16, 185, 129, 0.12)", borderLeftColor: "#10b981" },
  sideSpaceGapLabel: { color: "#b45309", fontSize: 10, fontWeight: "700", marginBottom: 4, letterSpacing: 0.4 },
  sideSpaceGapText: { color: color.ink, fontSize: 13, lineHeight: 19 },
  sideSpaceHeaderRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideSpaceFulfilledChip: { backgroundColor: "rgba(16, 185, 129, 0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sideSpaceFulfilledChipText: { color: "#059669", fontSize: 11, fontWeight: "600" },
  sideSpaceList: { marginBottom: 4 },
  sideSpaceEmpty: { color: color.muted, fontSize: 12, lineHeight: 18, paddingVertical: 8, textAlign: "center" },
  sideSpaceRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  sideSpaceImagePlaceholder: { width: 44, height: 44, borderRadius: 8, backgroundColor: "rgba(139, 92, 246, 0.12)", alignItems: "center", justifyContent: "center", marginRight: 10 },
  sideSpaceImagePlaceholderText: { color: "#7c3aed", fontSize: 12, fontWeight: "600" },
  sideSpaceRowCopy: { flex: 1, marginRight: 8 },
  sideSpaceRowTitle: { color: color.ink, fontSize: 13, fontWeight: "500", marginBottom: 2 },
  sideSpaceRowMeta: { color: color.muted, fontSize: 10 },
  sideSpaceRemoveBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "rgba(239, 68, 68, 0.4)" },
  sideSpaceRemoveBtnText: { color: "#dc2626", fontSize: 11, fontWeight: "600" },
  sideSpaceError: { color: "#dc2626", fontSize: 12, lineHeight: 18, marginTop: 8 },
  sideSpaceAddBtn: { marginTop: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: "#7c3aed", alignItems: "center" },
  sideSpaceAddBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  // R15.43 Add 模态框
  sideSpaceModalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sideSpaceModalSheet: { backgroundColor: color.appBg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 24, maxHeight: "80%" },
  sideSpaceModalTitle: { color: color.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  sideSpaceModalDesc: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  sideSpaceCatalogRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  sideSpaceCatalogImage: { width: 40, height: 40, borderRadius: 6, backgroundColor: "rgba(139, 92, 246, 0.12)", alignItems: "center", justifyContent: "center", marginRight: 10 },
  sideSpaceCatalogImageText: { color: "#7c3aed", fontSize: 11, fontWeight: "600" },
  sideSpaceCatalogCopy: { flex: 1, marginRight: 8 },
  sideSpaceCatalogTitle: { color: color.ink, fontSize: 13, fontWeight: "500", marginBottom: 2 },
  sideSpaceCatalogMeta: { color: color.muted, fontSize: 10 },
  sideSpaceCatalogAddBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: "#7c3aed" },
  sideSpaceCatalogAddBtnText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  sideSpaceModalClose: { marginTop: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.12)", alignItems: "center" },
  sideSpaceModalCloseText: { color: color.ink, fontSize: 13, fontWeight: "500" },
  subPageTitle: { color: color.ink, fontSize: 18, fontWeight: "900", marginTop: 8 },
  subPageDesc: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  subPageCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  subRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  subRowLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  subRowValue: { color: color.ink, fontSize: 12, fontWeight: "800" },
  subPageHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  groupBlock: { marginTop: 8 },
  groupTitle: { color: color.ink, fontSize: 11, fontWeight: "800", marginBottom: 6 },
  groupRow: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 8 },
  groupAvatar: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 15, borderWidth: 1, height: 30, justifyContent: "center", width: 30 },
  groupAvatarText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  groupCopy: { flex: 1 },
  groupName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  groupState: { color: color.muted, fontSize: 10, marginTop: 2 },
  groupChevron: { color: color.muted, fontSize: 14 },
  opsTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  opsBody: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  // R15.51: 阈值滑块 / 按钮 / footer
  opsError: { color: "#dc2626", fontSize: 11, lineHeight: 16, marginTop: 8, padding: 6, backgroundColor: "rgba(220, 38, 38, 0.08)", borderRadius: 4 },
  opsSliderRow: { marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.08)" },
  opsSliderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  opsSliderLabel: { color: color.ink, fontSize: 12, fontWeight: "600", flex: 1 },
  opsSliderValue: { color: color.magenta, fontSize: 16, fontWeight: "800", marginLeft: 8 },
  opsSliderHint: { color: color.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  opsSliderControls: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  opsSliderBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.line, alignItems: "center", justifyContent: "center" },
  opsSliderBtnText: { color: color.ink, fontSize: 16, fontWeight: "800" },
  opsSliderBar: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 8, height: 32 },
  opsSliderDot: { width: 4, height: 16, backgroundColor: color.line, marginHorizontal: 1, borderRadius: 1 },
  opsSliderDotActive: { backgroundColor: color.magenta },
  opsConfigFooter: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.12)" },
  opsConfigVersion: { color: color.muted, fontSize: 10, lineHeight: 14, marginBottom: 8 },
  opsConfigActions: { flexDirection: "row", justifyContent: "space-between" },
  opsConfigCancel: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: color.line, alignItems: "center", marginRight: 8 },
  opsConfigCancelText: { color: color.ink, fontSize: 12, fontWeight: "600" },
  opsConfigSave: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: color.magenta, alignItems: "center" },
  opsConfigSaveDisabled: { opacity: 0.4 },
  opsConfigSaveText: { color: color.white, fontSize: 12, fontWeight: "700" },
});

// ---------- R15.43: 副空间添加 Modal ----------

type SideSpaceAddModalProps = {
  open: boolean;
  catalog: SideSpaceCatalogPost[];
  existing: FacetSideSpacePost[];
  busy: boolean;
  onClose: () => void;
  onAdd: (postId: string) => void;
};

function SideSpaceAddModal({ open, catalog, existing, busy, onClose, onAdd }: SideSpaceAddModalProps): React.JSX.Element {
  const existingIds = new Set(existing.map((p) => p.id));
  const available = catalog.filter((p) => !existingIds.has(p.id));
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sideSpaceModalRoot}>
        <View style={styles.sideSpaceModalSheet}>
          <Text style={styles.sideSpaceModalTitle}>添加到副空间</Text>
          <Text style={styles.sideSpaceModalDesc}>
            从内容池选择一条内容，只对你正在运营的合作方可见，不进入你的主空间 feed。
          </Text>
          {available.length === 0 ? (
            <Text style={styles.sideSpaceEmpty}>所有内容都已在副空间里</Text>
          ) : (
            <ScrollView style={{ maxHeight: 360 }}>
              {available.map((p) => (
                <View key={p.id} style={styles.sideSpaceCatalogRow}>
                  <View style={styles.sideSpaceCatalogImage}><Text style={styles.sideSpaceCatalogImageText}>图</Text></View>
                  <View style={styles.sideSpaceCatalogCopy}>
                    <Text style={styles.sideSpaceCatalogTitle}>{p.title}</Text>
                    <Text style={styles.sideSpaceCatalogMeta}>{kindLabel(p.kind)}</Text>
                  </View>
                  <Pressable
                    onPress={() => onAdd(p.id)}
                    disabled={busy}
                    style={styles.sideSpaceCatalogAddBtn}
                  >
                    <Text style={styles.sideSpaceCatalogAddBtnText}>{busy ? "…" : "添加"}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable onPress={onClose} style={styles.sideSpaceModalClose}>
            <Text style={styles.sideSpaceModalCloseText}>关闭</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------- R15.51 OpsConfigPanel (运营阈值实时编辑) ----------

type OpsConfigPanelProps = {
  client: FacetClient;
  onClose: () => void;
};

function OpsConfigPanel({ client, onClose }: OpsConfigPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<FacetConfig | undefined>();
  const [draft, setDraft] = useState<FacetConfig | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // 加载当前 config
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listFacetConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setDraft(cfg);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  // 拨动 draft (本地, 不发请求)
  function updateDraft<K extends keyof FacetConfig>(key: K, value: FacetConfig[K]): void {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  // 提交 (乐观锁 expectedVersion)
  async function handleSave(): Promise<void> {
    if (!config || !draft) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await client.updateFacetConfig({
        expectedVersion: config.version,
        patch: {
          sideSpaceHighThreshold: draft.sideSpaceHighThreshold,
          sideSpaceMidThreshold: draft.sideSpaceMidThreshold,
          priorityMidBoundary: draft.priorityMidBoundary,
          priorityHighBoundary: draft.priorityHighBoundary,
          confidenceFloor: draft.confidenceFloor,
          updatedBy: "ops_panel" // Phase 1.5 placeholder, 后续接 user id
        }
      });
      setConfig(updated);
      setDraft(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.subPageCard}>
        <Text style={styles.opsTitle}>加载中…</Text>
      </View>
    );
  }
  if (!draft || !config) {
    return (
      <View style={styles.subPageCard}>
        <Text style={styles.opsTitle}>加载失败</Text>
        {error ? <Text style={styles.opsError}>{error}</Text> : null}
      </View>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <View style={styles.subPageCard}>
      <Text style={styles.opsTitle}>运营阈值</Text>
      <Text style={styles.opsBody}>改动后点保存 — 乐观锁, 并发更新会被拒绝 (409)</Text>

      <SliderRow
        label="副空间 高意向阈值 (portfolio/capability)"
        value={draft.sideSpaceHighThreshold}
        min={0} max={10} step={1}
        hint="够了就算「足够」 · 默认 2"
        onChange={(v) => updateDraft("sideSpaceHighThreshold", v)}
      />
      <SliderRow
        label="副空间 中意向阈值 (intro/services)"
        value={draft.sideSpaceMidThreshold}
        min={0} max={10} step={1}
        hint="中意向 (priority 30-59) 专用 · 默认 2"
        onChange={(v) => updateDraft("sideSpaceMidThreshold", v)}
      />
      <SliderRow
        label="priority 中位边界"
        value={draft.priorityMidBoundary}
        min={0} max={100} step={5}
        hint="CollaborationIntent ≥ 此值为中意向 · 默认 30"
        onChange={(v) => updateDraft("priorityMidBoundary", v)}
      />
      <SliderRow
        label="priority 高位边界"
        value={draft.priorityHighBoundary}
        min={0} max={100} step={5}
        hint="CollaborationIntent ≥ 此值为高意向 · 默认 60"
        onChange={(v) => updateDraft("priorityHighBoundary", v)}
      />
      <SliderRow
        label="confidence 最低线"
        value={draft.confidenceFloor}
        min={0} max={100} step={5}
        hint="低于此 confidence 的推荐不展示 · 默认 50"
        onChange={(v) => updateDraft("confidenceFloor", v)}
      />

      <View style={styles.opsConfigFooter}>
        <Text style={styles.opsConfigVersion}>Version: {config.version} (期望匹配才会保存)</Text>
        {error ? <Text style={styles.opsError}>{error}</Text> : null}
        <View style={styles.opsConfigActions}>
          <Pressable
            onPress={() => { setDraft(config); setError(undefined); }}
            style={styles.opsConfigCancel}
            disabled={!dirty || saving}
          >
            <Text style={styles.opsConfigCancelText}>重置</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            style={[styles.opsConfigSave, (!dirty || saving) ? styles.opsConfigSaveDisabled : null]}
            disabled={!dirty || saving}
          >
            <Text style={styles.opsConfigSaveText}>{saving ? "保存中…" : "保存"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
};

function SliderRow({ label, value, min, max, step, hint, onChange }: SliderRowProps): React.JSX.Element {
  return (
    <View style={styles.opsSliderRow}>
      <View style={styles.opsSliderHeader}>
        <Text style={styles.opsSliderLabel}>{label}</Text>
        <Text style={styles.opsSliderValue}>{value}</Text>
      </View>
      <Text style={styles.opsSliderHint}>{hint}</Text>
      {/* Phase 1.5: 用 +/- 按钮组代替 Slider (避免引入 react-native-community/slider 依赖) */}
      <View style={styles.opsSliderControls}>
        <Pressable
          accessibilityLabel={`${label} 减少`}
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.opsSliderBtn}
        >
          <Text style={styles.opsSliderBtnText}>−</Text>
        </Pressable>
        <View style={styles.opsSliderBar}>
          {Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => {
            const v = min + i * step;
            const active = v <= value;
            return (
              <View
                key={v}
                style={[styles.opsSliderDot, active ? styles.opsSliderDotActive : null]}
              />
            );
          })}
        </View>
        <Pressable
          accessibilityLabel={`${label} 增加`}
          onPress={() => onChange(Math.min(max, value + step))}
          style={styles.opsSliderBtn}
        >
          <Text style={styles.opsSliderBtnText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}
