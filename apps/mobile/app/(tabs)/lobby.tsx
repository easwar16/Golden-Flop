import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTransition } from '@/contexts/transition-context';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { SocketService } from '@/services/SocketService';
import { useLobbyStore, LobbyTable } from '@/stores/useLobbyStore';
import { getPlayerName } from '@/utils/player-identity';
import { useWallet } from '@/contexts/wallet-context';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList) as typeof FlatList;

const MAX_PLAYERS = 6;
const CARD_EST_HEIGHT = 110; // approximate card height for parallax
const CARD_GAP = 14;

// ─── Tier ─────────────────────────────────────────────────────────────────────

type Tier = { label: string; accentColor: string; borderColor: string; shadowColor: string; isVip: boolean };

function getTier(bigBlind: number): Tier {
  if (bigBlind <= 20)  return { label: 'LOW',  accentColor: '#00FFFF', borderColor: 'rgba(0,255,255,0.55)',  shadowColor: '#00FFFF', isVip: false };
  if (bigBlind <= 100) return { label: 'MID',  accentColor: '#FFD700', borderColor: 'rgba(255,215,0,0.75)',  shadowColor: '#FFD700', isVip: false };
  if (bigBlind <= 500) return { label: 'HIGH', accentColor: '#FF3B6F', borderColor: 'rgba(255,59,111,0.75)', shadowColor: '#FF3B6F', isVip: false };
  return                      { label: 'VIP',  accentColor: '#BF5FFF', borderColor: 'rgba(191,95,255,0.85)', shadowColor: '#BF5FFF', isVip: true  };
}

// ─── Table name per tier ──────────────────────────────────────────────────────

const TIER_NAMES: Record<string, string[]> = {
  LOW:  ['PIXEL PARADISE', 'NEON ALLEY',    'COIN CORNER',   'STARTER DECK',  'LUCKY LANE',    'COPPER CHIP',   'SILVER SPARK',  'ROOKIE ROOM'],
  MID:  ['GOLDEN TABLE',   'VELVET ROOM',   'DIAMOND LOUNGE','HIGH STREET',   'AMBER HALL',    'JADE TERRACE',  'CRYSTAL CLUB',  'EMBER LOUNGE'],
  HIGH: ['ROYAL FLUSH',    'IRON THRONE',   'PRESTIGE ROOM', 'THE PENTHOUSE', 'OBSIDIAN ROOM', 'SCARLET SUITE'],
  VIP:  ['ACE HIGH',       'CROWN JEWELS',  'PLATINUM SUITE','INFINITY TABLE'],
};

const tierTableCounts: Record<string, number> = {};
function getTableName(tier: Tier): string {
  const key = tier.label;
  const names = TIER_NAMES[key] ?? TIER_NAMES.LOW;
  const idx = tierTableCounts[key] ?? 0;
  tierTableCounts[key] = idx + 1;
  return names[idx % names.length];
}

// ─── Activity ─────────────────────────────────────────────────────────────────

function getActivity(count: number, max: number) {
  const ratio = count / max;
  if (ratio <= 0.33) return { level: 'cool' as const, dotColor: '#22c55e', pulseDuration: 2400 };
  if (ratio < 0.84)  return { level: 'warm' as const, dotColor: '#EAB308', pulseDuration: 1100 };
  return                    { level: 'hot'  as const, dotColor: '#FF6B35', pulseDuration: 500  };
}

// ─── Table badge ──────────────────────────────────────────────────────────────

type TableBadge = { text: string; color: string } | null;

function getTableBadge(t: LobbyTable, allTables: LobbyTable[]): TableBadge {
  const max = t.maxPlayers ?? MAX_PLAYERS;
  const ratio = t.playerCount / max;
  const maxPlayers = Math.max(...allTables.map((x) => x.playerCount));
  if (t.playerCount >= 4 && t.playerCount === maxPlayers && allTables.length > 1) return { text: '🔥 POPULAR', color: '#FF6B35' };
  if (t.playerCount === 0) return { text: '🆕 NEW', color: '#22c55e' };
  if (t.playerCount >= 2 && ratio < 0.67 && t.bigBlind <= 100) return { text: '⭐ REC', color: '#FFD700' };
  return null;
}

// ─── Table speed ──────────────────────────────────────────────────────────────

function getTableSpeed(bigBlind: number): string {
  if (bigBlind <= 10) return 'SLOW';
  if (bigBlind <= 50) return 'NORMAL';
  return 'FAST';
}

// ─── Wallet address ───────────────────────────────────────────────────────────

function truncateAddress(address: string | Uint8Array | undefined): string | null {
  if (!address) return null;
  if (typeof address === 'string') {
    if (address.length <= 10) return address;
    return address.slice(0, 4) + '…' + address.slice(-4);
  }
  if (address instanceof Uint8Array || Array.isArray(address)) {
    const arr = Array.from(address);
    const first = arr.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
    const last  = arr.slice(-4).map((b) => b.toString(16).padStart(2, '0')).join('');
    return first + '…' + last;
  }
  return String(address).slice(0, 4) + '…' + String(address).slice(-4);
}

// ─── Buy-in modal ─────────────────────────────────────────────────────────────

type BuyInModalProps = {
  visible: boolean;
  tableName: string;
  tier: Tier;
  minBuyIn: number;
  maxBuyIn: number;
  amount: number;
  onChangeAmount: (v: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function BuyInModal({ visible, tableName, tier, minBuyIn, maxBuyIn, amount, onChangeAmount, onConfirm, onCancel }: BuyInModalProps) {
  const step = Math.max(1, Math.round((maxBuyIn - minBuyIn) / 20));
  const half = Math.round((minBuyIn + maxBuyIn) / 2);

  const decrement = () => onChangeAmount(Math.max(minBuyIn, amount - step));
  const increment = () => onChangeAmount(Math.min(maxBuyIn, amount + step));
  const pct = maxBuyIn > minBuyIn ? (amount - minBuyIn) / (maxBuyIn - minBuyIn) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={ms.overlay}>
        <View style={[ms.panel, { borderColor: tier.accentColor }]}>
          {/* Header */}
          <Text style={ms.title}>BUY-IN</Text>
          <View style={[ms.badge, { borderColor: tier.accentColor, backgroundColor: tier.accentColor + '22' }]}>
            <Text style={[ms.badgeText, { color: tier.accentColor }]}>{tableName} · {tier.label}</Text>
          </View>

          {/* Amount display */}
          <Text style={ms.amountLabel}>CHIPS</Text>
          <Text style={[ms.amount, { color: tier.accentColor }]}>{amount.toLocaleString()}</Text>

          {/* Progress track */}
          <View style={ms.track}>
            <View style={[ms.trackFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: tier.accentColor }]} />
          </View>
          <View style={ms.rangeRow}>
            <Text style={ms.rangeText}>{minBuyIn.toLocaleString()}</Text>
            <Text style={ms.rangeText}>{maxBuyIn.toLocaleString()}</Text>
          </View>

          {/* Presets */}
          <View style={ms.presets}>
            {[
              { label: 'MIN',  val: minBuyIn },
              { label: 'HALF', val: half     },
              { label: 'MAX',  val: maxBuyIn },
            ].map(({ label, val }) => (
              <Pressable
                key={label}
                style={[ms.preset, amount === val && { borderColor: tier.accentColor, backgroundColor: tier.accentColor + '22' }]}
                onPress={() => onChangeAmount(val)}>
                <Text style={[ms.presetText, amount === val && { color: tier.accentColor }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Fine tune */}
          <View style={ms.fineRow}>
            <Pressable style={ms.fineBtn} onPress={decrement}>
              <Text style={ms.fineBtnText}>−</Text>
            </Pressable>
            <Text style={ms.fineAmount}>{amount.toLocaleString()}</Text>
            <Pressable style={ms.fineBtn} onPress={increment}>
              <Text style={ms.fineBtnText}>+</Text>
            </Pressable>
          </View>

          {/* Actions */}
          <Pressable style={[ms.confirmBtn, { borderColor: tier.accentColor }]} onPress={onConfirm}>
            <Text style={[ms.confirmBtnText, { color: tier.accentColor }]}>CONFIRM JOIN</Text>
          </Pressable>
          <Pressable style={ms.cancelBtn} onPress={onCancel}>
            <Text style={ms.cancelBtnText}>CANCEL</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Practice tables ──────────────────────────────────────────────────────────

type PracticeConfig = {
  id: string;
  name: string;
  description: string;
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  accentColor: string;
  badge: string;
};

const PRACTICE_TABLES: PracticeConfig[] = [
  {
    id: 'practice-beginner',
    name: 'BEGINNER TABLE',
    description: 'Learn the ropes',
    smallBlind: 5,
    bigBlind: 10,
    startingChips: 1000,
    accentColor: '#22c55e',
    badge: '🟢 EASY',
  },
  {
    id: 'practice-casual',
    name: 'CASUAL LOUNGE',
    description: 'Chill & practice',
    smallBlind: 25,
    bigBlind: 50,
    startingChips: 5000,
    accentColor: '#00FFFF',
    badge: '⭐ FUN',
  },
  {
    id: 'practice-advanced',
    name: 'ADVANCED ROOM',
    description: 'Sharpen your strategy',
    smallBlind: 100,
    bigBlind: 200,
    startingChips: 20000,
    accentColor: '#FFD700',
    badge: '🔥 INTENSE',
  },
  {
    id: 'practice-highroller',
    name: 'HIGH ROLLER',
    description: 'No limits, no mercy',
    smallBlind: 500,
    bigBlind: 1000,
    startingChips: 100000,
    accentColor: '#BF5FFF',
    badge: '👑 VIP',
  },
];

function PracticeCard({ config, onJoin }: { config: PracticeConfig; onJoin: (c: PracticeConfig) => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => onJoin(config)}
      style={[ps.card, { borderColor: config.accentColor + '88' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      {/* Accent top bar */}
      <View style={[ps.accentBar, { backgroundColor: config.accentColor }]} />
      <View style={ps.cardBody}>
        {/* Left: name + details */}
        <View style={ps.cardLeft}>
          <View style={ps.nameRow}>
            <Text style={[ps.tableName, { color: config.accentColor }]}>{config.name}</Text>
          </View>
          <Text style={ps.description}>{config.description}</Text>
          <View style={ps.statsRow}>
            <Text style={ps.stat}>Blinds: {config.smallBlind}/{config.bigBlind}</Text>
            <Text style={[ps.stat, ps.statSep]}>·</Text>
            <Text style={ps.stat}>Start: {config.startingChips.toLocaleString()} chips</Text>
          </View>
          <View style={ps.badgeRow}>
            <Text style={[ps.badgeText, { color: config.accentColor }]}>{config.badge}</Text>
            <Text style={ps.freeChipsTag}>FREE CHIPS</Text>
          </View>
        </View>
        {/* Right: join button */}
        <Pressable
          style={[ps.joinBtn, { borderColor: config.accentColor }]}
          onPress={() => onJoin(config)}>
          <Text style={[ps.joinBtnText, { color: config.accentColor }]}>JOIN</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const ps = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 14,
    backgroundColor: 'rgba(20,10,40,0.82)',
    overflow: 'hidden',
    marginHorizontal: 2,
  },
  accentBar: { height: 3, width: '100%' },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  cardLeft: { flex: 1, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableName: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 9,
    letterSpacing: 0.5,
  },
  description: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 6,
    color: 'rgba(255,255,255,0.55)',
  },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  stat: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 6,
    color: 'rgba(255,255,255,0.6)',
  },
  statSep: { color: 'rgba(255,255,255,0.3)' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  badgeText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 6,
  },
  freeChipsTag: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 5,
    color: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  joinBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  joinBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    letterSpacing: 1,
  },
});

// ─── Table card ───────────────────────────────────────────────────────────────

type TableCardProps = {
  t: LobbyTable;
  name: string;
  tier: Tier;
  badge: TableBadge;
  pressedId: string | null;
  onPressIn: (id: string) => void;
  onPressOut: () => void;
  onJoinPress: (t: LobbyTable) => void;
  index: number;
  scrollY: SharedValue<number>;
};

const TableCard = React.memo(function TableCard({ t, name, tier, badge, pressedId, onPressIn, onPressOut, onJoinPress, index, scrollY }: TableCardProps) {
  const activity = getActivity(t.playerCount, t.maxPlayers ?? MAX_PLAYERS);
  const isPressed = pressedId === t.id;
  const isHot     = activity.level === 'hot';
  const isWarm    = activity.level === 'warm';
  const [expanded, setExpanded] = useState(false);

  // ── Existing RN animations (pulse dot + VIP rim) ──────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.15, duration: activity.pulseDuration / 2, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: activity.pulseDuration / 2, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [activity.pulseDuration, pulseAnim]);

  const vipAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!tier.isVip) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vipAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
        Animated.timing(vipAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tier.isVip, vipAnim]);

  // ── Parallax (Reanimated v4) ───────────────────────────────────────────────
  const cardTop = index * (CARD_EST_HEIGHT + CARD_GAP);
  const parallaxStyle = useAnimatedStyle(() => {
    const offset = interpolate(
      scrollY.value,
      [cardTop - 350, cardTop + CARD_EST_HEIGHT + 350],
      [-6, 6],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY: offset }] };
  });

  // ── Gold shimmer (Reanimated v3) ──────────────────────────────────────────
  // One shared value drives a 0→1 progress; translateX maps that to a sweep
  // across the card width. Cards are staggered by index so they don't all
  // pulse at the same instant, which would look mechanical.
  const shimmerOffset = useSharedValue(0);
  useEffect(() => {
    shimmerOffset.value = withDelay(
      (index % 6) * 550,
      withRepeat(
        withTiming(1, { duration: 3500, easing: Easing.linear }),
        -1,   // infinite
        false, // don't reverse — linear one-way sweep feels more premium
      ),
    );
    // Cancel on unmount to avoid leaked animation after list recycling
    return () => cancelAnimation(shimmerOffset);
  }, []);

  const shimmerStyle = useAnimatedStyle(() => {
    // Shimmer container is 200px wide.
    // Start fully off-screen left: -(200 + 10) = -210
    // End fully off-screen right: card is ~340px, so 340 + 10 = 350 → use 420 for safety
    const translateX = interpolate(shimmerOffset.value, [0, 1], [-210, 420]);
    return { transform: [{ translateX }] };
  });

  const speed     = getTableSpeed(t.bigBlind);
  const avgPot    = Math.round(t.bigBlind * 4.5);
  const speedColor = speed === 'SLOW' ? '#22c55e' : speed === 'NORMAL' ? '#EAB308' : '#FF6B35';

  return (
    <Reanimated.View style={parallaxStyle}>
      <Pressable onPress={() => setExpanded((v) => !v)}>
        <View style={[
          styles.tableCard,
          { borderColor: tier.borderColor },
          Platform.OS === 'ios' && { shadowColor: tier.shadowColor, shadowOpacity: tier.isVip ? 0.6 : 0.35, shadowRadius: tier.isVip ? 14 : 8, shadowOffset: { width: 0, height: 0 } },
          Platform.OS === 'android' && { elevation: tier.isVip ? 12 : 6 },
        ]}>
          {/* VIP pulsing rim */}
          {tier.isVip && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.vipRim, { opacity: vipAnim }]} />
          )}

          {/* Gold shimmer sweep — 200px wide gradient travels from off-left
              to off-right. Card overflow:hidden clips it cleanly.
              Opacity peaks at 0.20 so it reads as a soft light reflection,
              not a distracting flash. */}
          <Reanimated.View pointerEvents="none" style={[styles.shimmerContainer, shimmerStyle]}>
            <LinearGradient
              colors={[
                'transparent',
                'rgba(255,215,0,0.06)',
                'rgba(255,215,0,0.18)',
                'rgba(255,255,255,0.08)',
                'rgba(255,215,0,0.18)',
                'rgba(255,215,0,0.06)',
                'transparent',
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Reanimated.View>

          <View style={styles.tableCardBody}>
            {/* Name row */}
            <View style={styles.tableNameRow}>
              <Text style={styles.tableName}>{name}</Text>
              <View style={[styles.tierBadge, { borderColor: tier.accentColor, backgroundColor: tier.accentColor + '22' }]}>
                <Text style={[styles.tierBadgeText, { color: tier.accentColor }]}>{tier.label}</Text>
              </View>
              {badge && (
                <View style={[styles.tableBadge, { borderColor: badge.color, backgroundColor: badge.color + '22' }]}>
                  <Text style={[styles.tableBadgeText, { color: badge.color }]}>{badge.text}</Text>
                </View>
              )}
            </View>

            <Text style={styles.tableDetail}>
              Blinds: {(t.smallBlind / 200).toFixed(2)} / {(t.bigBlind / 200).toFixed(2)} SOL
            </Text>

            <View style={styles.tableRow}>
              <Animated.View style={[styles.statusDot, { backgroundColor: activity.dotColor, opacity: pulseAnim }]} />
              <Text style={[styles.tableDetail, isHot && styles.tableDetailHot]}>
                {t.playerCount}/{t.maxPlayers ?? MAX_PLAYERS} players{isHot ? '  🔥' : ''}
              </Text>
            </View>

            <Text style={styles.tableDetail}>Min buy-in: {(t.minBuyIn / 100).toFixed(0)} SOL</Text>

            {/* Expanded details */}
            {expanded && (
              <View style={styles.expandedBlock}>
                <View style={styles.expandedRow}>
                  <Text style={styles.expandedLabel}>AVG POT</Text>
                  <Text style={styles.expandedValue}>{avgPot.toLocaleString()} chips</Text>
                </View>
                <View style={styles.expandedRow}>
                  <Text style={styles.expandedLabel}>SPEED</Text>
                  <Text style={[styles.expandedValue, { color: speedColor }]}>{speed}</Text>
                </View>
                <View style={styles.expandedRow}>
                  <Text style={styles.expandedLabel}>SEATS LEFT</Text>
                  <Text style={styles.expandedValue}>{(t.maxPlayers ?? MAX_PLAYERS) - t.playerCount}</Text>
                </View>
              </View>
            )}
          </View>

          <Pressable
            style={[styles.joinBtn, styles.joinBtnWrap, isWarm && styles.joinBtnWarm, isHot && styles.joinBtnHot, isPressed && styles.joinBtnPressed]}
            onPressIn={() => onPressIn(t.id)}
            onPressOut={onPressOut}
            onPress={(e) => { e.stopPropagation?.(); onPressOut(); onJoinPress(t); }}>
            <ImageBackground
              source={isPressed ? require('@/assets/images/buttons/join-btn-pressed.png') : require('@/assets/images/buttons/join-btn.png')}
              style={styles.joinBtnBg}
              resizeMode="stretch">
              <Text style={styles.joinBtnText}>JOIN</Text>
            </ImageBackground>
          </Pressable>
        </View>
      </Pressable>
    </Reanimated.View>
  );
});

// ─── Sort / filter bar ────────────────────────────────────────────────────────

type SortKey = 'BLINDS' | 'PLAYERS' | 'BUY-IN';

function FilterBar({ sort, onSort, joinableOnly, onToggleJoinable, totalCount, shownCount }: {
  sort: SortKey; onSort: (k: SortKey) => void;
  joinableOnly: boolean; onToggleJoinable: () => void;
  totalCount: number; shownCount: number;
}) {
  return (
    <View style={styles.filterBarWrap}>
      <View style={styles.filterBar}>
        <View style={styles.filterSortRow}>
          {(['BLINDS', 'PLAYERS', 'BUY-IN'] as SortKey[]).map((k) => (
            <Pressable key={k} style={[styles.sortChip, sort === k && styles.sortChipActive]} onPress={() => onSort(k)}>
              <Text style={[styles.sortChipText, sort === k && styles.sortChipTextActive]}>{k}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.joinableToggle, joinableOnly && styles.joinableToggleActive]} onPress={onToggleJoinable}>
          <Text style={[styles.joinableToggleText, joinableOnly && styles.joinableToggleTextActive]}>
            {joinableOnly ? '✓ OPEN' : 'OPEN'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.filterCount}>
        {shownCount === totalCount
          ? `${totalCount} TABLE${totalCount !== 1 ? 'S' : ''}`
          : `${shownCount} / ${totalCount} TABLES`}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type DisplayRow = { t: LobbyTable; name: string; tier: Tier };

export default function LobbyScreen() {
  const tables = useLobbyStore((s) => s.tables);
  const { accounts } = useWallet();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'SOLANA' | 'PRACTICE'>('SOLANA');
  const [sortBy, setSortBy] = useState<SortKey>('BLINDS');
  const [joinableOnly, setJoinableOnly] = useState(false);
  const [pressedJoinTableId, setPressedJoinTableId] = useState<string | null>(null);


  // Create form (hidden behind feature flag)
  const [showCreate] = useState(false);
  const [smallBlind, setSmallBlind] = useState('10');
  const [bigBlind, setBigBlind] = useState('20');
  const [minBuyIn, setMinBuyIn] = useState('200');
  const [maxBuyIn, setMaxBuyIn] = useState('2000');

  // Parallax scroll shared value
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const { showTransition, hideTransition } = useTransition();
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  // onLayout is reliable for SplashScreen (fires on first paint) but NOT for
  // hideTransition — if fonts aren't loaded yet when onLayout fires, fontsLoaded
  // is false and hideTransition is never called, leaving the overlay stuck forever.
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync().catch(() => {}); // safe if already hidden
    }
  }, [fontsLoaded, fontError]);

  // useEffect watches fontsLoaded independently of layout timing, so
  // hideTransition() is guaranteed to fire as soon as fonts are ready.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      hideTransition();
    }
  }, [fontsLoaded, fontError, hideTransition]);

  // On return visits fonts are already loaded so the useEffect above won't re-fire.
  // useFocusEffect runs every time the screen gains focus, ensuring the loader is dismissed.
  useFocusEffect(useCallback(() => {
    if (fontsLoaded || fontError) hideTransition();
    SocketService.requestTables();
  }, [fontsLoaded, fontError, hideTransition]));

  const isWalletConnected = !!accounts?.length;
  const isWalletConnectedRef = useRef(isWalletConnected);
  isWalletConnectedRef.current = isWalletConnected;
  const rawAddress = accounts?.[0]?.address;
  const shortAddress = rawAddress != null ? truncateAddress(rawAddress) : null;

  const [solBalance, setSolBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!rawAddress) { setSolBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const pubkey = new PublicKey(rawAddress);
        const lamports = await connection.getBalance(pubkey);
        if (!cancelled) setSolBalance((lamports / LAMPORTS_PER_SOL).toFixed(2) + ' SOL');
      } catch {
        if (!cancelled) setSolBalance('-- SOL');
      }
    })();
    return () => { cancelled = true; };
  }, [rawAddress]);

  // Table names are computed once per render cycle; reset counter first
  const tableNames = useMemo(() => {
    const counts: Record<string, number> = {};
    return tables.map((t) => {
      const tier = getTier(t.bigBlind);
      const key  = tier.label;
      const names = TIER_NAMES[key] ?? TIER_NAMES.LOW;
      const idx  = counts[key] ?? 0;
      counts[key] = idx + 1;
      return names[idx % names.length];
    });
  }, [tables]);

  const handleJoin = useCallback(async (tableId: string) => {
    await showTransition();
    router.push(`/table/${tableId}`);
  }, [showTransition, router]);

  /** Join a practice table — creates a real server room with the config's blinds, no wallet needed. */
  const handlePracticeJoin = useCallback(async (config: PracticeConfig) => {
    const tableId = await SocketService.createTable({
      name: config.name,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      minBuyIn: config.startingChips,
      maxBuyIn: config.startingChips * 2,
    });
    if (!tableId) return;
    await showTransition();
    router.push(`/table/${tableId}`);
  }, [showTransition, router]);

  /** Navigate to settings so the user can connect their wallet. */
  const promptConnectWallet = useCallback(() => {
    // router.navigate works correctly for tab-to-tab navigation on repeated calls
    router.navigate({ pathname: '/(tabs)/settings', params: { connectWallet: '1' } });
  }, [router]);

  /** Join a table directly — no modal. Redirects to settings if wallet not connected. */
  const handleJoinPress = useCallback((t: LobbyTable) => {
    // Read via ref so this callback never goes stale between re-renders
    if (!isWalletConnectedRef.current) {
      promptConnectWallet();
      return;
    }
    handleJoin(t.id);
  }, [promptConnectWallet, handleJoin]);

  const handleQuickJoin = useCallback(() => {
    if (!isWalletConnectedRef.current) { promptConnectWallet(); return; }
    if (!tables.length) return;
    const joinable = tables.filter((t) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));
    if (!joinable.length) return;
    const best = joinable.sort((a, b) => {
      const aScore = a.playerCount * 10 - a.bigBlind;
      const bScore = b.playerCount * 10 - b.bigBlind;
      return bScore - aScore;
    })[0];
    handleJoin(best.id);
  }, [isWalletConnected, promptConnectWallet, tables, handleJoin]);

  const handleCreate = async () => {
    const sb = parseInt(smallBlind, 10) || 10;
    const bb = parseInt(bigBlind, 10) || 20;
    const min = parseInt(minBuyIn, 10) || 200;
    const max = parseInt(maxBuyIn, 10) || 2000;
    const tableId = await SocketService.createTable({ name: `TABLE_${Date.now().toString(36).toUpperCase()}`, smallBlind: sb, bigBlind: bb, minBuyIn: min, maxBuyIn: max });
    if (!tableId) return;
    const err = await SocketService.joinTable(tableId, min, getPlayerName());
    if (err) { console.warn('[lobby] joinTable after create error:', err); return; }
    router.push(`/table/${tableId}`);
  };

  // Sort + filter
  const displayTables = useMemo<DisplayRow[]>(() => {
    if (activeTab === 'PRACTICE') return [];

    let list = tables.map((t, i) => ({ t, name: tableNames[i] ?? 'TABLE', tier: getTier(t.bigBlind) }));

    if (joinableOnly) list = list.filter(({ t }) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));

    if (sortBy === 'BLINDS')  list.sort((a, b) => a.t.bigBlind - b.t.bigBlind || a.t.id.localeCompare(b.t.id));
    if (sortBy === 'PLAYERS') list.sort((a, b) => b.t.playerCount - a.t.playerCount || a.t.id.localeCompare(b.t.id));
    if (sortBy === 'BUY-IN')  list.sort((a, b) => a.t.minBuyIn - b.t.minBuyIn || a.t.id.localeCompare(b.t.id));

    return list;
  }, [tables, tableNames, sortBy, joinableOnly, activeTab]);

  const renderItem = useCallback(({ item, index }: { item: DisplayRow; index: number }) => (
    <TableCard
      t={item.t}
      name={item.name}
      tier={item.tier}
      badge={getTableBadge(item.t, tables)}
      pressedId={pressedJoinTableId}
      onPressIn={setPressedJoinTableId}
      onPressOut={() => setPressedJoinTableId(null)}
      onJoinPress={handleJoinPress}
      index={index}
      scrollY={scrollY}
    />
  ), [tables, pressedJoinTableId, handleJoinPress, scrollY]);

  const keyExtractor = useCallback((item: DisplayRow) => item.t.id, []);

  const ItemSeparator = useCallback(() => <View style={{ height: CARD_GAP }} />, []);

  const EmptyComponent = useCallback(() => (
    <View style={styles.emptyState}>
      {activeTab === 'PRACTICE' ? (
        <>
          <Text style={styles.emptyStateTitle}>COMING SOON</Text>
          <Text style={styles.emptyStateText}>Practice tables with{'\n'}free chips are on the way.</Text>
        </>
      ) : (
        <>
          <Text style={styles.emptyStateTitle}>NO TABLES</Text>
          <Text style={styles.emptyStateText}>
            {joinableOnly ? 'No joinable tables found.\nTry turning off the filter.' : 'No tables available right now.'}
          </Text>
        </>
      )}
    </View>
  ), [activeTab, joinableOnly]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <ImageBackground source={require('@/assets/images/lobby-bg.png')} style={StyleSheet.absoluteFill} resizeMode="cover" />

      <View style={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.push('/(tabs)')}>
            <Text style={styles.backBtnText}>{'<'}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>TABLES</Text>
          {isWalletConnected ? (
            <View style={styles.walletBadge}>
              <View style={[styles.walletDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[styles.walletStatusText, { color: '#22c55e' }]}>{solBalance ?? '…'}</Text>
            </View>
          ) : (
            <View style={[styles.walletBadge, styles.walletBadgeDisconnected, { flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }]}>
              <View style={[styles.walletDot, { backgroundColor: '#FF3B3B', marginBottom: 4 }]} />
              <Text style={[styles.walletStatusText, { color: '#FF6B6B' }]}>NOT{'\n'}CONNECTED</Text>
            </View>
          )}
        </View>

        {/* Quick Join */}
        {activeTab === 'SOLANA' && (
          <Pressable
            style={({ pressed }) => [styles.quickJoinBtn, pressed && styles.quickJoinBtnPressed]}
            onPress={handleQuickJoin}>
            <View style={styles.quickJoinLeft}>
              <Text style={styles.quickJoinLabel}>QUICK JOIN</Text>
              <Text style={styles.quickJoinSub}>Best available table</Text>
            </View>
            <Text style={styles.quickJoinArrow}>{'>'}</Text>
          </Pressable>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, activeTab === 'SOLANA' && styles.tabActive]} onPress={() => setActiveTab('SOLANA')}>
            <Text style={[styles.tabText, activeTab === 'SOLANA' && styles.tabTextActive]}>SOLANA</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === 'PRACTICE' && styles.tabActivePractice]} onPress={() => setActiveTab('PRACTICE')}>
            <Text style={[styles.tabText, activeTab === 'PRACTICE' && styles.tabTextActivePractice]}>PRACTICE</Text>
          </Pressable>
        </View>

        {/* Sort / filter bar — only for SOLANA */}
        {activeTab === 'SOLANA' && (
          <FilterBar
            sort={sortBy}
            onSort={setSortBy}
            joinableOnly={joinableOnly}
            onToggleJoinable={() => setJoinableOnly((v) => !v)}
            totalCount={tables.length}
            shownCount={displayTables.length}
          />
        )}

        {/* Practice tab: static rooms with free chips */}
        {activeTab === 'PRACTICE' ? (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            data={PRACTICE_TABLES}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <PracticeCard config={item} onJoin={handlePracticeJoin} />
            )}
            ItemSeparatorComponent={ItemSeparator}
          />
        ) : (
          /* Solana tab: real tables from server */
          <AnimatedFlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            data={displayTables as any}
            keyExtractor={keyExtractor as any}
            renderItem={renderItem as any}
            ItemSeparatorComponent={ItemSeparator}
            ListEmptyComponent={EmptyComponent}
            onScroll={scrollHandler as any}
            scrollEventThrottle={16}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={5}
          />
        )}

        {/* Hidden create form */}
        {false && showCreate && (
          <View style={styles.createForm}>
            <TextInput style={styles.input} placeholder="Small blind" placeholderTextColor="rgba(255,255,255,0.5)" value={smallBlind} onChangeText={setSmallBlind} keyboardType="number-pad" />
            <TextInput style={styles.input} placeholder="Big blind" placeholderTextColor="rgba(255,255,255,0.5)" value={bigBlind} onChangeText={setBigBlind} keyboardType="number-pad" />
            <TextInput style={styles.input} placeholder="Min buy-in" placeholderTextColor="rgba(255,255,255,0.5)" value={minBuyIn} onChangeText={setMinBuyIn} keyboardType="number-pad" />
            <TextInput style={styles.input} placeholder="Max buy-in" placeholderTextColor="rgba(255,255,255,0.5)" value={maxBuyIn} onChangeText={setMaxBuyIn} keyboardType="number-pad" />
            <Pressable style={[styles.createButton, styles.submit]} onPress={handleCreate}>
              <Text style={styles.createButtonText}>Create & join</Text>
            </Pressable>
          </View>
        )}
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const gold     = '#FFD700';
const darkGold = '#B8860B';
const neonCyan = '#00FFFF';
const panelBg  = 'rgba(81, 46, 123, 0.92)';

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: panelBg, borderRadius: 16, borderWidth: 2, borderColor: gold,
    paddingVertical: 12, paddingHorizontal: 16, marginBottom: 12,
    ...Platform.select({ ios: { shadowColor: neonCyan, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 8 }, android: { elevation: 8 }, default: {} }),
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 8, marginRight: 8 },
  backBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold },
  headerTitle: { paddingTop: 10, fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 14 : 12, color: gold, letterSpacing: 1 },
  walletBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(34,197,94,0.5)',
    paddingVertical: 6, paddingHorizontal: 10, gap: 6,
  },
  walletBadgeDisconnected: { borderColor: 'rgba(255,59,59,0.5)' },
  walletDot: { width: 8, height: 8, borderRadius: 4 },
  walletStatusText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, lineHeight: 11, textAlign: 'center' },

  // Quick join
  quickJoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: panelBg,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: gold,
    borderLeftWidth: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    ...Platform.select({ ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8 }, android: { elevation: 6 }, default: {} }),
  },
  quickJoinBtnPressed: { opacity: 0.8 },
  quickJoinLeft: { gap: 5 },
  quickJoinLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 11 : 10, color: gold, letterSpacing: 1 },
  quickJoinSub: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.45)' },
  quickJoinArrow: { fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 16 },
  emptyStateTitle: { fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold, letterSpacing: 2 },
  emptyStateText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 16 },

  // Tabs
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: gold, backgroundColor: panelBg, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: gold, borderColor: darkGold },
  tabActivePractice: { backgroundColor: '#22c55e', borderColor: '#16a34a' },
  tabText: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: gold },
  tabTextActive: { color: '#1a0a2e' },
  tabTextActivePractice: { color: '#1a0a2e' },

  // Filter bar
  filterBarWrap: { marginBottom: 12, gap: 6 },
  filterBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  filterCount: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.35)', textAlign: 'right' },
  filterSortRow: { flexDirection: 'row', gap: 6, flex: 1 },
  sortChip: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', backgroundColor: 'rgba(81,46,123,0.6)' },
  sortChipActive: { borderColor: gold, backgroundColor: 'rgba(255,215,0,0.15)' },
  sortChipText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.5)' },
  sortChipTextActive: { color: gold },
  joinableToggle: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)', backgroundColor: 'rgba(81,46,123,0.6)' },
  joinableToggleActive: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)' },
  joinableToggleText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.5)' },
  joinableToggleTextActive: { color: '#22c55e' },

  // List
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },

  // Table card
  tableCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: panelBg, borderRadius: 16, borderWidth: 2, padding: 14, overflow: 'hidden',
  },
  vipRim: {
    borderRadius: 16, borderWidth: 2, borderColor: '#BF5FFF',
    ...Platform.select({ ios: { shadowColor: '#BF5FFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 12 }, default: {} }),
  },
  // Gold shimmer overlay — 200px wide so the gradient feathers softly.
  // Sits inside card's overflow:hidden boundary; no extra clipping needed.
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 200,
  },
  tableCardBody: { flex: 1, minWidth: 0, gap: 5 },
  tableNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  tableName: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 12 : 10, color: gold, letterSpacing: 0.5 },
  tierBadge: { borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 5 },
  tierBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, letterSpacing: 0.5 },
  tableBadge: { borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 5 },
  tableBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, letterSpacing: 0.3 },
  tableDetail: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.9)' },
  tableDetailHot: { color: '#FF9A6C' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  expandedBlock: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 5 },
  expandedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expandedLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.5)' },
  expandedValue: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.9)' },

  // JOIN button
  joinBtn: { minHeight: 44, minWidth: 88, borderRadius: 12, marginLeft: 12, overflow: 'hidden' },
  joinBtnWarm: { ...Platform.select({ ios: { shadowColor: '#EAB308', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 8 }, android: { elevation: 8 }, default: {} }) },
  joinBtnHot:  { ...Platform.select({ ios: { shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 12 }, android: { elevation: 12 }, default: {} }) },
  joinBtnWrap: { overflow: 'hidden' },
  joinBtnBg: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  joinBtnPressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  joinBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: '#1a0a2e' },

  // Create form
  createButton: { backgroundColor: panelBg, borderWidth: 2, borderColor: gold, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  createButtonText: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 12 : 11, color: gold, letterSpacing: 1 },
  createForm: { marginTop: 12, gap: 10 },
  input: { borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)', borderRadius: 10, padding: 12, color: '#fff', fontFamily: 'PressStart2P_400Regular', fontSize: 12 },
  submit: { marginTop: 8 },
});

// ─── Buy-in modal styles ──────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(26,10,46,0.98)',
    borderRadius: 20,
    borderWidth: 2,
    padding: 24,
    gap: 14,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.7, shadowRadius: 24 }, android: { elevation: 24 }, default: {} }),
  },
  title: { fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold, textAlign: 'center', letterSpacing: 2 },
  badge: { alignSelf: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 },
  badgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, letterSpacing: 1 },
  amountLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)', textAlign: 'center', letterSpacing: 1 },
  amount: { fontFamily: 'PressStart2P_400Regular', fontSize: 22, textAlign: 'center', letterSpacing: 1 },
  track: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3, minWidth: 6 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.4)' },
  presets: { flexDirection: 'row', gap: 8 },
  preset: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  presetText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.6)' },
  fineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  fineBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  fineBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 18, color: gold, lineHeight: 22 },
  fineAmount: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.9)', flex: 1, textAlign: 'center' },
  confirmBtn: {
    paddingVertical: 16, borderRadius: 14, borderWidth: 2, alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.08)',
    ...Platform.select({ ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10 }, android: { elevation: 6 }, default: {} }),
  },
  confirmBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, letterSpacing: 1 },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: 'rgba(255,255,255,0.4)' },
});
