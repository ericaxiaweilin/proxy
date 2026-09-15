import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  clampToRadius,
  googleMapsUrl,
  MAX_MANUAL_TWEAK_METERS,
  metersBetweenPoints
} from "./location-options";

describe("LOC-PIN-3KM-001 clamp manual tweaks to 3km", () => {
  const anchor = { lat: 21.0285, lng: 105.8542 };

  it("leaves nearby points alone", () => {
    const near = { lat: 21.03, lng: 105.855 };
    const out = clampToRadius(anchor, near);
    expect(out.clamped).toBe(false);
    expect(out.point).toEqual(near);
  });

  it("pulls far points back to exactly 3km along the same bearing", () => {
    const far = { lat: 21.2, lng: 105.8542 };
    expect(metersBetweenPoints(anchor, far)).toBeGreaterThan(MAX_MANUAL_TWEAK_METERS);
    const out = clampToRadius(anchor, far);
    expect(out.clamped).toBe(true);
    const dist = metersBetweenPoints(anchor, out.point);
    expect(Math.abs(dist - MAX_MANUAL_TWEAK_METERS)).toBeLessThan(5);
  });

  it("haversine agrees with a known city scale", () => {
    // 还剑湖到西湖约 4km（北向）。数量级对就算过，不钉小数。
    const dist = metersBetweenPoints(anchor, { lat: 21.065, lng: 105.8542 });
    expect(dist).toBeGreaterThan(3000);
    expect(dist).toBeLessThan(6000);
  });
});

describe("LOC-SHARE-001 google maps link", () => {
  it("builds a universal maps link for the coordinates", () => {
    expect(googleMapsUrl(21.0285, 105.8542)).toBe("https://maps.google.com/?q=21.0285,105.8542");
  });
});

describe("LOC-PIN-3KM-001 / LOC-SHARE-001 picker wiring", () => {
  const picker = readFileSync(
    fileURLToPath(new URL("./location-picker-sheet.tsx", import.meta.url)),
    "utf8"
  );
  const canvas = readFileSync(
    fileURLToPath(new URL("./map-canvas.tsx", import.meta.url)),
    "utf8"
  );

  it("distinguishes drag-tweaks from tap-jumps and clamps only the drag", () => {
    // 点选跳远地方不受限（全球选点是既有功能），拖 pin 微调才限 3KM。
    expect(canvas).toContain('onMarkerDragEnd');
    expect(canvas).toContain('onPress={(e) => commitFromLatLng(e.nativeEvent.coordinate');
    expect(picker).toContain("clampToRadius");
    expect(picker).toContain("MAX_MANUAL_TWEAK_METERS");
    expect(picker).toContain("拖动超出3公里");
  });

  it("offers copy-address and google-maps actions on the picked point", () => {
    expect(picker).toContain("复制地址");
    expect(picker).toContain("Google地图");
    expect(picker).toContain("googleMapsUrl");
    expect(picker).toContain("已复制");
  });
});
