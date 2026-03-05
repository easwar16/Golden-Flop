import React, { useCallback, useRef } from 'react';
import { Image, Pressable, StyleSheet, type View } from 'react-native';

import { CARD_BACK, getCardImage } from '@/constants/card-images';
import type { CardValue } from '@/constants/poker';

export interface CardMagnifyInfo {
  card: CardValue;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PokerCardProps {
  card: CardValue | null;
  faceDown?: boolean;
  /** Override the auto-resolved image (rarely needed). */
  imageSource?: number;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  /** Called with card + screen position when user holds the card. */
  onMagnifyStart?: (info: CardMagnifyInfo) => void;
  /** Called when user releases the hold. */
  onMagnifyEnd?: () => void;
  style?: object;
}

export function PokerCard({
  card,
  faceDown = false,
  imageSource,
  onPress,
  onPressIn,
  onPressOut,
  onMagnifyStart,
  onMagnifyEnd,
  style,
}: PokerCardProps) {
  const ref = useRef<View>(null);

  // Resolve which image to show
  let source: number | undefined = imageSource;

  if (source == null) {
    if (faceDown || !card) {
      source = CARD_BACK;
    } else {
      source = getCardImage(card.rank, card.suit);
    }
  }

  const handlePressIn = useCallback(() => {
    onPressIn?.();
    if (onMagnifyStart && card && !faceDown) {
      ref.current?.measureInWindow((x, y, width, height) => {
        onMagnifyStart({ card, x, y, width, height });
      });
    }
  }, [onPressIn, onMagnifyStart, card, faceDown]);

  const handlePressOut = useCallback(() => {
    onPressOut?.();
    onMagnifyEnd?.();
  }, [onPressOut, onMagnifyEnd]);

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.card, style]}>
      <Image
        source={source ?? CARD_BACK}
        style={styles.image}
        resizeMode="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
