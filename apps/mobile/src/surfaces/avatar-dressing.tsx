import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";

type Look = "day" | "night" | "linen";

const LOOKS: Array<{ id: Look; title: string; subtitle: string; swatches: [string, string] }> = [
  { id: "day", title: "西湖日常", subtitle: "轻薄针织 · 半裙", swatches: ["#71D8D2", "#EFF3FF"] },
  { id: "night", title: "Creator Night", subtitle: "短外套 · 直筒裤", swatches: [color.magenta, "#231B32"] },
  { id: "linen", title: "亚麻下午茶", subtitle: "短西装 · 短裙", swatches: [color.lime, "#ECE4D8"] }
];

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row]! * b[column * 4]! + a[4 + row]! * b[column * 4 + 1]! + a[8 + row]! * b[column * 4 + 2]! + a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * range, -1, 0, 0, near * far * range * 2, 0]);
}

function transform(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): Mat4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]);
}

function hex(value: string): [number, number, number, number] {
  const code = value.replace("#", "");
  return [parseInt(code.slice(0, 2), 16) / 255, parseInt(code.slice(2, 4), 16) / 255, parseInt(code.slice(4, 6), 16) / 255, 1];
}

const VERTEX = `
  attribute vec3 aPosition;
  uniform mat4 uMvp;
  uniform vec4 uColor;
  varying vec4 vColor;
  void main() { gl_Position = uMvp * vec4(aPosition, 1.0); vColor = uColor; }
`;

const FRAGMENT = `
  precision mediump float;
  varying vec4 vColor;
  void main() { gl_FragColor = vColor; }
`;

function shader(gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error("无法创建 3D shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  return result;
}

function program(gl: ExpoWebGLRenderingContext): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error("无法创建 3D program");
  gl.attachShader(result, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(result, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(result);
  return result;
}

const BOX_VERTICES = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5
]);
const BOX_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3, 1, 7, 6, 1, 6, 2, 7, 4, 5, 7, 5, 6, 4, 0, 3, 4, 3, 5, 3, 2, 6, 3, 6, 5, 4, 7, 1, 4, 1, 0
]);

function AvatarScene({ look, yaw }: { look: Look; yaw: React.MutableRefObject<number> }): React.JSX.Element {
  const lookRef = useRef(look);
  const live = useRef(true);
  lookRef.current = look;
  useEffect(() => () => { live.current = false; }, []);

  return <GLView style={styles.gl} onContextCreate={(gl) => {
    const drawProgram = program(gl);
    const position = gl.getAttribLocation(drawProgram, "aPosition");
    const mvp = gl.getUniformLocation(drawProgram, "uMvp");
    const tone = gl.getUniformLocation(drawProgram, "uColor");
    const vertices = gl.createBuffer();
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, BOX_VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, BOX_INDICES, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(drawProgram);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);

    const render = () => {
      if (!live.current) return;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.972, 0.957, 0.976, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const view = transform(0, -0.1, -5.1, 1, 1, 1, yaw.current);
      const projection = perspective(Math.PI / 4.1, width / height, 0.1, 20);
      const palette = lookRef.current === "night"
        ? { top: color.magenta, lower: "#241D32", trim: color.violet }
        : lookRef.current === "linen"
          ? { top: color.lime, lower: "#ECE4D8", trim: "#BBD925" }
          : { top: "#71D8D2", lower: "#E9EEFF", trim: "#279F9B" };
      const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, shade: string) => {
        if (!mvp || !tone) return;
        const model = transform(x, y, z, sx, sy, sz, 0);
        gl.uniformMatrix4fv(mvp, false, multiply(projection, multiply(view, model)));
        gl.uniform4fv(tone, hex(shade));
        gl.drawElements(gl.TRIANGLES, BOX_INDICES.length, gl.UNSIGNED_SHORT, 0);
      };
      // The avatar is intentionally geometry, not a 2D cut-out: torso, limbs and garments all rotate in depth.
      box(0, 1.46, 0, 0.48, 0.46, 0.34, "#F2C8B7");
      box(0, 1.75, 0, 0.5, 0.12, 0.38, "#2A2534");
      box(0, 1.09, 0, 0.18, 0.14, 0.18, "#F2C8B7");
      box(0, 0.57, 0, 0.82, 0.94, 0.42, palette.top);
      box(-0.55, 0.64, 0, 0.18, 0.9, 0.22, "#F2C8B7");
      box(0.55, 0.64, 0, 0.18, 0.9, 0.22, "#F2C8B7");
      box(-0.22, -0.7, 0, 0.3, 1.55, 0.3, palette.lower);
      box(0.22, -0.7, 0, 0.3, 1.55, 0.3, palette.lower);
      box(-0.22, -1.52, 0.08, 0.34, 0.18, 0.56, "#1B1820");
      box(0.22, -1.52, 0.08, 0.34, 0.18, 0.56, "#1B1820");
      box(0, 0.5, 0.23, 0.58, 0.05, 0.04, palette.trim);
      gl.flush();
      gl.endFrameEXP();
      requestAnimationFrame(render);
    };
    render();
  }} />;
}

export function AvatarDressingSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [look, setLook] = useState<Look>("day");
  const [saved, setSaved] = useState(false);
  const yaw = useRef(0);
  const rotate = (degrees: number) => { yaw.current += (degrees * Math.PI) / 180; };

  return <View style={styles.root}>
    <View style={styles.header}><Pressable accessibilityLabel="返回 Creator" onPress={onBack} style={styles.back}><ProxyIcon color={color.ink} name="chevronLeft" size={22} /></Pressable><View><Text style={styles.h1}>小美 3D 换装</Text><Text style={styles.meta}>Linh · Creator 公开展示草稿</Text></View></View>
    <View style={styles.sceneWrap}><AvatarScene look={look} yaw={yaw} /><View pointerEvents="none" style={styles.sceneHint}><Text style={styles.sceneHintText}>实时 3D 预览</Text></View><View style={styles.rotateBar}><Pressable accessibilityLabel="向左旋转" onPress={() => rotate(-30)} style={styles.rotateButton}><Text style={styles.rotateText}>↶ 30°</Text></Pressable><Pressable accessibilityLabel="重置角度" onPress={() => { yaw.current = 0; }} style={styles.rotateButton}><Text style={styles.rotateText}>正面</Text></Pressable><Pressable accessibilityLabel="向右旋转" onPress={() => rotate(30)} style={styles.rotateButton}><Text style={styles.rotateText}>30° ↷</Text></Pressable></View></View>
    <Text style={styles.sectionTitle}>选择展示造型</Text><View style={styles.lookList}>{LOOKS.map((item) => <Pressable key={item.id} onPress={() => setLook(item.id)} style={[styles.look, look === item.id && styles.lookSelected]}><View style={styles.swatches}><View style={[styles.swatch, { backgroundColor: item.swatches[0] }]} /><View style={[styles.swatch, { backgroundColor: item.swatches[1] }]} /></View><View style={styles.lookCopy}><Text style={styles.lookTitle}>{item.title}</Text><Text style={styles.meta}>{item.subtitle}</Text></View><Text style={[styles.selectedMark, look === item.id && styles.selectedMarkOn]}>{look === item.id ? "已选" : "选择"}</Text></Pressable>)}</View>
    <View style={styles.boundary}><Text style={styles.boundaryTitle}>展示与真源分离</Text><Text style={styles.boundaryText}>当前是本机实时 3D 换装草稿；写真级数字人、体型数据和服装资产只从服务器签发并可撤回，不在 App 端生成或保存真人敏感资产。</Text></View>
    <Pressable onPress={() => setSaved(true)} style={styles.save}><Text style={styles.saveText}>{saved ? "展示草稿已保存" : "保存展示草稿"}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1, padding: 16 },
  header: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12 },
  back: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  h1: { color: color.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.7, lineHeight: 30 },
  meta: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  sceneWrap: { backgroundColor: "#F8F5FA", borderColor: color.line, borderRadius: 24, borderWidth: 1, height: 366, overflow: "hidden", position: "relative" },
  gl: { height: "100%", width: "100%" }, sceneHint: { backgroundColor: "rgba(23,19,29,0.86)", borderRadius: 999, left: 14, paddingHorizontal: 10, paddingVertical: 6, position: "absolute", top: 14 }, sceneHintText: { color: color.white, fontSize: 11, fontWeight: "800" },
  rotateBar: { bottom: 14, flexDirection: "row", gap: 6, left: 14, position: "absolute", right: 14 }, rotateButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, height: 38, justifyContent: "center" }, rotateText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24, marginTop: 18 }, lookList: { gap: 8, marginTop: 10 }, look: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 66, padding: 10 }, lookSelected: { borderColor: color.violet, backgroundColor: "#FBF9FF" }, swatches: { flexDirection: "row", height: 44, width: 44 }, swatch: { borderRadius: 14, height: 44, marginLeft: -10, width: 30 }, lookCopy: { flex: 1 }, lookTitle: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 }, selectedMark: { color: color.muted, fontSize: 11, fontWeight: "800" }, selectedMarkOn: { color: color.violet },
  boundary: { backgroundColor: color.surface, borderRadius: 16, marginTop: 14, padding: 12 }, boundaryTitle: { color: color.ink, fontSize: 12, fontWeight: "800" }, boundaryText: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 }, save: { alignItems: "center", backgroundColor: color.lime, borderRadius: 14, height: 48, justifyContent: "center", marginTop: 14 }, saveText: { color: color.ink, fontSize: 14, fontWeight: "800" }
});
