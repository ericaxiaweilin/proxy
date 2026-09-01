// MapPin — R15.32.1: Custom marker icon for MapCanvas (LocationPicker).
//
// The default react-native-maps <Marker pinColor="..."> renders a
// system balloon pin (red on iOS, blue on Android). The user feedback
// was that the default pin is "ugly" (Google Maps red drop on iOS
// doesn't fit the Proxy violet theme).
//
// We replace it with a custom marker view:
//   - Outer ring (Proxy violet `#8033F0`) for the head
//   - Inner white dot
//   - Solid violet teardrop tip pointing at the lat/lng
//   - 32×40 viewBox; rendered as SVG so it scales cleanly
//
// Usage:
//   <Marker coordinate={c}>
//     <MapPin />
//   </Marker>
//
// The tip of the teardrop aligns with the marker's `coordinate`, so
// the pin is still accurate to the meter.
import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { View } from "react-native";

const VIOLET = "#8033F0";

export function MapPin(props: { size?: number }): React.JSX.Element {
  const size = props.size ?? 36;
  return (
    <View style={{ width: size, height: size * 1.25, alignItems: "center" }}>
      <Svg height={size * 1.25} viewBox="0 0 32 40" width={size}>
        {/* Teardrop body */}
        <Path
          d="M16 39C16 39 4 25 4 14.5C4 7 9.5 1 16 1C22.5 1 28 7 28 14.5C28 25 16 39 16 39Z"
          fill={VIOLET}
          stroke={VIOLET}
          strokeWidth={1}
        />
        {/* White inner dot */}
        <Circle cx={16} cy={14.5} fill="#FFFFFF" r={4.5} />
        {/* Subtle inner ring */}
        <Circle cx={16} cy={14.5} fill="none" r={6.5} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
      </Svg>
    </View>
  );
}
