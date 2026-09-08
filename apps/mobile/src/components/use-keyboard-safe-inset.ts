import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

// Shared keyboard-overlap truth for fixed-height surfaces inside AppShell.
// Consumers reserve this exact overlap at their root so a composer can never
// be covered by the system keyboard. Android already resizes the app window.
export function useKeyboardSafeInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const frameSub = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const windowHeight = Dimensions.get("window").height;
      setInset(Math.max(0, windowHeight - event.endCoordinates.screenY));
    });
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setInset(0));
    return () => {
      frameSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
