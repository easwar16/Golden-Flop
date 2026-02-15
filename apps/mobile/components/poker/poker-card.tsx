import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CardValue } from '@/constants/poker';
import { RED_SUITS } from '@/constants/poker';

interface PokerCardProps {
  card: CardValue | null;
  faceDown?: boolean;
  /** When set, use this image asset (from card-assets); avoids loading 53 assets until table screen. */
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
  if (imageSource != null) {
    return (
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.card, style]}>
        <Image
          source={imageSource}
          style={styles.image}
          resizeMode="contain"
        />
      </Pressable>
    );
  }

  if (faceDown || !card) {
    return (
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.card, styles.cardBack, style]}>
        <View style={styles.backPattern} />
      </Pressable>
    );
  }

  const isRed = RED_SUITS.includes(card.suit);
  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} style={[styles.card, style]}>
      <ThemedText style={[styles.rank, isRed && styles.red]}>{card.rank}</ThemedText>
      <ThemedText style={[styles.suit, isRed && styles.red]}>{card.suit}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 56,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  cardBack: {
    backgroundColor: '#1a5fb4',
  },
  backPattern: {
    width: '80%',
    height: '80%',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  rank: {
    fontSize: 20,
    fontWeight: '700',
  },
  suit: {
    fontSize: 24,
  },
  red: {
    color: '#c01c28',
  },
});
