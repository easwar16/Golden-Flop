import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useState } from 'react';
import {
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SocketService } from '@/services/SocketService';
import { useLobbyStore } from '@/stores/useLobbyStore';
import { getPlayerName } from '@/utils/player-identity';
import { useWallet } from '@/contexts/wallet-context';

const TABLE_NAMES = ['PIXEL PARADISE', 'GOLDEN TABLE', 'ROYAL FLUSH', 'ACE HIGH'];
const MAX_PLAYERS = 6;

function truncateAddress(address: string | Uint8Array | undefined): string | null {
  if (!address) return null;
  if (typeof address === 'string') {
    if (address.length <= 10) return address;
    return address.slice(0, 4) + '…' + address.slice(-4);
  }
  if (address instanceof Uint8Array || Array.isArray(address)) {
    const arr = Array.from(address);
    const first = arr
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const last = arr
      .slice(-4)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return first + '…' + last;
  }
  return String(address).slice(0, 4) + '…' + String(address).slice(-4);
}

export default function LobbyScreen() {
  const tables = useLobbyStore((s) => s.tables);
  const { accounts } = useWallet();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'CASH' | 'TOURNAMENT' | 'PRIVATE'>('CASH');
  const [showCreate, setShowCreate] = useState(false);
  const [smallBlind, setSmallBlind] = useState('10');
  const [bigBlind, setBigBlind] = useState('20');
  const [minBuyIn, setMinBuyIn] = useState('200');
  const [maxBuyIn, setMaxBuyIn] = useState('2000');
  const [pressedJoinTableId, setPressedJoinTableId] = useState<string | null>(null);

  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  const rawAddress = accounts?.[0]?.address;
  const shortAddress = rawAddress != null ? truncateAddress(rawAddress) : null;
  const solBalance = '1.25 SOL'; // mock; replace with real balance when available

  const handleJoin = async (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    const err = await SocketService.joinTable(tableId, table.minBuyIn, getPlayerName());
    if (err) {
      console.warn('[lobby] joinTable error:', err);
      return;
    }
    router.push(`/table/${tableId}`);
  };

  const handleCreate = async () => {
    const sb = parseInt(smallBlind, 10) || 10;
    const bb = parseInt(bigBlind, 10) || 20;
    const min = parseInt(minBuyIn, 10) || 200;
    const max = parseInt(maxBuyIn, 10) || 2000;
    const tableId = await SocketService.createTable({
      name: `TABLE_${Date.now().toString(36).toUpperCase()}`,
      smallBlind: sb,
      bigBlind: bb,
      minBuyIn: min,
      maxBuyIn: max,
    });
    if (!tableId) return;
    const err = await SocketService.joinTable(tableId, min, getPlayerName());
    if (err) {
      console.warn('[lobby] joinTable after create error:', err);
      return;
    }
    setShowCreate(false);
    router.push(`/table/${tableId}`);
  };

  if (!fontsLoaded && !fontError) return null;

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <ImageBackground
        source={require('@/assets/images/lobby-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />

      <View style={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
        {/* Header */}
        <View style={styles.header}>
          {/* <View style={styles.headerIconWrap}>
            <Text style={styles.headerIcon}>♠</Text>
          </View> */}
          <Text style={styles.headerTitle}>TABLES</Text>
          <View style={styles.walletBadge}>
            <Text style={styles.walletIcon}>👛</Text>
            <View style={styles.walletTextWrap}>
              <Text style={styles.walletAddress} numberOfLines={1}>
                {shortAddress || 'Not connected'}
              </Text>
              <Text style={styles.walletBalance}>{solBalance}</Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['CASH', 'TOURNAMENT', 'PRIVATE'] as const).map((tab) => (
            <Pressable
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            </Pressable>
          ))}
        </View>

        {/* Table list */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
          {tables.map((t, i) => (
            <View key={t.id} style={styles.tableCard}>
              <View style={styles.tableCardBody}>
                <Text style={styles.tableName}>{TABLE_NAMES[i % TABLE_NAMES.length]}</Text>
                <Text style={styles.tableDetail}>
                  Blinds: {(t.smallBlind / 200).toFixed(2)} / {(t.bigBlind / 200).toFixed(2)} SOL
                </Text>
                <View style={styles.tableRow}>
                  <Text style={styles.tableDetail}>
                    Players: {t.playerCount}/{MAX_PLAYERS}
                  </Text>
                  <View style={styles.statusDot} />
                </View>
                <Text style={styles.tableDetail}>Min buy-in: {(t.minBuyIn / 100).toFixed(0)} SOL</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.joinBtn, styles.joinBtnWrap, pressed && styles.joinBtnPressed]}
                onPressIn={() => setPressedJoinTableId(t.id)}
                onPressOut={() => setPressedJoinTableId(null)}
                onPress={() => {
                  setPressedJoinTableId(null);
                  handleJoin(t.id);
                }}>
                <ImageBackground
                  source={
                    pressedJoinTableId === t.id
                      ? require('@/assets/images/buttons/join-btn-pressed.png')
                      : require('@/assets/images/buttons/join-btn.png')
                  }
                  style={styles.joinBtnBg}
                  resizeMode="stretch">
                  <Text style={styles.joinBtnText}>JOIN</Text>
                </ImageBackground>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {/* Create form or CREATE TABLE button */}
        {showCreate ? (
          <View style={styles.createForm}>
            <TextInput
              style={styles.input}
              placeholder="Small blind"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={smallBlind}
              onChangeText={setSmallBlind}
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Big blind"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={bigBlind}
              onChangeText={setBigBlind}
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Min buy-in"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={minBuyIn}
              onChangeText={setMinBuyIn}
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Max buy-in"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={maxBuyIn}
              onChangeText={setMaxBuyIn}
              keyboardType="number-pad"
            />
            <Pressable style={[styles.createButton, styles.submit]} onPress={handleCreate}>
              <Text style={styles.createButtonText}>Create & join</Text>
            </Pressable>
            <Pressable onPress={() => setShowCreate(false)}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
            onPress={() => setShowCreate(true)}>
            <Text style={styles.createButtonText}>CREATE TABLE</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const gold = '#FFD700';
const darkGold = '#B8860B';
const neonCyan = '#00FFFF';
const panelBg = 'rgba(81, 46, 123, 0.92)';
const panelBorder = gold;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: panelBg,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: panelBorder,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'gold',
    borderWidth: 1.5,
    borderColor: gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    fontSize: 24,
    color: panelBg,
    fontWeight: 'bold',
  },
  headerTitle: {
    paddingLeft: 20,
    paddingTop: 10,
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 14 : 12,
    color: gold,
    letterSpacing: 1,
  },
  walletBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: panelBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: panelBorder,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
    maxWidth: 140,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      default: {},
    }),
  },
  walletIcon: { fontSize: 14 },
  walletTextWrap: { flex: 1, minWidth: 0 },
  walletAddress: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.95)',
  },
  walletBalance: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.85)',
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: panelBorder,
    backgroundColor: panelBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: gold,
    borderColor: darkGold,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0,0,0,0.3)',
        shadowOffset: { width: 1, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      default: {},
    }),
  },
  tabText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: gold,
  },
  tabTextActive: {
    color: '#1a0a2e',
  },
  list: { flex: 1 },
  listContent: {
    gap: 14,
    paddingBottom: 16,
  },
  tableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: panelBg,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: panelBorder,
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  tableCardBody: { flex: 1, minWidth: 0, gap: 4 },
  tableName: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 12 : 11,
    color: gold,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tableDetail: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.9)',
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
  },
  joinBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    minHeight: 44,
    minWidth: 88,
    borderRadius: 12,
    marginLeft: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0,0,0,0.4)',
        shadowOffset: { width: 1, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  joinBtnWrap: { overflow: 'hidden' },
  joinBtnBg: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinBtnPressed: { opacity: 0.88 },
  joinBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 10,
    color: '#1a0a2e',
  },
  createButton: {
    backgroundColor: panelBg,
    borderWidth: 2,
    borderColor: panelBorder,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  createButtonPressed: { opacity: 0.9 },
  createButtonText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 12 : 11,
    color: gold,
    letterSpacing: 1,
  },
  createForm: {
    marginTop: 12,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.5)',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 12,
  },
  submit: { marginTop: 8 },
  cancel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginTop: 4,
  },
});
