import * as Haptics from 'expo-haptics';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export type PokerAction = 'fold' | 'call' | 'raise' | 'all-in';

interface ActionBarProps {
  callAmount: number;
  minRaise: number;
  isYourTurn: boolean;
  onAction: (action: PokerAction, amount?: number) => void;
  disabled?: boolean;
}

export function ActionBar({
  callAmount,
  minRaise,
  isYourTurn,
  onAction,
  disabled = false,
}: ActionBarProps) {
  const handlePress = (action: PokerAction, amount?: number) => {
    if (action === 'all-in') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (isYourTurn) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onAction(action, amount);
  };

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [styles.button, styles.fold, pressed && styles.pressed]}
        onPress={() => handlePress('fold')}
        disabled={disabled || !isYourTurn}>
        <ThemedText style={styles.buttonText}>Fold</ThemedText>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.button, styles.call, pressed && styles.pressed]}
        onPress={() => handlePress('call')}
        disabled={disabled || !isYourTurn}>
        <ThemedText style={styles.buttonText}>Call {callAmount > 0 ? callAmount : '—'}</ThemedText>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.button, styles.raise, pressed && styles.pressed]}
        onPress={() => handlePress('raise', minRaise)}
        disabled={disabled || !isYourTurn}>
        <ThemedText style={styles.buttonText}>Raise</ThemedText>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.button, styles.allIn, pressed && styles.pressed]}
        onPress={() => handlePress('all-in')}
        disabled={disabled || !isYourTurn}>
        <ThemedText style={styles.buttonText}>All-In</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 1, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  fold: {
    backgroundColor: '#c62828',
  },
  call: {
    backgroundColor: '#1565c0',
  },
  raise: {
    backgroundColor: '#2e7d32',
  },
  allIn: {
    backgroundColor: '#6a1b9a',
  },
  pressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
