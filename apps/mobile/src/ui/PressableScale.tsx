/**
 * A Pressable that scales down slightly while pressed. Forwards testID/onPress/
 * disabled so it is a drop-in for the existing primary buttons (keeps e2e selectors).
 */
import { useState, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import { DURATION } from './motion';

export function PressableScale({
  children,
  onPress,
  disabled,
  style,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <MotiView
        animate={{ scale: pressed && !disabled ? 0.96 : 1 }}
        transition={{ type: 'timing', duration: DURATION.fast }}
        style={style}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}
