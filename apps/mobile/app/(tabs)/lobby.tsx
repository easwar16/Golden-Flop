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

import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { SocketService } from '@/services/SocketService';
import { useLobbyStore, LobbyTable } from '@/stores/useLobbyStore';
import { getPlayerName } from '@/utils/player-identity';
import { useWallet } from '@/contexts/wallet-context';
import { useAuth } from '@/contexts/auth-context';
import { Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { SOLANA_NETWORK } from '@/constants/solana';

const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList) as typeof FlatList;

const MAX_PLAYERS = 6;
const CARD_EST_HEIGHT = 110; // approximate card height for parallax
const CARD_GAP = 14;

// ─── Tier ─────────────────────────────────────────────────────────────────────

type Tier = { label: string; accentColor: string; borderColor: string; shadowColor: string; isVip: boolean };

function getTier(bigBlind: number): Tier {
  const bb = bigBlind / LAMPORTS_PER_SOL;
  if (bb <= 0.002)  return { label: 'MICRO', accentColor: '#7FFFD4', borderColor: 'rgba(127,255,212,0.55)', shadowColor: '#7FFFD4', isVip: false };
  if (bb <= 0.005)  return { label: 'LOW',   accentColor: '#00FFFF', borderColor: 'rgba(0,255,255,0.55)',   shadowColor: '#00FFFF', isVip: false };
  if (bb <= 0.016)  return { label: 'MID',   accentColor: '#FFD700', borderColor: 'rgba(255,215,0,0.75)',   shadowColor: '#FFD700', isVip: false };
  if (bb <= 0.02)   return { label: 'HIGH',  accentColor: '#FF3B6F', borderColor: 'rgba(255,59,111,0.75)',  shadowColor: '#FF3B6F', isVip: false };
  return                     { label: 'VIP',   accentColor: '#BF5FFF', borderColor: 'rgba(191,95,255,0.85)',  shadowColor: '#BF5FFF', isVip: true  };
}

// ─── Table name per tier ──────────────────────────────────────────────────────

const TIER_NAMES: Record<string, string[]> = {
  MICRO:['PENNY LANE',     'DUST BOWL',     'ROOKIE PIT',    'TINY TABLE',    'COPPER POT',    'FIRST STEPS',   'CHIP STARTER',  'NANO ROOM',     'SMALL FRY',    'PIXEL DUST'],
  LOW:  ['PIXEL PARADISE', 'NEON ALLEY',    'COIN CORNER',   'STARTER DECK',  'LUCKY LANE',    'COPPER CHIP',   'SILVER SPARK',  'ROOKIE ROOM',   'BRONZE GATE',  'GREEN FELT'],
  MID:  ['GOLDEN TABLE',   'VELVET ROOM',   'DIAMOND LOUNGE','HIGH STREET',   'AMBER HALL',    'JADE TERRACE',  'CRYSTAL CLUB',  'EMBER LOUNGE',  'SAPPHIRE DEN', 'RUBY ROOM'],
  HIGH: ['ROYAL FLUSH',    'IRON THRONE',   'PRESTIGE ROOM', 'THE PENTHOUSE', 'OBSIDIAN ROOM', 'SCARLET SUITE', 'TITAN TABLE',   'DRAGON DEN',    'INFERNO ROOM', 'BLAZE HALL'],
  VIP:  ['ACE HIGH',       'CROWN JEWELS',  'PLATINUM SUITE','INFINITY TABLE','DIAMOND VAULT', 'CELESTIAL ROOM'],
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
  if (t.playerCount >= 2 && ratio < 0.67 && t.bigBlind / LAMPORTS_PER_SOL <= 0.005) return { text: '⭐ REC', color: '#FFD700' };
  return null;
}

// ─── Table speed ──────────────────────────────────────────────────────────────

function getTableSpeed(turnTimeoutMs: number): string {
  if (turnTimeoutMs <= 10_000) return 'TURBO';
  if (turnTimeoutMs <= 15_000) return 'FAST';
  if (turnTimeoutMs <= 30_000) return 'NORMAL';
  return 'SLOW';
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

// ─── Practice tier mapping ────────────────────────────────────────────────────

function getPracticeTier(tableId: string): Tier {
  if (tableId.startsWith('practice-beginner'))   return { label: 'EASY',    accentColor: '#22c55e', borderColor: 'rgba(34,197,94,0.55)',   shadowColor: '#22c55e', isVip: false };
  if (tableId.startsWith('practice-casual'))     return { label: 'FUN',     accentColor: '#00FFFF', borderColor: 'rgba(0,255,255,0.55)',   shadowColor: '#00FFFF', isVip: false };
  if (tableId.startsWith('practice-advanced'))   return { label: 'INTENSE', accentColor: '#FFD700', borderColor: 'rgba(255,215,0,0.75)',   shadowColor: '#FFD700', isVip: false };
  if (tableId.startsWith('practice-highroller')) return { label: 'VIP',     accentColor: '#BF5FFF', borderColor: 'rgba(191,95,255,0.85)',  shadowColor: '#BF5FFF', isVip: true  };
  if (tableId.startsWith('practice-turbo'))      return { label: 'TURBO',   accentColor: '#FF6B35', borderColor: 'rgba(255,107,53,0.65)',  shadowColor: '#FF6B35', isVip: false };
  if (tableId.startsWith('practice-headsup'))    return { label: '1v1',     accentColor: '#00E5FF', borderColor: 'rgba(0,229,255,0.55)',   shadowColor: '#00E5FF', isVip: false };
  return { label: 'FUN', accentColor: '#00FFFF', borderColor: 'rgba(0,255,255,0.55)', shadowColor: '#00FFFF', isVip: false };
}

function getPracticeName(tableId: string): string {
  if (tableId.startsWith('practice-beginner'))   return 'BEGINNER TABLE';
  if (tableId.startsWith('practice-casual'))     return 'CASUAL LOUNGE';
  if (tableId.startsWith('practice-advanced'))   return 'ADVANCED ROOM';
  if (tableId.startsWith('practice-highroller')) return 'HIGH ROLLER';
  if (tableId.startsWith('practice-turbo'))      return 'TURBO PRACTICE';
  if (tableId.startsWith('practice-headsup'))    return 'HEADS UP';
  return tableId;
}

// ─── SEEKER tier mapping ──────────────────────────────────────────────────────

function getSeekerTier(bigBlind: number): Tier {
  if (bigBlind <= 2)    return { label: 'MICRO', accentColor: '#CE93D8', borderColor: 'rgba(206,147,216,0.55)', shadowColor: '#CE93D8', isVip: false };
  if (bigBlind <= 5)    return { label: 'LOW',   accentColor: '#BF5FFF', borderColor: 'rgba(191,95,255,0.55)',  shadowColor: '#BF5FFF', isVip: false };
  if (bigBlind <= 20)   return { label: 'MID',   accentColor: '#E040FB', borderColor: 'rgba(224,64,251,0.65)',  shadowColor: '#E040FB', isVip: false };
  if (bigBlind <= 100)  return { label: 'HIGH',  accentColor: '#FF6BF0', borderColor: 'rgba(255,107,240,0.65)', shadowColor: '#FF6BF0', isVip: false };
  return                         { label: 'VIP',   accentColor: '#FFD700', borderColor: 'rgba(255,215,0,0.75)',   shadowColor: '#FFD700', isVip: true  };
}

const SEEKER_TIER_NAMES: string[][] = [
  ['SEEKER PIT', 'SEEKER NEST', 'SEEKER COVE', 'SEEKER DEN', 'SEEKER NOOK', 'SEEKER BURROW', 'SEEKER HOLLOW', 'SEEKER CREEK'],
  ['SEEKER LOUNGE', 'SEEKER GROVE', 'SEEKER MEADOW', 'SEEKER GARDEN', 'SEEKER OASIS', 'SEEKER PLAZA', 'SEEKER COURT', 'SEEKER TERRACE'],
  ['SEEKER ARENA', 'SEEKER FORGE', 'SEEKER TOWER', 'SEEKER CITADEL', 'SEEKER BASTION', 'SEEKER SANCTUM', 'SEEKER KEEP', 'SEEKER HALL'],
  ['SEEKER VAULT', 'SEEKER SUMMIT', 'SEEKER PEAK', 'SEEKER APEX', 'SEEKER ZENITH', 'SEEKER SPIRE'],
  ['SEEKER THRONE', 'SEEKER CROWN', 'SEEKER DYNASTY', 'SEEKER EMPIRE', 'SEEKER DOMINION'],
];

function getSeekerTierIndex(bigBlind: number): number {
  if (bigBlind <= 2)   return 0; // micro
  if (bigBlind <= 5)   return 1; // low
  if (bigBlind <= 20)  return 2; // mid
  if (bigBlind <= 100) return 3; // high
  return 4;                       // vip
}

function computeSeekerNames(tables: { bigBlind: number }[]): string[] {
  const counters: Record<number, number> = {};
  return tables.map((t) => {
    const idx = getSeekerTierIndex(t.bigBlind);
    const names = SEEKER_TIER_NAMES[idx];
    const count = counters[idx] ?? 0;
    counters[idx] = count + 1;
    return names[count % names.length];
  });
}

function formatSeeker(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return `${amount}`;
}

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
  onShowDetails: () => void;
  index: number;
  scrollY: SharedValue<number>;
};

const TableCard = React.memo(function TableCard({ t, name, tier, badge, pressedId, onPressIn, onPressOut, onJoinPress, onShowDetails, index, scrollY }: TableCardProps) {
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

  const isPractice = t.isPractice ?? false;
  const isSeeker  = t.tokenType === 'SEEKER';
  const speed     = getTableSpeed(t.turnTimeoutMs);
  const avgPot    = isPractice || isSeeker ? Math.round(t.bigBlind * 4.5) : (t.bigBlind * 4.5) / LAMPORTS_PER_SOL;
  const speedColor = speed === 'SLOW' ? '#22c55e' : speed === 'NORMAL' ? '#EAB308' : '#FF6B35';

  return (
    <Reanimated.View style={parallaxStyle}>
      <Pressable onPress={() => setExpanded((v) => !v)} onLongPress={onShowDetails}>
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
            {/* Name + copy */}
            <View style={styles.tableNameRow}>
              <Text style={styles.tableName}>{name}</Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  Clipboard.setStringAsync(t.id);
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.copyIdBtn, pressed && { opacity: 0.5 }]}>
                <MaterialCommunityIcons name="content-copy" size={14} color="rgba(255,255,255,0.4)" />
              </Pressable>
            </View>

            <Text style={styles.tableDetailLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              Blinds: <Text style={styles.tableDetailNum}>
                {isPractice
                  ? `${t.smallBlind}/${t.bigBlind} chips`
                  : isSeeker
                  ? `${formatSeeker(t.smallBlind)} / ${formatSeeker(t.bigBlind)} SEEKER`
                  : `${(t.smallBlind / LAMPORTS_PER_SOL).toFixed(4)} / ${(t.bigBlind / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
              </Text>
            </Text>

            <View style={styles.tableRow}>
              <Animated.View style={[styles.statusDot, { backgroundColor: activity.dotColor, opacity: pulseAnim }]} />
              <Text style={[styles.tableDetail, isHot && styles.tableDetailHot]}>
                {t.playerCount}/{t.maxPlayers ?? MAX_PLAYERS} players{isHot ? '' : ''}
              </Text>
            </View>

            <Text style={styles.tableDetailLabel}>
              {isPractice ? 'Start: ' : 'Buy-in: '}<Text style={styles.tableDetailNum}>
                {isPractice
                  ? `${t.minBuyIn.toLocaleString()} chips`
                  : isSeeker
                  ? `${formatSeeker(t.minBuyIn)} SEEKER`
                  : `${(t.minBuyIn / LAMPORTS_PER_SOL).toFixed(2)} SOL`}
              </Text>
            </Text>

            {!expanded && (
              <Text style={styles.tapHint}>Tap for more details</Text>
            )}

            {expanded && (
              <View style={styles.expandedBlock}>
                <View style={styles.expandedRow}>
                  <Text style={styles.expandedLabel}>AVG POT</Text>
                  <Text style={styles.expandedValue}>
                    {isPractice || isSeeker ? `${avgPot.toLocaleString()}${isSeeker ? ' SEEKER' : ' chips'}` : `${avgPot.toFixed(4)} SOL`}
                  </Text>
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

          <View style={styles.cardRight}>
            <View style={styles.badgeRow}>
              <View style={[styles.tierBadge, { borderColor: tier.accentColor, backgroundColor: tier.accentColor + '22' }]}>
                <Text style={[styles.tierBadgeText, { color: tier.accentColor }]}>{tier.label}</Text>
              </View>
              {isPractice && (
                <View style={[styles.tableBadge, { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                  <Text style={[styles.tableBadgeText, { color: '#22c55e' }]}>FREE</Text>
                </View>
              )}
              {!isPractice && badge && (
                <View style={[styles.tableBadge, { borderColor: badge.color, backgroundColor: badge.color + '22' }]}>
                  <Text style={[styles.tableBadgeText, { color: badge.color }]}>{badge.text}</Text>
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

// ─── Room Details Modal ──────────────────────────────────────────────────────

type RoomDetailsModalProps = {
  visible: boolean;
  table: LobbyTable | null;
  name: string;
  tier: Tier;
  onClose: () => void;
  onJoin: (t: LobbyTable) => void;
};

function RoomDetailsModal({ visible, table, name, tier, onClose, onJoin }: RoomDetailsModalProps) {
  const [copied, setCopied] = useState(false);

  if (!table) return null;

  const isPractice = table.isPractice ?? false;
  const isSeeker = table.tokenType === 'SEEKER';
  const blindsText = isPractice
    ? `${table.smallBlind}/${table.bigBlind} chips`
    : isSeeker
    ? `${formatSeeker(table.smallBlind)} / ${formatSeeker(table.bigBlind)} SEEKER`
    : `${(table.smallBlind / LAMPORTS_PER_SOL).toFixed(4)} / ${(table.bigBlind / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
  const buyInText = isPractice
    ? `${table.minBuyIn.toLocaleString()} – ${table.maxBuyIn.toLocaleString()} chips`
    : isSeeker
    ? `${formatSeeker(table.minBuyIn)} – ${formatSeeker(table.maxBuyIn)} SEEKER`
    : `${(table.minBuyIn / LAMPORTS_PER_SOL).toFixed(2)} – ${(table.maxBuyIn / LAMPORTS_PER_SOL).toFixed(2)} SOL`;
  const speed = getTableSpeed(table.turnTimeoutMs);
  const speedColor = speed === 'SLOW' ? '#22c55e' : speed === 'NORMAL' ? '#EAB308' : '#FF6B35';

  const handleCopyId = async () => {
    await Clipboard.setStringAsync(table.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={rdm.overlay} onPress={onClose}>
        <Pressable style={[rdm.panel, { borderColor: tier.accentColor }]} onPress={(e) => e.stopPropagation?.()}>
          {/* Title */}
          <Text style={[rdm.title, { color: tier.accentColor }]}>{name}</Text>
          <View style={[rdm.tierTag, { borderColor: tier.accentColor, backgroundColor: tier.accentColor + '22' }]}>
            <Text style={[rdm.tierTagText, { color: tier.accentColor }]}>{tier.label}</Text>
          </View>

          {/* Room ID — tappable to copy */}
          <Pressable onPress={handleCopyId} style={rdm.idRow}>
            <Text style={rdm.label}>ROOM ID</Text>
            <View style={rdm.idValueRow}>
              <Text style={rdm.idValue}>{table.id}</Text>
              <View style={[rdm.copyBadge, copied && { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                <Text style={[rdm.copyBadgeText, copied && { color: '#22c55e' }]}>
                  {copied ? 'COPIED!' : 'TAP TO COPY'}
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Details grid */}
          <View style={rdm.divider} />
          <View style={rdm.detailRow}>
            <Text style={rdm.label}>BLINDS</Text>
            <Text style={rdm.value}>{blindsText}</Text>
          </View>
          <View style={rdm.detailRow}>
            <Text style={rdm.label}>PLAYERS</Text>
            <Text style={rdm.value}>{table.playerCount} / {table.maxPlayers ?? MAX_PLAYERS}</Text>
          </View>
          <View style={rdm.detailRow}>
            <Text style={rdm.label}>BUY-IN</Text>
            <Text style={rdm.value}>{buyInText}</Text>
          </View>
          <View style={rdm.detailRow}>
            <Text style={rdm.label}>SPEED</Text>
            <Text style={[rdm.value, { color: speedColor }]}>{speed}</Text>
          </View>

          {/* Actions */}
          <View style={rdm.divider} />
          <Pressable style={[rdm.joinBtn, { borderColor: tier.accentColor }]} onPress={() => { onClose(); onJoin(table); }}>
            <Text style={[rdm.joinBtnText, { color: tier.accentColor }]}>JOIN TABLE</Text>
          </Pressable>
          <Pressable style={rdm.closeBtn} onPress={onClose}>
            <Text style={rdm.closeBtnText}>CLOSE</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type DisplayRow = { t: LobbyTable; name: string; tier: Tier };

export default function LobbyScreen() {
  const tables = useLobbyStore((s) => s.tables);
  const { accounts, deauthorize } = useWallet();
  const { signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'SOLANA' | 'SEEKER' | 'PRACTICE'>('SOLANA');
  const [sortBy, setSortBy] = useState<SortKey>('BLINDS');
  const [joinableOnly, setJoinableOnly] = useState(false);
  const [pressedJoinTableId, setPressedJoinTableId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailsRow, setDetailsRow] = useState<DisplayRow | null>(null);

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
  // Stable string key so useEffect doesn't re-fire every render (rawAddress is a Uint8Array)
  const addressBase58 = rawAddress != null ? new PublicKey(rawAddress).toBase58() : null;

  const [solBalance, setSolBalance] = useState<string | null>(null);
  const [seekerBalance, setSeekerBalance] = useState<string | null>(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  useFocusEffect(useCallback(() => {
    setBalanceRefreshKey((k) => k + 1);
  }, []));

  // Table category memos — must be declared before the balance effect that references seekerTables
  const solTables = useMemo(() => tables.filter((t) => !t.isPractice && t.tokenType !== 'SEEKER'), [tables]);
  const seekerTables = useMemo(() => tables.filter((t) => !t.isPractice && t.tokenType === 'SEEKER'), [tables]);

  useEffect(() => {
    if (!addressBase58) { setSolBalance(null); setSeekerBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const connection = new Connection(clusterApiUrl(SOLANA_NETWORK), 'confirmed');
        const pubkey = new PublicKey(addressBase58);
        const lamports = await connection.getBalance(pubkey);
        if (!cancelled) setSolBalance((lamports / LAMPORTS_PER_SOL).toFixed(2) + ' SOL');

        // Fetch SEEKER SPL token balance
        try {
          const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');
          const seekerMintStr = seekerTables.length > 0
            ? await (async () => {
                const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4010'}/api/vault/${seekerTables[0].id}/address`);
                if (!res.ok) return null;
                const data = await res.json() as { seekerMint?: string };
                return data.seekerMint ?? null;
              })()
            : null;
          if (seekerMintStr && !cancelled) {
            const mintPubkey = new PublicKey(seekerMintStr);
            const ata = await getAssociatedTokenAddress(mintPubkey, pubkey);
            const account = await getAccount(connection, ata);
            const amount = Number(account.amount) / 1_000_000_000;
            if (!cancelled) setSeekerBalance(amount >= 1000 ? `${(amount / 1000).toFixed(1)}K SEEKER` : `${amount.toFixed(0)} SEEKER`);
          }
        } catch {
          if (!cancelled) setSeekerBalance('0 SEEKER');
        }
      } catch {
        if (cancelled) return;
        setSolBalance(null);
        setSeekerBalance(null);
        deauthorize().catch(() => {});
        signOut().catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [addressBase58, deauthorize, signOut, seekerTables, balanceRefreshKey]);

  const tableNames = useMemo(() => {
    const counts: Record<string, number> = {};
    return solTables.map((t) => {
      const tier = getTier(t.bigBlind);
      const key  = tier.label;
      const names = TIER_NAMES[key] ?? TIER_NAMES.LOW;
      const idx  = counts[key] ?? 0;
      counts[key] = idx + 1;
      return names[idx % names.length];
    });
  }, [solTables]);

  const handleJoin = useCallback(async (tableId: string) => {
    SocketService.leaveLobby();
    await showTransition();
    router.push(`/table/${tableId}`);
  }, [showTransition, router]);

  /** Navigate to settings so the user can connect their wallet. */
  const promptConnectWallet = useCallback(() => {
    // router.navigate works correctly for tab-to-tab navigation on repeated calls
    router.navigate({ pathname: '/(tabs)/settings', params: { connectWallet: '1' } });
  }, [router]);

  /** Join a table directly — no modal. Redirects to settings if wallet not connected (SOL only). */
  const handleJoinPress = useCallback((t: LobbyTable) => {
    // Practice tables don't require a wallet
    if (t.isPractice) {
      handleJoin(t.id);
      return;
    }
    // Read via ref so this callback never goes stale between re-renders
    if (!isWalletConnectedRef.current) {
      promptConnectWallet();
      return;
    }
    handleJoin(t.id);
  }, [promptConnectWallet, handleJoin]);

  const handleQuickJoin = useCallback(() => {
    if (!isWalletConnectedRef.current) { promptConnectWallet(); return; }
    if (!solTables.length) return;
    const joinable = solTables.filter((t) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));
    if (!joinable.length) return;
    const best = joinable.sort((a, b) => {
      const aScore = a.playerCount * 10 - a.bigBlind;
      const bScore = b.playerCount * 10 - b.bigBlind;
      return bScore - aScore;
    })[0];
    handleJoin(best.id);
  }, [isWalletConnected, promptConnectWallet, solTables, handleJoin]);

  const handleQuickJoinSeeker = useCallback(() => {
    if (!isWalletConnectedRef.current) { promptConnectWallet(); return; }
    if (!seekerTables.length) return;
    const joinable = seekerTables.filter((t) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));
    if (!joinable.length) return;
    const best = joinable.sort((a, b) => {
      const aScore = a.playerCount * 10 - a.bigBlind;
      const bScore = b.playerCount * 10 - b.bigBlind;
      return bScore - aScore;
    })[0];
    handleJoin(best.id);
  }, [isWalletConnected, promptConnectWallet, seekerTables, handleJoin]);

  const handleCreate = async () => {
    const sb = parseInt(smallBlind, 10) || 10;
    const bb = parseInt(bigBlind, 10) || 20;
    const min = parseInt(minBuyIn, 10) || 200;
    const max = parseInt(maxBuyIn, 10) || 2000;
    const tableId = await SocketService.createTable({ name: `TABLE_${Date.now().toString(36).toUpperCase()}`, smallBlind: sb, bigBlind: bb, minBuyIn: min, maxBuyIn: max });
    if (!tableId) return;
    const err = await SocketService.joinTable(tableId, min, getPlayerName());
    if (err) { console.warn('[lobby] joinTable after create error:', err); return; }
    SocketService.leaveLobby();
    router.push(`/table/${tableId}`);
  };

  // Sort + filter
  const displayTables = useMemo<DisplayRow[]>(() => {
    if (activeTab === 'PRACTICE') {
      return tables
        .filter((t) => t.isPractice)
        .map((t) => ({
          t,
          name: getPracticeName(t.id),
          tier: getPracticeTier(t.id),
        }));
    }

    if (activeTab === 'SEEKER') {
      const seekerNames = computeSeekerNames(seekerTables);
      let list = seekerTables
        .map((t, i) => ({ t, name: seekerNames[i], tier: getSeekerTier(t.bigBlind) }));

      if (joinableOnly) list = list.filter(({ t }) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));

      if (sortBy === 'BLINDS')  list.sort((a, b) => a.t.bigBlind - b.t.bigBlind || a.t.id.localeCompare(b.t.id));
      if (sortBy === 'PLAYERS') list.sort((a, b) => b.t.playerCount - a.t.playerCount || a.t.id.localeCompare(b.t.id));
      if (sortBy === 'BUY-IN')  list.sort((a, b) => a.t.minBuyIn - b.t.minBuyIn || a.t.id.localeCompare(b.t.id));

      return list;
    }

    let list = solTables
      .map((t, i) => ({ t, name: tableNames[i] ?? 'TABLE', tier: getTier(t.bigBlind) }));

    if (joinableOnly) list = list.filter(({ t }) => t.playerCount < (t.maxPlayers ?? MAX_PLAYERS));

    if (sortBy === 'BLINDS')  list.sort((a, b) => a.t.bigBlind - b.t.bigBlind || a.t.id.localeCompare(b.t.id));
    if (sortBy === 'PLAYERS') list.sort((a, b) => b.t.playerCount - a.t.playerCount || a.t.id.localeCompare(b.t.id));
    if (sortBy === 'BUY-IN')  list.sort((a, b) => a.t.minBuyIn - b.t.minBuyIn || a.t.id.localeCompare(b.t.id));

    // Search filter — matches room ID or display name (case insensitive)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(({ t, name: n }) =>
        t.id.toLowerCase().includes(q) || n.toLowerCase().includes(q),
      );
    }

    return list;
  }, [tables, solTables, seekerTables, tableNames, sortBy, joinableOnly, activeTab, searchQuery]);

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
      onShowDetails={() => setDetailsRow(item)}
      index={index}
      scrollY={scrollY}
    />
  ), [tables, pressedJoinTableId, handleJoinPress, scrollY]);

  const keyExtractor = useCallback((item: DisplayRow) => item.t.id, []);

  const ItemSeparator = useCallback(() => <View style={{ height: CARD_GAP }} />, []);

  const EmptyComponent = useCallback(() => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{searchQuery.trim() ? 'NO ROOMS FOUND' : 'NO TABLES'}</Text>
      <Text style={styles.emptyStateText}>
        {searchQuery.trim()
          ? `No rooms matching "${searchQuery.trim()}".\nTry a different Room ID.`
          : activeTab === 'PRACTICE'
          ? 'Practice tables are loading…'
          : activeTab === 'SEEKER'
          ? (joinableOnly ? 'No joinable SEEKER tables.\nTry turning off the filter.' : 'No SEEKER tables available.')
          : (joinableOnly ? 'No joinable tables found.\nTry turning off the filter.' : 'No tables available right now.')}
      </Text>
    </View>
  ), [activeTab, joinableOnly, searchQuery]);

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
              <View style={[styles.walletDot, { backgroundColor: activeTab === 'SEEKER' ? '#B388FF' : '#22c55e' }]} />
              <Text style={[styles.walletStatusText, { color: activeTab === 'SEEKER' ? '#B388FF' : '#22c55e' }]}>
                {activeTab === 'SEEKER' ? (seekerBalance ?? '…') : (solBalance ?? '…')}
              </Text>
            </View>
          ) : (
            <Pressable onPress={promptConnectWallet} style={[styles.walletBadge, styles.walletBadgeDisconnected, { flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }]}>
              <View style={[styles.walletDot, { backgroundColor: '#FF3B3B', marginBottom: 4 }]} />
              <Text style={[styles.walletStatusText, { color: '#FF6B6B' }]}>NOT{'\n'}CONNECTED</Text>
            </Pressable>
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
        {activeTab === 'SEEKER' && (
          <Pressable
            style={({ pressed }) => [styles.quickJoinBtn, styles.quickJoinBtnSeeker, pressed && styles.quickJoinBtnPressed]}
            onPress={handleQuickJoinSeeker}>
            <View style={styles.quickJoinLeft}>
              <Text style={[styles.quickJoinLabel, { color: '#BF5FFF' }]}>QUICK JOIN</Text>
              <Text style={styles.quickJoinSub}>Best available table</Text>
            </View>
            <Text style={[styles.quickJoinArrow, { color: '#BF5FFF' }]}>{'>'}</Text>
          </Pressable>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, activeTab === 'SOLANA' && styles.tabActive]} onPress={() => setActiveTab('SOLANA')}>
            <Text style={[styles.tabText, activeTab === 'SOLANA' && styles.tabTextActive]}>SOLANA</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === 'SEEKER' && styles.tabActiveSeeker]} onPress={() => setActiveTab('SEEKER')}>
            <Text style={[styles.tabText, activeTab === 'SEEKER' && styles.tabTextActiveSeeker]}>SEEKER</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === 'PRACTICE' && styles.tabActivePractice]} onPress={() => setActiveTab('PRACTICE')}>
            <Text style={[styles.tabText, activeTab === 'PRACTICE' && styles.tabTextActivePractice]}>PRACTICE</Text>
          </Pressable>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>{'>'}</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Room ID or name…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} style={styles.searchClear}>
              <Text style={styles.searchClearText}>X</Text>
            </Pressable>
          )}
        </View>

        {/* Sort / filter bar — only for SOLANA */}
        {(activeTab === 'SOLANA' || activeTab === 'SEEKER') && (
          <FilterBar
            sort={sortBy}
            onSort={setSortBy}
            joinableOnly={joinableOnly}
            onToggleJoinable={() => setJoinableOnly((v) => !v)}
            totalCount={activeTab === 'SEEKER' ? seekerTables.length : solTables.length}
            shownCount={displayTables.length}
          />
        )}

        {/* Table list (both Solana and Practice use the same card component) */}
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

        {/* Room details modal */}
        <RoomDetailsModal
          visible={!!detailsRow}
          table={detailsRow?.t ?? null}
          name={detailsRow?.name ?? ''}
          tier={detailsRow?.tier ?? { label: 'LOW', accentColor: '#00FFFF', borderColor: 'rgba(0,255,255,0.55)', shadowColor: '#00FFFF', isVip: false }}
          onClose={() => setDetailsRow(null)}
          onJoin={handleJoinPress}
        />

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
  quickJoinBtnSeeker: { borderColor: '#BF5FFF', ...Platform.select({ ios: { shadowColor: '#BF5FFF' }, default: {} }) },
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
  tabActiveSeeker: { backgroundColor: '#BF5FFF', borderColor: '#9B30FF' },
  tabText: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: gold },
  tabTextActive: { color: '#1a0a2e' },
  tabTextActivePractice: { color: '#1a0a2e' },
  tabTextActiveSeeker: { color: '#1a0a2e' },

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
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between',
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
  cardRight: { alignItems: 'center', gap: 8, marginLeft: 10 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 },
  tableNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, flexWrap: 'nowrap' },
  tableName: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 14 : 12, color: gold, letterSpacing: 0.5, flexShrink: 1, minWidth: 0 },
  copyIdBtn: { padding: 4, marginBottom: 8},
  tierBadge: { borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  tierBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, letterSpacing: 0.5 },
  tableBadge: { borderWidth: 1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  tableBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, letterSpacing: 0.3 },
  tableDetail: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.9)' },
  tableDetailLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: '#00FFFF', marginBottom: 2 },
  tableDetailNum: { fontSize: 8, color: 'rgba(255,255,255,0.9)' },
  tableDetailHot: { color: '#FF9A6C' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 7 , marginBottom: 2},
  statusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 5},
  tapHint: { fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  expandedBlock: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 5 },
  expandedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expandedLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: '#00FFFF' },
  expandedValue: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.95)' },
  detailsBtn: {
    paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', backgroundColor: 'rgba(255,215,0,0.08)',
  },
  detailsBtnRow: {
    width: '100%', alignItems: 'flex-end', marginTop: 4,
  },
  detailsBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: gold, letterSpacing: 0.5 },

  // Search bar
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: panelBg, borderRadius: 12, borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.35)', paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 10, gap: 8,
  },
  searchIcon: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: gold, opacity: 0.6 },
  searchInput: { flex: 1, fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: '#fff', paddingVertical: 4 },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  searchClearText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)' },

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

// ─── Room details modal styles ───────────────────────────────────────────────

const rdm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: {
    width: '100%', maxWidth: 360,
    backgroundColor: 'rgba(26,10,46,0.98)', borderRadius: 20, borderWidth: 2, padding: 24, gap: 12,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.7, shadowRadius: 24 }, android: { elevation: 24 }, default: {} }),
  },
  title: { fontFamily: 'PressStart2P_400Regular', fontSize: 13, textAlign: 'center', letterSpacing: 1 },
  tierTag: { alignSelf: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 14 },
  tierTagText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, letterSpacing: 1 },
  idRow: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  idValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  idValue: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: gold, letterSpacing: 0.5 },
  copyBadge: {
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', borderRadius: 6,
    paddingVertical: 3, paddingHorizontal: 8, backgroundColor: 'rgba(255,215,0,0.08)',
  },
  copyBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: gold },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  label: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.45)', letterSpacing: 1 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  value: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.9)' },
  joinBtn: {
    paddingVertical: 14, borderRadius: 14, borderWidth: 2, alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.08)',
    ...Platform.select({ ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10 }, android: { elevation: 6 }, default: {} }),
  },
  joinBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, letterSpacing: 1 },
  closeBtn: { alignItems: 'center', paddingVertical: 6 },
  closeBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.4)' },
});
