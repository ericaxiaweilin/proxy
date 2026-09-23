import React, { useCallback, useRef } from "react";
import { Dimensions, Modal, StyleSheet, View, VirtualizedList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

// CONTENT-ANALYTICS-001：全屏看图要知道「这张被放大看了」（双击 / 捏合）。
// react-native-image-viewing 的单图组件 ImageItem 其实有 onZoom(scaled) 回调，但外层 ImageViewing 把它吞了、
// 没有对外暴露。这里照 ImageViewing（MIT，JOB TODAY S.A.，v0.2.2 dist/ImageViewing.js）的结构重组一个薄壳，
// 直接复用库里的 ImageItem（手势 / 双击放大 / 下滑关闭都还是库的实现），只多把 onZoom 往外报。
// 不改依赖包本身：共享工作区里给依赖打补丁要重装依赖，风险更大。

type ImageSource = { uri: string };

type ImageItemProps = {
  imageSrc: ImageSource;
  onRequestClose: () => void;
  onZoom: (scaled: boolean) => void;
  onLongPress: (image: ImageSource) => void;
  delayLongPress: number;
  swipeToCloseEnabled?: boolean;
  doubleTapToZoomEnabled?: boolean;
};

// Metro 按平台解析 ImageItem.ios.js / ImageItem.android.js。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageItem = (require("react-native-image-viewing/dist/components/ImageItem/ImageItem") as { default: React.ComponentType<ImageItemProps> }).default;

const SCREEN_WIDTH = Dimensions.get("screen").width;

export function TrackedImageViewing({ images, imageIndex, onRequestClose, onImageIndexChange, onZoomChange, backgroundColor, header }: {
  images: ImageSource[];
  imageIndex: number;
  onRequestClose: () => void;
  onImageIndexChange: (index: number) => void;
  onZoomChange: (index: number, scaled: boolean) => void;
  backgroundColor: string;
  header: React.ReactNode;
}): React.JSX.Element {
  const listRef = useRef<VirtualizedList<ImageSource>>(null);
  const currentRef = useRef(imageIndex);
  const onZoom = useCallback((scaled: boolean) => {
    // 同库原逻辑：放大时锁住横滑，免得拖动放大图时翻页。
    (listRef.current as unknown as { setNativeProps?: (props: object) => void } | null)?.setNativeProps?.({ scrollEnabled: !scaled });
    onZoomChange(currentRef.current, scaled);
  }, [onZoomChange]);
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (next !== currentRef.current && next >= 0 && next < images.length) {
      currentRef.current = next;
      onImageIndexChange(next);
    }
  };
  return (
    <Modal animationType="fade" hardwareAccelerated onRequestClose={onRequestClose} supportedOrientations={["portrait"]} visible>
      <View style={[styles.container, { backgroundColor }]}>
        <View pointerEvents="box-none" style={styles.header}>{header}</View>
        <VirtualizedList<ImageSource>
          data={images}
          getItem={(_, index) => images[index] as ImageSource}
          getItemCount={() => images.length}
          getItemLayout={(_, index) => ({ index, length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index })}
          horizontal
          initialNumToRender={1}
          initialScrollIndex={imageIndex}
          keyExtractor={(item, index) => `${index}:${item.uri}`}
          maxToRenderPerBatch={1}
          onMomentumScrollEnd={onScrollEnd}
          pagingEnabled
          ref={listRef}
          renderItem={({ item }) => (
            <ImageItem delayLongPress={800} doubleTapToZoomEnabled imageSrc={item} onLongPress={() => undefined} onRequestClose={onRequestClose} onZoom={onZoom} swipeToCloseEnabled />
          )}
          showsHorizontalScrollIndicator={false}
          windowSize={2}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { position: "absolute", top: 0, width: "100%", zIndex: 1 },
});
