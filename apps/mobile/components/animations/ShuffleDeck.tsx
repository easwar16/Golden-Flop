/**
 * ShuffleDeck
 *
 * Renders a stack of card-back images that play a shuffle animation.
 * Mount it at the deck origin position (absolute, centered on that point).
 * Call `triggerShuffle()` when a new hand begins.
 *
 * Usage:
 *   const shuffleRef = useRef<ShuffleDeckHandle>(null);
 *   <ShuffleDeck ref={shuffleRef} />
 *   shuffleRef.current?.shuffle();
 */

import React, { forwardRef, useImperativeHandle, memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useShuffleAnimation, SHUFFLE_CARD_COUNT } from '../../animations/useShuffleAnimation';

const CARD_W = 44;
const CARD_H = 62;

export interface ShuffleDeckHandle {
  shuffle: () => void;
}

interface Props {
  /** Size of each card back (default matches community card size) */
  cardWidth?:  number;
  cardHeight?: number;
}

const ShuffleDeck = forwardRef<ShuffleDeckHandle, Props>(function ShuffleDeck(
  { cardWidth = CARD_W, cardHeight = CARD_H },
  ref,
) {
  const { cards, triggerShuffle } = useShuffleAnimation();

  useImperativeHandle(ref, () => ({ shuffle: triggerShuffle }), [triggerShuffle]);

  return (
    <View style={[styles.deck, { width: cardWidth + 24, height: cardHeight + 12 }]}>
      {cards.map((card, i) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const aStyle = useAnimatedStyle(() => ({
          transform: [
            { translateX: card.translateX.value },
            { rotate: `${card.rotate.value}deg` },
          ],
          opacity: card.opacity.value,
          zIndex: SHUFFLE_CARD_COUNT - i,
        }));

        return (
          <Animated.View key={i} style={[styles.cardWrap, aStyle]}>
            <Image
              source={require('../../assets/images/card-back.png')}
              style={{ width: cardWidth, height: cardHeight, borderRadius: 6 }}
              resizeMode="stretch"
            />
          </Animated.View>
        );
      })}
    </View>
  );
});

export default memo(ShuffleDeck);

const styles = StyleSheet.create({
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrap: {
    position: 'absolute',
  },
});
