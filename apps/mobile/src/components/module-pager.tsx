// Proxy 模块分页触控规范（docs/design/Proxy_Module_Pagination_Touch_Spec.md）§6 的统一分页组件。
// 选型：RN 核心 ScrollView horizontal + pagingEnabled —— 跟手拖动、松手吸附、边界阻尼回弹（§8/§9）、
// 横纵手势分离（§3）都是原生行为，零原生依赖；手势阈值纯函数在 module-pager-gesture.ts（供单测与未来升级原生 pager 复用）。
// 返回逻辑不在此处：§4/§13 规定 Back 一律退出整个模块（分页不是导航历史），由模块宿主注册 BackHandler。
import { ReactNode, useEffect, useRef, useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { color } from "../theme";
import { setLastPage } from "./module-pager-store";
import { decideExitRelease } from "./module-pager-gesture";

/** 规范 §14 PageDefinition：component 直接接已构造元素，页面与模块宿主共享状态。 */
export interface PagerPageDefinition {
  id: string;
  title?: string;
  component: ReactNode;
}

export interface ProxyModulePagerProps {
  moduleId: string;
  pages: PagerPageDefinition[];
  /** 规范 §14 initialPage：无停留记录时的起始页。 */
  initialPage?: number;
  /** 规范 §5 rememberPage（默认 true）：重进模块回到上次停留 Page。 */
  rememberPage?: boolean;
  /** 规范 §6 swipeEnabled（默认 true）：false 时仅程序化翻页。 */
  swipeEnabled?: boolean;
  /** 受控页码：外部跳转入口（如点击标题）。与内部滑动经 onPageChange 双向同步。 */
  page?: number | undefined;
  onPageChange?: (index: number) => void;
  /**
   * 规范 §4/§13「Back 一律退整个模块」的触屏形态：第 1 页继续右滑越过
   * 边界阻尼并松手（超过页宽 EXIT_COMMIT_RATIO）即触发。省略时该手势无效果。
   */
  onExit?: () => void;
  /** 规范 §7 方案 B 底部圆点弱指示；默认关闭，模块可自带标题式指示（方案 C）。 */
  dots?: boolean;
}

function clampIndex(index: number, total: number): number {
  return Math.max(0, Math.min(index, Math.max(0, total - 1)));
}

export function ProxyModulePager({
  moduleId,
  pages,
  initialPage = 0,
  rememberPage = true,
  swipeEnabled = true,
  page,
  onPageChange,
  onExit,
  dots = false
}: ProxyModulePagerProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const listRef = useRef<ScrollView>(null);
  const mounted = useRef(false);
  const previousWidth = useRef(width);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  // initialPage 显式传入时永远赢过停留记录：被动重进的 rememberPage 语义由模块宿主保证
  // （宿主初始化自身状态时读 store，再把结果作为 initialPage 传下来），pager 只负责把滑动
  // 结果持久化写回 store。否则程序化带意图重进（如"完成后跳已使用"）会与宿主状态错位。
  const [current, setCurrent] = useState<number>(() => clampIndex(initialPage, pages.length));
  const currentRef = useRef(current);
  currentRef.current = current;

  function commit(index: number): void {
    currentRef.current = index;
    setCurrent(index);
    if (rememberPage) setLastPage(moduleId, index);
  }

  // 挂载及窗口宽度变化时校正当前页，避免旋转/分屏/不同设备宽度后偏半页。
  useEffect(() => {
    const firstLayout = !mounted.current;
    const widthChanged = previousWidth.current !== width;
    mounted.current = true;
    previousWidth.current = width;
    if ((firstLayout && current > 0) || widthChanged) {
      requestAnimationFrame(() => listRef.current?.scrollTo({ x: current * width, animated: false }));
    }
  }, [current, width]);

  // 页面集合动态缩短时把状态收回有效范围。
  useEffect(() => {
    const target = clampIndex(current, pages.length);
    if (target !== current) {
      commit(target);
      listRef.current?.scrollTo({ x: target * width, animated: false });
      onPageChange?.(target);
    }
  }, [pages.length, width]);

  // 外部受控跳转（父组件改 page 时吸附过去；notify=false 避免回声）。
  useEffect(() => {
    if (page === undefined || !Number.isInteger(page) || page === currentRef.current) return;
    const target = clampIndex(page, pages.length);
    commit(target);
    listRef.current?.scrollTo({ x: target * width, animated: false });
  }, [page, width]);

  // 右滑过头退出（§4/§13）：越界深度在拖拽期用 onScroll 取负向峰值；
  // 判定同时挂 onScrollEndDrag（手指抬起必发）与 onMomentumScrollEnd
  // （快速滑动后的减速结束）——iOS 慢速松手没有动量阶段，只挂后者会漏。
  // 只认「当前在第 1 页 + 向右越界」，翻页拖拽（x≥0）不进入判定。
  const overscrollPeak = useRef(0);

  function noteOverscroll(x: number): void {
    if (currentRef.current === 0 && x < 0 && x < overscrollPeak.current) {
      overscrollPeak.current = x;
    }
  }

  /** 评估峰值并清零；命中阈值返回 true（仅当模块提供了 onExit）。 */
  function tryExit(velocityX = 0): boolean {
    const peak = -overscrollPeak.current;
    overscrollPeak.current = 0;
    return Boolean(onExit) && peak > 0 && decideExitRelease({ overscrollPx: peak, pageWidth: width, velocityPxPerMs: velocityX }) === "exit";
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    noteOverscroll(event.nativeEvent.contentOffset.x);
  }

  function handleScrollBeginDrag(): void {
    overscrollPeak.current = 0;
  }

  function handleScrollEndDrag(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    noteOverscroll(event.nativeEvent.contentOffset.x);
    if (tryExit(event.nativeEvent.velocity?.x ?? 0)) {
      exitRef.current?.();
      return;
    }
    // 慢拖可能没有 momentum 事件；用系统给出的目标位置同步 Tab 状态。
    const targetX = event.nativeEvent.targetContentOffset?.x ?? event.nativeEvent.contentOffset.x;
    const index = clampIndex(Math.round(targetX / width), pages.length);
    if (index !== currentRef.current) {
      commit(index);
      onPageChange?.(index);
    }
  }

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    if (tryExit()) {
      exitRef.current?.();
      return;
    }
    const index = clampIndex(Math.round(event.nativeEvent.contentOffset.x / width), pages.length);
    if (index !== currentRef.current) {
      commit(index);
      onPageChange?.(index);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        ref={listRef}
        horizontal
        pagingEnabled
        alwaysBounceHorizontal={true}
        scrollEnabled={swipeEnabled}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumEnd}
        style={styles.scroll}
      >
        {pages.map((item) => (
          <View key={item.id} style={[styles.page, { width }]}>
            {item.component}
          </View>
        ))}
      </ScrollView>
      {dots ? (
        <View style={styles.dots}>
          {pages.map((item, index) => (
            <Pressable key={item.id} onPress={() => { commit(clampIndex(index, pages.length)); listRef.current?.scrollTo({ x: index * width, animated: true }); onPageChange?.(index); }} hitSlop={6} style={styles.dotHit}>
              <View style={[styles.dot, index === current && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 页宽由 useWindowDimensions 提供；每页占满一屏宽度。 */
const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1, width: "100%" },
  scroll: { flex: 1 },
  dots: { alignItems: "center", flexDirection: "row", justifyContent: "center", paddingBottom: 10 },
  dotHit: { paddingHorizontal: 5, paddingVertical: 6 },
  dot: { backgroundColor: color.line, borderRadius: 3, height: 6, width: 6 },
  dotOn: { backgroundColor: color.ink }
});

// 说明：每页宽度本应显式设为窗口宽度，此处用 flex:1 + ScrollView 默认子项尺寸
// 在 RN 的 horizontal pagingEnabled 下等价于整屏宽；若后续引入非整屏布局再切显式宽度。
