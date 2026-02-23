/**
 * DealingCards
 *
 * Self-contained component that watches the game phase and animates
 * 2 cards flying from the deck center to the local player's seat when
 * a new hand starts (phase → 'preflop').
 *
 * All shared values live here — zero state in Zustand.
 */

import React, { memo, useEffect, useRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useGameStore } from '../../stores/useGameStore';
import type { Point } from '../../animations/types';

interface Props {
  /** Center of the deck / community card area (absolute screen coords) */
  deckOrigin: Point;
  /** Center of the local player's seat avatar (absolute screen coords) */
  mySeatCenter: Point;
}

const CARD_W = 44;
const CARD_H = 62;
const DURATION = 460;
const STAGGER  = 150;
const ease = Easing.bezier(0.33, 1, 0.68, 1); // easeOutCubic

function DealingCards({ deckOrigin, mySeatCenter }: Props) {
  const phase = useGameStore((s) => s.phase);
  const prevPhase = useRef<string>('');

  // Card 1 shared values
  const tx1 = useSharedValue(0);
  const ty1 = useSharedValue(0);
  const sc1 = useSharedValue(1);
  const op1 = useSharedValue(0);

  // Card 2 shared values
  const tx2 = useSharedValue(0);
  const ty2 = useSharedValue(0);
  const sc2 = useSharedValue(1);
  const op2 = useSharedValue(0);

  const resetCards = () => {
    tx1.value = 0; ty1.value = 0; sc1.value = 1; op1.value = 0;
    tx2.value = 0; ty2.value = 0; sc2.value = 1; op2.value = 0;
  };

  const dealCard = (
    tx: Animated.SharedValue<number>,
    ty: Animated.SharedValue<number>,
    sc: Animated.SharedValue<number>,
    op: Animated.SharedValue<number>,
    delay: number,
    dx: number,
    dy: number,
  ) => {
    const cfg = { duration: DURATION, easing: ease };
    op.value = withDelay(delay, withTiming(1, { duration: 40 }));
    tx.value = withDelay(delay, withTiming(dx, cfg));
    ty.value = withDelay(delay, withTiming(dy, cfg));
    sc.value = withDelay(delay, withTiming(0.88, { duration: DURATION * 0.65, easing: ease }));
  };

  useEffect(() => {
    if (phase === 'preflop' && prevPhase.current !== 'preflop') {
      resetCards();

      const dx = mySeatCenter.x - deckOrigin.x;
      const dy = mySeatCenter.y - deckOrigin.y;

      dealCard(tx1, ty1, sc1, op1, 0,       dx - 14, dy);
      dealCard(tx2, ty2, sc2, op2, STAGGER,  dx + 14, dy);

      // Hide after cards have arrived (table shows the real PokerCard components)
      const hideAfter = STAGGER + DURATION + 600;
      const t = setTimeout(() => {
        op1.value = withTiming(0, { duration: 200 });
        op2.value = withTiming(0, { duration: 200 });
      }, hideAfter);

      return () => clearTimeout(t);
    }
    prevPhase.current = phase;
  }, [phase]);

  const style1 = useAnimatedStyle(() => ({
    opacity: op1.value,
    transform: [{ translateX: tx1.value }, { translateY: ty1.value }, { scale: sc1.value }],
  }));

  const style2 = useAnimatedStyle(() => ({
    opacity: op2.value,
    transform: [{ translateX: tx2.value }, { translateY: ty2.value }, { scale: sc2.value }],
  }));

  const base = {
    left: deckOrigin.x - CARD_W / 2,
    top:  deckOrigin.y - CARD_H / 2,
  };

  return (
    <>
      <Animated.View style={[styles.card, base, style1]} pointerEvents="none">
        <Image source={require('../../assets/images/card-back.png')} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      </Animated.View>
      <Animated.View style={[styles.card, base, style2]} pointerEvents="none">
        <Image source={require('../../assets/images/card-back.png')} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      </Animated.View>
    </>
  );
}

export default memo(DealingCards);

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 50,
  },
});
