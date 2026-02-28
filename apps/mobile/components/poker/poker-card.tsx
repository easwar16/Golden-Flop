import React from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';

import { CARD_BACK, getCardImage } from '@/constants/card-images';
import type { CardValue } from '@/constants/poker';

interface PokerCardProps {
  card: CardValue | null;
  faceDown?: boolean;
  /** Override the auto-resolved image (rarely needed). */
  imageSource?: number;
  onPressIn?: () => void;
  onPressOut?: () => void;
  style?: object;
}

export function PokerCard({
  card,
  faceDown = false,
  imageSource,
  onPressIn,
  onPressOut,
  style,
}: PokerCardProps) {
  // Resolve which image to show
  let source: number | undefined = imageSource;

  if (source == null) {
    if (faceDown || !card) {
      source = CARD_BACK;
    } else {
      source = getCardImage(card.rank, card.suit);
    }
  }

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
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
