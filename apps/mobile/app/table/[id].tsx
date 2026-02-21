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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
      <ImageBackground
        source={require('@/assets/images/raise-input-bg.png')}
        style={rsStyles.inputBg}
        resizeMode="stretch">
        <Pressable
          style={({ pressed }) => [rsStyles.stepperBtn, pressed && rsStyles.stepperBtnPressed]}
          onPress={handleDecrement}
          hitSlop={8}>
          <Image source={require('@/assets/images/btn-minus.png')} style={rsStyles.stepperBtnImage} resizeMode="contain" />
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
          <Image source={require('@/assets/images/btn-plus.png')} style={rsStyles.stepperBtnImage} resizeMode="contain" />
        </Pressable>
      </ImageBackground>
    </View>
  );
}

const rsStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputBg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 80,
    marginHorizontal: 50,
    paddingHorizontal: 20,
    overflow: 'hidden',
    marginVertical: -15,
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
    color: '#E8E4C8',
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnPressed: { opacity: 0.7 },
  stepperBtnImage: {
    width: 35,
    height: 35,
  },
});

// ── Dust particles ───────────────────────────────────────────────────────────
const PARTICLE_DEFS = [
  { x: 0.08, size: 3,   peakOpacity: 0.35, duration: 11000 },
  { x: 0.19, size: 2,   peakOpacity: 0.22, duration: 14500 },
  { x: 0.31, size: 3.5, peakOpacity: 0.28, duration: 10000 },
  { x: 0.44, size: 2,   peakOpacity: 0.18, duration: 16000 },
  { x: 0.55, size: 4,   peakOpacity: 0.30, duration: 12500 },
  { x: 0.63, size: 2.5, peakOpacity: 0.20, duration: 9500  },
  { x: 0.72, size: 3,   peakOpacity: 0.25, duration: 13000 },
  { x: 0.82, size: 2,   peakOpacity: 0.18, duration: 15500 },
  { x: 0.91, size: 3.5, peakOpacity: 0.32, duration: 11500 },
  { x: 0.25, size: 2.5, peakOpacity: 0.22, duration: 17000 },
  { x: 0.50, size: 3,   peakOpacity: 0.28, duration: 10500 },
  { x: 0.77, size: 2,   peakOpacity: 0.20, duration: 13500 },
];

function DustParticles() {
  const anims = useRef(PARTICLE_DEFS.map((p, i) => {
    // Pre-seed progress so the screen starts populated
    const initial = (i / PARTICLE_DEFS.length);
    return new Animated.Value(initial);
  })).current;

  useEffect(() => {
    const loops = PARTICLE_DEFS.map((p, i) => {
      const remaining = (1 - (i / PARTICLE_DEFS.length)) * p.duration;
      // First: complete the current cycle from the seeded position
      const firstLeg = Animated.timing(anims[i], {
        toValue: 1,
        duration: remaining,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      // Then: loop full cycles
      const fullLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(anims[i], {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(anims[i], {
            toValue: 1,
            duration: p.duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ])
      );
      return Animated.sequence([firstLeg, fullLoop]);
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {PARTICLE_DEFS.map((p, i) => {
        const translateY = anims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [700, -80],
        });
        const translateX = anims[i].interpolate({
          inputRange: [0, 0.3, 0.6, 1],
          outputRange: [0, 8, -5, 3],
        });
        const opacity = anims[i].interpolate({
          inputRange: [0, 0.1, 0.8, 1],
          outputRange: [0, p.peakOpacity, p.peakOpacity, 0],
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x * 100}%` as any,
              bottom: 0,
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: '#FFD060',
              opacity,
              transform: [{ translateY }, { translateX }],
            }}
          />
        );
      })}
    </View>
  );
}

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
      } catch (_) { }
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
    } catch (_) { }
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
      <DustParticles />

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

      {/* Avatar slots around the table */}
      {([
        { top: insets.top + 60, left: '50%', marginLeft: -36 },  // top center
        { top: '24%', left: 0 },                                   // top left
        { top: '24%', right: 0 },                                  // top right
        { top: '58%', left: 0 },                                   // bottom left
        { top: '58%', right: 0 },                                  // bottom right
        { top: '76%', left: '50%', marginLeft: -36 },             // bottom center
      ] as const).map((pos, i) => (
        <Pressable
          key={i}
          style={({ pressed }) => [
            styles.avatarSlot,
            pos,
            pressed && styles.joinRoomIconPressed,
          ]}
          onPress={() => {/* TODO: join room action */ }}>
          <Image
            source={require('@/assets/images/avatar-placeholder.png')}
            style={styles.joinRoomIconImage}
            resizeMode="cover"
          />
        </Pressable>
      ))}

      {/* Top bar floats over table */}
      <View style={[styles.topBarWrap, { top: insets.top + 6 }]}>
        <ImageBackground
          source={require('@/assets/images/topbar-bg.png')}
          style={styles.topBar}
          resizeMode="stretch">
          <Image source={require('@/assets/images/coin.png')} style={styles.coinIcon} resizeMode="contain" />
          <View style={styles.balanceRow}>
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
        </ImageBackground>
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
                <Text style={styles.raiseBtnText}>RAISE</Text>
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
    paddingVertical: 10,
    paddingHorizontal: -50,
    overflow: 'hidden',
  },
  balanceRow: {
    marginStart: 6,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexShrink: 0,
  },
  topBarSpacer: { flex: 1, minWidth: 6 },
  coinIcon: { width: 22, height: 22, marginRight: 4, marginVertical: 6, marginStart: 34 },
  balanceLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: 'rgba(255, 245, 220, 0.8)',
  },
  balanceValue: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: '#FFF8E8',
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
    top: -40,
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
    top: '15%',
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    zIndex: 11,
  },
  avatarSlot: {
    position: 'absolute',
    width: 72,
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
  raiseBtnWrap: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 220, 100, 0.75)',
    ...Platform.select({
      ios: {
        shadowColor: '#FFD060',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.45,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  raiseBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 60, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
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
