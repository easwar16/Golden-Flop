/**
 * FlyingCard
 *
 * A single card-back image that animates from the deck origin to a seat.
 * Position it absolutely at the deck origin; translateX/Y moves it to the seat.
 *
 * Usage:
 *   const state = useMemo(() => createDealCardState(), []);
 *   <FlyingCard state={state} deckX={dx} deckY={dy} />
 */

import React, { memo } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { DealCardState } from '../../animations/useCardDealAnimation';

const CARD_W = 44;
const CARD_H = 62;

interface Props {
  state:  DealCardState;
  deckX:  number; // absolute screen x of deck center
  deckY:  number; // absolute screen y of deck center
  width?:  number;
  height?: number;
}

function FlyingCard({ state, deckX, deckY, width = CARD_W, height = CARD_H }: Props) {
  const aStyle = useAnimatedStyle(() => ({
    opacity: state.opacity.value,
    transform: [
      { translateX: state.translateX.value },
      { translateY: state.translateY.value },
      { scale: state.scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.card,
        {
          width,
          height,
          left: deckX - width / 2,
          top:  deckY - height / 2,
        },
        aStyle,
      ]}
      pointerEvents="none"
    >
      <Image
        source={require('../../assets/images/card-back.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="stretch"
      />
    </Animated.View>
  );
}

export default memo(FlyingCard);

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: 6,
    overflow: 'hidden',
  },
});
