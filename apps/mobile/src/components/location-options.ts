// Location data + types for the home / feed location picker.
// Kept as a pure .ts file (no JSX, no react-native imports) so
// vitest can import it directly without bundling react-native.
// The .tsx sheet file in this directory renders these options
// inside a Modal but never recomputes them — adding a city here
// is the only edit needed to grow the picker.

export interface LocationOption {
  id: string;
  city: string;
  area: string;
  desc: string;
  // icon id is rendered by the sheet via ProxyIcon; the data
  // layer intentionally stays free of the icon component so this
  // file can be imported by pure tests.
  icon: string;
}

export interface Location {
  id: string;
  city: string;
  area: string;
}

export const LOCATION_OPTIONS: ReadonlyArray<LocationOption> = [
  { id: "hn-swordlake", city: "河内", area: "还剑湖附近", desc: "老城、咖啡馆、湖边人像", icon: "route" },
  { id: "hn-westlake", city: "河内", area: "西湖周边", desc: "日落、咖啡、慢门", icon: "camera" },
  { id: "hcm-d1", city: "胡志明市", area: "第一郡", desc: "咖啡街、范五老、滨城市集", icon: "diamond" },
  { id: "dn-hanriver", city: "岘港", area: "韩江附近", desc: "龙桥、咖啡、伴手礼", icon: "circle" }
];

export const DEFAULT_LOCATION: Location = {
  id: "hn-swordlake",
  city: "河内",
  area: "还剑湖附近"
};
