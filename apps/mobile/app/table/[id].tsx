/**
 * Table screen – one-on-one copy of reference layout.
 * Data shape is WebSocket-ready; replace useTableState source with WebSocket later.
 */

import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PokerCard } from '@/components/poker/poker-card';
import type { CardValue } from '@/constants/poker';
import { useGame } from '@/contexts/game-context';

// --- WebSocket-ready types (fill from WebSocket server later) ---
export type TableSeat = {
  id: string;
  name: string;
  chips: number;
  isDealer: boolean;
  avatarUrl?: string | null;
} | null;

const NUM_SEATS = 6;

export type TableViewState = {
  /** Seats: 0=top-left, 1=top-right, 2=right, 3=bottom-right, 4=bottom/me, 5=left. Null = empty seat. */
  seats: [
    TableSeat,
    TableSeat,
    TableSeat,
    TableSeat,
    TableSeat,
    TableSeat,
  ];
  communityCards: (CardValue | null)[];
  myHand: (CardValue | null)[];
  myHandRevealed: [boolean, boolean];
  pot: number;
  myChips: number;
  currentBet: number;
  isMyTurn: boolean;
  dealerSeatIndex: number;
};

function formatBalanceLong(n: number): string {
  return n.toLocaleString();
}

const gold = '#FFD700';
const tableGreenDark = '#0d3d2e';

// ── Raise amount input ───────────────────────────────────────────────────────
function RaiseAmountInput({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [inputText, setInputText] = useState(String(value));

  useEffect(() => {
    setInputText(String(value));
  }, [value]);

  const handleCommit = useCallback(() => {
    const raw = inputText.replace(/\D/g, '');
    const parsed = parseInt(raw, 10);
    if (raw.length > 0 && !isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      const rounded = Math.round(clamped / 100) * 100;
      onChange(rounded);
      setInputText(String(rounded));
    } else {
      setInputText(String(value));
    }
  }, [inputText, value, min, max, onChange]);

  const currentValue = (() => {
    const raw = inputText.replace(/\D/g, '');
    const parsed = parseInt(raw, 10);
    return raw.length > 0 && !isNaN(parsed) ? parsed : value;
  })();

  const handleDecrement = useCallback(() => {
    const next = Math.round((Math.max(min, currentValue - 100)) / 100) * 100;
    onChange(next);
    setInputText(String(next));
  }, [currentValue, min, onChange]);

  const handleIncrement = useCallback(() => {
    const next = Math.round((Math.min(max, currentValue + 100)) / 100) * 100;
    onChange(next);
    setInputText(String(next));
  }, [currentValue, max, onChange]);

  return (
    <View style={rsStyles.container}>
      <View style={rsStyles.inputRow}>
        <Pressable
          style={({ pressed }) => [rsStyles.stepperBtn, pressed && rsStyles.stepperBtnPressed]}
          onPress={handleDecrement}
          hitSlop={8}>
          <Text style={rsStyles.stepperBtnText}>−</Text>
        </Pressable>
        <TextInput
          style={rsStyles.valueInput}
          value={inputText}
          onChangeText={(t) => setInputText(t.replace(/\D/g, ''))}
          onBlur={handleCommit}
          onSubmitEditing={handleCommit}
          keyboardType="number-pad"
          selectTextOnFocus
          showSoftInputOnFocus
        />
        <Pressable
          style={({ pressed }) => [rsStyles.stepperBtn, pressed && rsStyles.stepperBtnPressed]}
          onPress={handleIncrement}
          hitSlop={8}>
          <Text style={rsStyles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const rsStyles = StyleSheet.create({
  container: {
    flex: 1,
    // alignSelf: 'stretch',
    backgroundColor: 'rgba(8, 8, 28, 0.88)',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: gold,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: gold,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  valueInput: {
    flex: 1,
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 11 : 10,
    color: gold,
    textAlign: 'center',
    paddingVertical: 2,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.25)',
    borderWidth: 1,
    borderColor: gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnPressed: { opacity: 0.7 },
  stepperBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: gold,
  },
});

// Build table state from game context (replace with WebSocket subscription later)
function useTableState(
  tableId: string | undefined,
  game: ReturnType<typeof useGame>['game'],
  currentTable: ReturnType<typeof useGame>['currentTable']
): TableViewState | null {
  return useMemo(() => {
    if (!game || !currentTable || game.tableId !== tableId) return null;
    const mockSeats: TableViewState['seats'] = [
      { id: '1', name: 'DEGENKING', chips: 100_000, isDealer: true, avatarUrl: null },
      { id: '2', name: 'CRYPTOQUEEN', chips: 150_000, isDealer: false, avatarUrl: null },
      { id: '3', name: 'ALIENACE', chips: 75_000, isDealer: false, avatarUrl: null },
      { id: '4', name: 'SHARK', chips: 200_000, isDealer: false, avatarUrl: null },
      null, // seat 4 = current user (we show cards here)
      { id: '5', name: 'CYBERPUNK', chips: 50_000, isDealer: false, avatarUrl: null },
    ];
    const community: (CardValue | null)[] = [...game.communityCards];
    while (community.length < 5) community.push(null);
    return {
      seats: mockSeats,
      communityCards: community.slice(0, 5),
      myHand: game.holeCards,
      myHandRevealed: [game.holeCardsRevealed[0] ?? false, game.holeCardsRevealed[1] ?? false],
      pot: game.pot,
      myChips: game.yourChips,
      currentBet: game.currentBet,
      isMyTurn: game.isYourTurn,
      dealerSeatIndex: 0,
    };
  }, [tableId, game, currentTable]);
}


export default function TableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { game, currentTable, leaveTable, performAction } = useGame();

  const tableState = useTableState(id, game, currentTable);
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const [raiseAmount, setRaiseAmount] = useState(1000);
  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (game?.isYourTurn) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (_) {}
    }
  }, [game?.isYourTurn]);

  if (!tableState) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require('@/assets/images/table-room-bg.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <View style={[styles.loadingWrap, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.loadingText}>Loading table…</Text>
        </View>
      </View>
    );
  }

  if (!fontsLoaded && !fontError) return null;

  const handleAction = (action: 'fold' | 'call' | 'raise', amount?: number) => {
    try {
      if (tableState.isMyTurn) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_) {}
    const raiseAmt = action === 'raise' ? (amount ?? raiseAmount) : amount;
    performAction(action, raiseAmt);
  };

  const roomId = (id?.length ?? 0) > 8 ? `${id!.slice(0, 6)}…${id!.slice(-2)}` : id ?? '—';

  const communityCards = tableState.communityCards;
  const raiseMin = Math.max(tableState.currentBet > 0 ? tableState.currentBet * 2 : 100, 100);
  const raiseMax = Math.max(tableState.myChips, raiseMin + 100);

  return (
    <View style={styles.container} onLayout={onLayoutRoot}>
      <ImageBackground
        source={require('@/assets/images/table-room-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />

      {/* Table image — precisely sized and positioned */}
      <View style={styles.tableArea}>
        <Image
          source={require('@/assets/images/table.png')}
          style={styles.tableImage}
          resizeMode="stretch"
        />

        {/* Community cards — centered on the oval */}
        <View style={styles.communityOverlay}>
          <View style={styles.communityCardsWrap}>
            <View style={styles.communityCards}>
            {[0, 1, 2, 3, 4].map((i) => {
              const card = communityCards[i];
              return (
                <View key={i} style={styles.communitySlot}>
                  {card ? (
                    <PokerCard card={card} style={styles.communityCardSize} />
                  ) : (
                    <View style={styles.emptyCardOutline} />
                  )}
                </View>
              );
            })}
            </View>
          </View>
        </View>
      </View>

      {/* Tap table/top area to dismiss keyboard — does not cover bottom controls so input can receive touches */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { bottom: 220, zIndex: 1 },
          ]}
          collapsable={false}
        />
      </TouchableWithoutFeedback>

      {/* Join room icon — top center of table, below balance bar */}
      <Pressable
        style={({ pressed }) => [
          styles.joinRoomIcon,
          { top: insets.top + 44 },
          pressed && styles.joinRoomIconPressed,
        ]}
        onPress={() => {/* TODO: join room action */}}>
        <Image
          source={require('@/assets/images/join-room-icon.png')}
          style={styles.joinRoomIconImage}
          resizeMode="cover"
        />
      </Pressable>

      {/* Top bar floats over table */}
      <View style={[styles.topBarWrap, { top: insets.top + 6 }]}>
        <View style={styles.topBar}>
          <View style={styles.balanceRow}>
            <Text style={styles.coinIcon}>🪙</Text>
            <Text style={styles.balanceLabel}>BALANCE: </Text>
            <Text style={styles.balanceValue} numberOfLines={1}>
              {formatBalanceLong(tableState.myChips)}
            </Text>
          </View>
          <View style={styles.topBarSpacer} />
          <View style={styles.wifiWrap}>
            <Text style={styles.wifiIcon}>📶</Text>
          </View>
          <View style={styles.topBarSpacer} />
          <View style={styles.topBarRight}>
            <Text style={styles.roomLabel}>ROOM: </Text>
            <Text style={styles.roomValue}>{roomId}</Text>
            <Pressable
              style={({ pressed }) => [styles.leaveBtn, pressed && styles.leaveBtnPressed]}
              onPress={() => { leaveTable(); router.back(); }}>
              <Text style={styles.leaveText}>Leave</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Bottom controls float over the table */}
      <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 12 }]}>
        {/* Raise amount input — expands to the left */}
        <View style={styles.raiseSliderRow}>
          <View style={styles.raiseAmountInputWrap}>
            <RaiseAmountInput
              min={raiseMin}
              max={raiseMax}
              value={Math.max(raiseMin, Math.min(raiseMax, raiseAmount))}
              onChange={setRaiseAmount}
            />
          </View>
        </View>

        {/* Action buttons: FOLD, CALL, RAISE */}
        <View style={styles.actionBar}>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.foldBtnWrap, pressed && styles.actionBtnPressed]}
            onPress={() => handleAction('fold')}
            disabled={!tableState.isMyTurn}>
            {({ pressed }) => (
              <ImageBackground
                source={
                  pressed
                    ? require('@/assets/images/buttons/fold-btn-pressed.png')
                    : require('@/assets/images/buttons/fold-btn.png')
                }
                style={styles.foldBtnBg}
                resizeMode="stretch">
                <Text style={styles.actionBtnText}>FOLD</Text>
              </ImageBackground>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.callBtnWrap, pressed && styles.actionBtnPressed]}
            onPress={() => handleAction('call', tableState.currentBet)}
            disabled={!tableState.isMyTurn}>
            {({ pressed }) => (
              <ImageBackground
                source={
                  pressed
                    ? require('@/assets/images/buttons/call-btn-pressed.png')
                    : require('@/assets/images/buttons/call-btn.png')
                }
                style={styles.foldBtnBg}
                resizeMode="stretch">
                <Text style={styles.actionBtnText}>
                  CALL {tableState.currentBet > 0 ? tableState.currentBet : '—'}
                </Text>
              </ImageBackground>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.raiseBtnWrap, pressed && styles.actionBtnPressed]}
            onPress={() => handleAction('raise', raiseAmount)}
            disabled={!tableState.isMyTurn}>
            {({ pressed }) => (
              <ImageBackground
                source={
                  pressed
                    ? require('@/assets/images/buttons/raise-btn-pressed.png')
                    : require('@/assets/images/buttons/raise-btn.png')
                }
                style={styles.foldBtnBg}
                resizeMode="stretch">
                <Text style={styles.actionBtnText}>RAISE</Text>
              </ImageBackground>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: gold, fontSize: 14 },
  topBarWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(26, 10, 46, 0.9)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: gold,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexShrink: 0,
  },
  topBarSpacer: { flex: 1, minWidth: 6 },
  coinIcon: { fontSize: 14, marginRight: 2 },
  balanceLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: '#fff',
  },
  balanceValue: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: gold,
    flex: 1,
  },
  wifiWrap: { alignItems: 'center', justifyContent: 'center' },
  wifiIcon: { fontSize: 16 },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 7 : 6,
    color: 'rgba(255,255,255,0.9)',
  },
  roomValue: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 7 : 6,
    color: gold,
  },
  leaveBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(198, 34, 34, 0.9)',
    borderRadius: 6,
  },
  leaveBtnPressed: { opacity: 0.85 },
  leaveText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 6,
    color: '#fff',
  },
  tableArea: {
    ...StyleSheet.absoluteFillObject,
    top: -50,
    bottom: 16,
  },
  tableImage: {
    width: '110%',
    height: '100%',
    marginLeft: '-5%',
  },
  joinRoomIcon: {
    position: 'absolute',
    left: '50%',
    marginLeft: -36,
    width: 72,
    top:'15%',
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    zIndex: 11,
  },
  joinRoomIconPressed: { opacity: 0.85 },
  joinRoomIconImage: {
    width: '100%',
    height: '100%',
  },
  communityOverlay: {
    position: 'absolute',
    top: '44%',
    left: '-5%',
    right: '-5%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityCardsWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
  },
  communityLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 7 : 6,
    color: '#fff',
    marginBottom: 8,
  },
  communityCards: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  communitySlot: { width: 46, alignItems: 'center', justifyContent: 'center' },
  communityCardSize: { width: 44, height: 62 },
  emptyCardOutline: {
    width: 44,
    height: 62,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 10,
  },
  raiseSliderRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  raiseAmountInputWrap: {
    flex: 1,
    alignSelf: 'stretch',
  },
  actionBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 10,
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
  actionBtnPressed: { opacity: 0.85 },
  foldBtnWrap: { overflow: 'hidden' },
  callBtnWrap: { overflow: 'hidden' },
  raiseBtnWrap: { overflow: 'hidden' },
  foldBtnBg: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: '#fff',
  },
});
