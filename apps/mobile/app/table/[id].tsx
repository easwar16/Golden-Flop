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
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipStack } from '@/components/poker/chip-stack';
import { PokerCard } from '@/components/poker/poker-card';
import type { CardValue } from '@/constants/poker';
import { useGame } from '@/contexts/game-context';
import { useTactilePeek } from '@/hooks/use-tactile-peek';

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

/** Seat index for current user (we show cards here, not a profile card). */
const MY_SEAT_INDEX = 4;

function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatBalanceLong(n: number): string {
  return n.toLocaleString();
}

const gold = '#FFD700';
const neonPurple = '#e879f9';
const tableGreen = '#1b5e20';
const tableGreenDark = '#0d3d2e';
const tableBorderDark = '#1a0a2e';
const SLIDER_OPTIONS = [10000, 15000, 20000];

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

// Empty seat placeholder avatar
function EmptyAvatar() {
  return (
    <View style={styles.emptyAvatar}>
      <Text style={styles.emptyAvatarText}>?</Text>
    </View>
  );
}

// Single seat display (top/left/right); bottom is "me" and rendered separately
function SeatView({
  seat,
  chipsLabel,
  dealerLabel,
}: {
  seat: TableSeat;
  chipsLabel: string;
  dealerLabel: boolean;
}) {
  return (
    <View style={styles.seatContainer}>
      {seat ? (
        <View style={[styles.seatAvatar, { backgroundColor: '#2e7d32' }]} />
      ) : (
        <EmptyAvatar />
      )}
      <View style={styles.seatBanner}>
        <Text style={styles.seatName} numberOfLines={1}>
          {seat?.name ?? '—'}
        </Text>
        <Text style={styles.seatChips}>{chipsLabel}</Text>
      </View>
      {dealerLabel && (
        <View style={styles.dealerBtn}>
          <Text style={styles.dealerBtnText}>DEALER</Text>
        </View>
      )}
      <View style={styles.chipStackSmall}>
        <View style={[styles.chipDot, { backgroundColor: '#c62828' }]} />
        <View style={[styles.chipDot, { backgroundColor: '#7b1fa2' }]} />
        <View style={[styles.chipDot, { backgroundColor: '#2e7d32' }]} />
      </View>
    </View>
  );
}

export default function TableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { game, currentTable, leaveTable, performAction, peekHoleCard, stopPeek } = useGame();
  const { requestPeek, releasePeek } = useTactilePeek();

  const tableState = useTableState(id, game, currentTable);
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const [sliderValue, setSliderValue] = useState(1);
  const [foldPressed, setFoldPressed] = useState(false);
  const [callPressed, setCallPressed] = useState(false);
  const [raisePressed, setRaisePressed] = useState(false);
  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (game?.isYourTurn) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (_) {}
    }
    if (!tableState?.isMyTurn) {
      setFoldPressed(false);
      setCallPressed(false);
      setRaisePressed(false);
    }
  }, [game?.isYourTurn, tableState?.isMyTurn]);

  if (!tableState) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require('@/assets/images/table-bg.png')}
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
    const raiseAmount = action === 'raise' ? (amount ?? SLIDER_OPTIONS[sliderValue]) : amount;
    performAction(action, raiseAmount);
  };

  const roomId = (id?.length ?? 0) > 8 ? `${id!.slice(0, 6)}…${id!.slice(-2)}` : id ?? '—';

  const [s0, s1, s2, s3, s4, s5] = tableState.seats;
  const communityCards = tableState.communityCards;
  const myHand = tableState.myHand;
  const myHandRevealed = tableState.myHandRevealed;

  return (
    <View style={styles.container} onLayout={onLayoutRoot}>
      <ImageBackground
        source={require('@/assets/images/table-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />

      <View style={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
        {/* Top bar: Balance | Wi-Fi | Room */}
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

        {/* Table area: 6 seats equally spaced around oval table */}
        <View style={styles.tableArea}>
          {/* Row 1: top-left (0), top-right (1) */}
          <View style={styles.tableRow1}>
            <View style={styles.seatSlot}>
              <SeatView
                seat={s0}
                chipsLabel={s0 ? formatChips(s0.chips) : '—'}
                dealerLabel={s0?.isDealer ?? false}
              />
            </View>
            <View style={styles.seatSlot}>
              <SeatView
                seat={s1}
                chipsLabel={s1 ? formatChips(s1.chips) : '—'}
                dealerLabel={s1?.isDealer ?? false}
              />
            </View>
          </View>

          {/* Row 2: left (5) | oval table | right (2) */}
          <View style={styles.tableRow2}>
            <View style={styles.seatSlot}>
              <SeatView
                seat={s5}
                chipsLabel={s5 ? formatChips(s5.chips) : '—'}
                dealerLabel={s5?.isDealer ?? false}
              />
            </View>
            <View style={styles.ovalTableWrap}>
              <View style={styles.ovalTableGlow}>
                <View style={styles.ovalTableInner}>
                  <View style={styles.ovalTableFelt}>
                    <Text style={styles.communityLabel}>COMMUNITY CARDS</Text>
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
            </View>
            <View style={styles.seatSlot}>
              <SeatView
                seat={s2}
                chipsLabel={s2 ? formatChips(s2.chips) : '—'}
                dealerLabel={s2?.isDealer ?? false}
              />
            </View>
          </View>

          {/* Row 3: bottom-left = me (4), bottom-right (3) */}
          <View style={styles.tableRow3}>
            <View style={styles.seatSlot}>
              <View style={styles.myHandRow}>
                <View style={styles.myCardsWrap}>
                  <Pressable
                    onPressIn={() => requestPeek(0)}
                    onPressOut={releasePeek}
                    style={styles.holeCardWrap}>
                    <PokerCard
                      card={myHand[0]}
                      faceDown={!myHandRevealed[0]}
                      onPressIn={() => requestPeek(0)}
                      onPressOut={releasePeek}
                    />
                  </Pressable>
                  <Pressable
                    onPressIn={() => requestPeek(1)}
                    onPressOut={releasePeek}
                    style={styles.holeCardWrap}>
                    <PokerCard
                      card={myHand[1]}
                      faceDown={!myHandRevealed[1]}
                      onPressIn={() => requestPeek(1)}
                      onPressOut={releasePeek}
                    />
                  </Pressable>
                </View>
                <View style={styles.myChipsWrap}>
                  <ChipStack amount={tableState.myChips} />
                </View>
              </View>
            </View>
            <View style={styles.seatSlot}>
              <SeatView
                seat={s3}
                chipsLabel={s3 ? formatChips(s3.chips) : '—'}
                dealerLabel={s3?.isDealer ?? false}
              />
            </View>
          </View>
        </View>

        {/* Pot */}
        <View style={styles.potRow}>
          <ChipStack amount={tableState.pot} label="Pot" />
        </View>

        {/* Bet slider: 10K, 15K, 20K */}
        <View style={styles.sliderSection}>
          <View style={styles.sliderTrack}>
            {SLIDER_OPTIONS.map((val, i) => (
              <Pressable
                key={val}
                style={[styles.sliderSegment, i === sliderValue && styles.sliderSegmentActive]}
                onPress={() => setSliderValue(i)}>
                <Text style={styles.sliderLabel}>{val >= 1000 ? `${val / 1000}K` : val}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Action buttons: FOLD (image bg), CALL, RAISE only (reference) */}
        <View style={styles.actionBar}>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.foldBtnWrap, pressed && styles.actionBtnPressed]}
            onPressIn={() => setFoldPressed(true)}
            onPressOut={() => setFoldPressed(false)}
            onPress={() => {
              setFoldPressed(false);
              handleAction('fold');
            }}
            disabled={!tableState.isMyTurn}>
            <ImageBackground
              source={
                foldPressed
                  ? require('@/assets/images/buttons/fold-btn-pressed.png')
                  : require('@/assets/images/buttons/fold-btn.png')
              }
              style={styles.foldBtnBg}
              resizeMode="stretch">
              <Text style={styles.actionBtnText}>FOLD</Text>
            </ImageBackground>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.callBtnWrap, pressed && styles.actionBtnPressed]}
            onPressIn={() => setCallPressed(true)}
            onPressOut={() => setCallPressed(false)}
            onPress={() => {
              setCallPressed(false);
              handleAction('call', tableState.currentBet);
            }}
            disabled={!tableState.isMyTurn}>
            <ImageBackground
              source={
                callPressed
                  ? require('@/assets/images/buttons/call-btn-pressed.png')
                  : require('@/assets/images/buttons/call-btn.png')
              }
              style={styles.foldBtnBg}
              resizeMode="stretch">
              <Text style={styles.actionBtnText}>
                CALL {tableState.currentBet > 0 ? tableState.currentBet : '—'}
              </Text>
            </ImageBackground>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.raiseBtnWrap, pressed && styles.actionBtnPressed]}
            onPressIn={() => setRaisePressed(true)}
            onPressOut={() => setRaisePressed(false)}
            onPress={() => {
              setRaisePressed(false);
              handleAction('raise', SLIDER_OPTIONS[sliderValue]);
            }}
            disabled={!tableState.isMyTurn}>
            <ImageBackground
              source={
                raisePressed
                  ? require('@/assets/images/buttons/raise-btn-pressed.png')
                  : require('@/assets/images/buttons/raise-btn.png')
              }
              style={styles.foldBtnBg}
              resizeMode="stretch">
              <Text style={styles.actionBtnText}>RAISE</Text>
            </ImageBackground>
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
  content: {
    flex: 1,
    paddingHorizontal: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
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
    flex: 1,
    minHeight: 200,
    marginBottom: 8,
  },
  tableRow1: {
    flexDirection: 'row',
    marginBottom: 6,
    gap: 8,
  },
  tableRow2: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 100,
    gap: 6,
  },
  tableRow3: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 8,
  },
  /** Equal-width slot for each of the 6 seats around the table */
  seatSlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 0,
  },
  ovalTableWrap: {
    flex: 2,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    minWidth: 0,
  },
  ovalTableGlow: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: neonPurple,
    width: '100%',
    maxWidth: 320,
    ...Platform.select({
      ios: {
        shadowColor: neonPurple,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  ovalTableInner: {
    backgroundColor: tableBorderDark,
    borderRadius: 999,
    padding: 4,
    overflow: 'hidden',
  },
  ovalTableFelt: {
    backgroundColor: tableGreen,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 100,
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
    flexWrap: 'wrap',
  },
  communitySlot: { width: 36, alignItems: 'center', justifyContent: 'center' },
  communityCardSize: { width: 34, height: 48 },
  emptyCardOutline: {
    width: 34,
    height: 48,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: tableGreenDark,
  },
  myHandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  myCardsWrap: { flexDirection: 'row', gap: 8 },
  holeCardWrap: { alignSelf: 'flex-start' },
  myChipsWrap: { alignItems: 'center' },
  potRow: { alignItems: 'center', marginBottom: 10 },
  sliderSection: { marginBottom: 10, paddingHorizontal: 4 },
  sliderTrack: {
    flexDirection: 'row',
    height: 32,
    backgroundColor: 'rgba(21, 101, 192, 0.5)',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  sliderSegment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sliderSegmentActive: { backgroundColor: 'rgba(123, 31, 162, 0.7)' },
  sliderLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: gold,
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
  seatContainer: {
    alignItems: 'center',
    minWidth: 64,
  },
  seatAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginBottom: 4,
  },
  emptyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(80,80,80,0.6)',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyAvatarText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    fontWeight: '700',
  },
  seatBanner: {
    backgroundColor: tableGreenDark,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  seatName: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 6 : 5,
    color: '#fff',
  },
  seatChips: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 6 : 5,
    color: gold,
    marginTop: 2,
  },
  dealerBtn: {
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dealerBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 5,
    color: '#000',
  },
  chipStackSmall: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 4,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
