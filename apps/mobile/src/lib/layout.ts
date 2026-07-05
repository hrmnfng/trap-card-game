/**
 * Pure layout math for clearing the transparent navigation header (kept
 * Expo-free so it stays unit-testable — see AGENTS.md).
 *
 * The Stack renders `headerTransparent: true`, so every screen pads its own
 * top. `useHeaderHeight()` is the right amount — but on Android, native-stack
 * misreports it under a transparent header (0, or just the status-bar inset),
 * which put game content behind the back arrow on device builds while web
 * looked fine. Clamp the measurement to the platform's default header height
 * (`getDefaultHeaderHeight`): where measurement works the two agree and the
 * measurement wins; where it fails the default keeps content clear.
 */
export function headerClearance(measuredHeight: number, defaultHeight: number): number {
  return Math.max(measuredHeight, defaultHeight);
}
