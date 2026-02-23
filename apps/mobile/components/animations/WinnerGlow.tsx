/**
 * WinnerGlow
 *
 * Renders a gold shimmer + pulsing glow overlay on the winning seat.
 * Mount it inside the seat slot; show/hide via `state.glowOpacity`.
 *
 * Usage:
 *   const winState = useMemo(() => createWinnerAnimState(), []);
 *   <WinnerGlow state={winState} size={64} />
 *   winAnim.triggerWin(winState);
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { WinnerAnimState } from '../../animations/useWinnerAnimation';

interface Props {
  state: WinnerAnimState;
  size?: number; // match the avatar wrap size
}

function WinnerGlow({ state, size = 64 }: Props) {
  const glowStyle = useAnimatedStyle(() => ({
    opacity: state.glowOpacity.value,
    transform: [{ scale: state.glowScale.value }],
  }));

  const shimmerStyle = useAnimatedStyle(() => {
    // Shimmer stripe sweeps from left to right
    const pct = state.shimmerPos.value; // -1 → 2
    return {
      transform: [{ translateX: size * pct - size * 0.3 }],
      opacity: Math.max(0, 1 - Math.abs(pct)),
    };
  });

  const glowSize = size + 24;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { width: size, height: size }]}
    >
      {/* Outer gold glow ring */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: glowSize,
            height: glowSize,
            borderRadius: glowSize / 2,
            top: -(glowSize - size) / 2,
            left: -(glowSize - size) / 2,
          },
          glowStyle,
        ]}
      />

      {/* Shimmer stripe */}
      <Animated.View
        style={[styles.shimmerStripe, { height: size * 1.4, top: -size * 0.2 }, shimmerStyle]}
      />
    </View>
  );
}

export default memo(WinnerGlow);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'visible',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 215, 0, 0.55)',
  },
  shimmerStripe: {
    position: 'absolute',
    width: 20,
    backgroundColor: 'rgba(255, 255, 200, 0.7)',
    transform: [{ rotate: '20deg' }],
    left: 0,
  },
});
