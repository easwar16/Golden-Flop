import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useGame } from '@/contexts/game-context';

export default function LobbyScreen() {
  const { tables, joinTable, createTable } = useGame();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [smallBlind, setSmallBlind] = useState('10');
  const [bigBlind, setBigBlind] = useState('20');
  const [minBuyIn, setMinBuyIn] = useState('200');
  const [maxBuyIn, setMaxBuyIn] = useState('2000');

  const handleJoin = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    joinTable(tableId, table.minBuyIn);
    router.push(`/table/${tableId}`);
  };

  const handleCreate = () => {
    const sb = parseInt(smallBlind, 10) || 10;
    const bb = parseInt(bigBlind, 10) || 20;
    const min = parseInt(minBuyIn, 10) || 200;
    const max = parseInt(maxBuyIn, 10) || 2000;
    const table = createTable(sb, bb, min, max);
    setShowCreate(false);
    joinTable(table.id, min, table);
    router.push(`/table/${table.id}`);
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Tables
      </ThemedText>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {tables.map((t) => (
          <Pressable
            key={t.id}
            style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}
            onPress={() => handleJoin(t.id)}>
            <ThemedText style={styles.tableBlinds}>
              {t.smallBlind}/{t.bigBlind}
            </ThemedText>
            <ThemedText style={styles.tablePlayers}>{t.playerCount} players</ThemedText>
            <ThemedText style={styles.tableBuyIn}>
              Buy-in: {t.minBuyIn}–{t.maxBuyIn}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      {!showCreate ? (
        <Pressable
          style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
          onPress={() => setShowCreate(true)}>
          <ThemedText style={styles.createButtonText}>Create table</ThemedText>
        </Pressable>
      ) : (
        <View style={styles.createForm}>
          <TextInput
            style={styles.input}
            placeholder="Small blind"
            placeholderTextColor="#888"
            value={smallBlind}
            onChangeText={setSmallBlind}
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Big blind"
            placeholderTextColor="#888"
            value={bigBlind}
            onChangeText={setBigBlind}
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Min buy-in"
            placeholderTextColor="#888"
            value={minBuyIn}
            onChangeText={setMinBuyIn}
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Max buy-in"
            placeholderTextColor="#888"
            value={maxBuyIn}
            onChangeText={setMaxBuyIn}
            keyboardType="number-pad"
          />
          <Pressable style={[styles.createButton, styles.submit]} onPress={handleCreate}>
            <ThemedText style={styles.createButtonText}>Create & join</ThemedText>
          </Pressable>
          <Pressable onPress={() => setShowCreate(false)}>
            <ThemedText style={styles.cancel}>Cancel</ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  title: {
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  tableRow: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    gap: 4,
  },
  pressed: {
    opacity: 0.85,
  },
  tableBlinds: {
    fontWeight: '700',
    fontSize: 18,
  },
  tablePlayers: {
    opacity: 0.8,
  },
  tableBuyIn: {
    fontSize: 12,
    opacity: 0.7,
  },
  createButton: {
    backgroundColor: '#0a7ea4',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submit: {
    marginTop: 16,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  cancel: {
    marginTop: 12,
    textAlign: 'center',
    opacity: 0.8,
  },
  createForm: {
    marginTop: 16,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
  },
});
