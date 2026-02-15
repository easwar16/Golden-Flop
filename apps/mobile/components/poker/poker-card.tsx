import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CardValue } from '@/constants/poker';
import { RED_SUITS } from '@/constants/poker';

interface PokerCardProps {
  card: CardValue | null;
  faceDown?: boolean;
  onPressIn?: () => void;
  onPressOut?: () => void;
  style?: object;
}

export function PokerCard({ card, faceDown = false, onPressIn, onPressOut, style }: PokerCardProps) {
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
    borderWidth: 1,
    borderColor: '#444',
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
