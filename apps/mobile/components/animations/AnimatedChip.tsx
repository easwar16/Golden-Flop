/**
 * AnimatedChip
 *
 * A chip stack that travels along a quadratic bezier arc.
 * Position is fully driven by `ChipStackState.x / y` (derived on UI thread).
 * Mount one instance per active seat in the table screen.
 *
 * Usage:
 *   const chipState = useMemo(() => createChipStackState(), []);
 *   <AnimatedChip state={chipState} />
 *   chipAnim.animateBet(chipState, layout, seatIdx);
 */

import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { ChipStackState } from '../../animations/useChipAnimation';

interface Props {
  state:  ChipStackState;
  label?: string; // e.g. "800K"
}

function AnimatedChip({ state, label }: Props) {
  const aStyle = useAnimatedStyle(() => ({
    opacity: state.opacity.value,
    transform: [
      { translateX: state.x.value },
      { translateY: state.y.value },
      { scale: state.scale.value },
    ],
  }));

  return (
    <Animated.View style={[styles.chip, aStyle]} pointerEvents="none">
      <View style={styles.stack}>
        {/* 3 stacked discs for depth */}
        <View style={[styles.disc, styles.disc3]} />
        <View style={[styles.disc, styles.disc2]} />
        <View style={[styles.disc, styles.disc1]} />
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Animated.View>
  );
}

export default memo(AnimatedChip);

const CHIP_SIZE = 28;

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    alignItems: 'center',
    width: CHIP_SIZE,
    height: CHIP_SIZE + 8,
    // origin is top-left; callers should offset by half if needed
  },
  stack: { width: CHIP_SIZE, height: CHIP_SIZE + 8, position: 'relative' },
  disc: {
    position: 'absolute',
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: CHIP_SIZE / 2,
    borderWidth: 2,
  },
  disc1: {
    top: 0,
    backgroundColor: '#FFD700',
    borderColor: '#B8860B',
    zIndex: 3,
  },
  disc2: {
    top: 3,
    backgroundColor: '#DAA520',
    borderColor: '#8B6914',
    zIndex: 2,
  },
  disc3: {
    top: 6,
    backgroundColor: '#B8860B',
    borderColor: '#704214',
    zIndex: 1,
  },
  label: {
    fontSize: 7,
    color: '#fff',
    fontWeight: '700',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
