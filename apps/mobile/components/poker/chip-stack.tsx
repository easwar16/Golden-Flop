import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

interface ChipStackProps {
  amount: number;
  label?: string;
}

export function ChipStack({ amount, label }: ChipStackProps) {
  return (
    <View style={styles.container}>
      <View style={styles.chip}>
        <ThemedText style={styles.amount}>{formatChips(amount)}</ThemedText>
      </View>
      {label ? <ThemedText style={styles.label}>{label}</ThemedText> : null}
    </View>
  );
}

function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  chip: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1a5fb4',
    borderWidth: 3,
    borderColor: '#3584e4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  amount: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  label: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.8,
  },
});
