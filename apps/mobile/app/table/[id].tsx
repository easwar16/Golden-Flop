/**
 * Table screen – server-authoritative poker room.
 *
 * Architecture rules:
 *  - Zero game logic here. All state comes from server via Zustand GameStore.
 *  - Seat joining emits sit_at_seat and waits for server ACK + table_state.
 *  - Action buttons are disabled unless isMyTurn === true.
 *  - React.memo on every sub-component to prevent unnecessary re-renders.
 */

import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTransition } from '@/contexts/transition-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  ImageBackground,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PokerCard } from '@/components/poker/poker-card';
import PixelAvatar from '@/components/PixelAvatar';
import DealingCards from '@/components/animations/DealingCards';
import type { CardValue } from '@/constants/poker';
import { SocketService } from '@/services/SocketService';
import { useAuth } from '@/contexts/auth-context';
import { useWallet } from '@/contexts/wallet-context';
import { buildVaultBuyInTransaction, notifyDeposit } from '@/services/DepositService';
import { PublicKey } from '@solana/web3.js';
import { useGameStore } from '@/stores/useGameStore';
import { useLobbyStore } from '@/stores/useLobbyStore';
import { useUserStore } from '@/stores/useUserStore';
import { usePokerActions } from '@/hooks/usePokerActions';
import { useTurnTimer } from '@/hooks/useTurnTimer';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const gold = '#FFD700';

function formatChips(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}◎`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// Seat positions are computed dynamically in the component from screen dimensions.

// ─────────────────────────────────────────────────────────────────────────────
// Pulsing glow behind the active player's avatar (replaces border ring)
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveGlowProps { progress: number; size?: number; }

const ActiveGlow = memo(function ActiveGlow({ progress, size = 64 }: ActiveGlowProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  // Continuously breathe in/out while active
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0,  duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Colour shifts green → yellow → red as time runs out
  const isUrgent = progress < 0.3;
  const glowColor = isUrgent ? 'rgba(255,60,60,0.55)' : progress < 0.6 ? 'rgba(255,210,0,0.50)' : 'rgba(0,255,136,0.45)';

  const glowSize = size + 20;
  // Outer View fills the parent exactly and flex-centers the glow,
  // so scale transforms always expand from the true avatar center.
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={{
          width: glowSize, height: glowSize,
          borderRadius: glowSize / 2,
          backgroundColor: glowColor,
          transform: [{ scale: pulse }],
        }}
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Single seat (occupied or empty)
// ─────────────────────────────────────────────────────────────────────────────

interface SeatSlotProps {
  seatIndex: number;
  isMine: boolean;
  isActive: boolean;
  timerProgress: number;
  canJoin: boolean;
  isTaken: boolean; // seat is occupied but we don't have full data yet
  onJoin: (seatIndex: number) => void;
}

const SeatSlot = memo(function SeatSlot({
  seatIndex,
  isMine,
  isActive,
  timerProgress,
  canJoin,
  isTaken,
  onJoin,
}: SeatSlotProps) {
  // Read only this seat from the store to prevent re-renders when other seats change
  const seat = useGameStore((s) => s.seats[seatIndex]);
  const myAvatarSeed = useUserStore((s) => s.avatarSeed);
  const myUsername = useUserStore((s) => s.username);

  // Own seat → always show profile avatar + username; others → use server data
  const seed = isMine ? myAvatarSeed : (seat?.avatarSeed ?? seat?.playerId ?? myAvatarSeed);
  const displayName = isMine ? myUsername : (seat?.name ?? '');

  return (
    <Pressable
      onPress={canJoin ? () => onJoin(seatIndex) : undefined}
      style={({ pressed }) => [
        slotStyles.wrap,
        isMine && slotStyles.mine,
        isActive && slotStyles.active,
        seat?.isFolded && slotStyles.folded,
        pressed && canJoin && slotStyles.pressed,
        !seat && isTaken && slotStyles.takenWrap,
      ]}>

      {/* Pulsing glow behind active player's avatar */}
      {isActive && <ActiveGlow progress={timerProgress} size={64} />}

      {/* Avatar */}
      {seat ? (
        <PixelAvatar seed={seed} size={56} borderRadius={25} />
      ) : (
        <Image
          source={require('@/assets/images/avatar-placeholder.png')}
          style={[slotStyles.placeholderImg, isTaken && slotStyles.placeholderTaken]}
          resizeMode="cover"
        />
      )}

      {/* Dealer chip */}
      {seat?.isDealer && (
        <View style={slotStyles.dealerBadge}>
          <Text style={slotStyles.dealerText}>D</Text>
        </View>
      )}

      {/* + join badge on empty seats only */}
      {!seat && canJoin && !isTaken && (
        <View style={slotStyles.joinBadge}>
          <Text style={slotStyles.joinBadgeText}>+</Text>
        </View>
      )}

      {/* Taken indicator when seat is occupied but no seat data yet */}
      {!seat && isTaken && (
        <View style={slotStyles.takenBadge}>
          <Text style={slotStyles.takenBadgeText}>•</Text>
        </View>
      )}

      {/* Player info strip below avatar */}
      {seat && (
        <View style={slotStyles.info}>
          <Text style={slotStyles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={slotStyles.chips}>{formatChips(seat.chips)}</Text>
          {seat.isAllIn && <Text style={slotStyles.allIn}>ALL IN</Text>}
          {seat.isFolded && <Text style={slotStyles.foldedLabel}>FOLD</Text>}
        </View>
      )}
    </Pressable>
  );
});

const slotStyles = StyleSheet.create({
  wrap: {
    width: 64, height: 64,
    borderRadius: 32,
    overflow: 'visible',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mine: {
    borderColor: gold, borderWidth: 2,
    ...Platform.select({
      ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8 },
      android: { elevation: 8 }, default: {},
    }),
  },
  active: {
    // Border removed — TimerRing renders its own ring; keeping only the glow
    ...Platform.select({
      ios: { shadowColor: '#00FF88', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10 },
      android: { elevation: 10 }, default: {},
    }),
  },
  folded: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  placeholderImg: { width: 56, height: 56, borderRadius: 28, marginBottom: 0 },
  placeholderTaken: { opacity: 0.5 },
  takenWrap: { opacity: 0.7 },
  takenBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(180,0,0,0.85)',
    borderWidth: 1, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  takenBadgeText: { fontSize: 10, color: '#fff', lineHeight: 12 },
  dealerBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: gold, alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  dealerText: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: '#1a0a2e' },
  joinBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(81,46,123,0.9)',
    borderWidth: 1.5, borderColor: gold,
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  joinBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 12, color: gold, lineHeight: 14 },
  info: {
    position: 'absolute', bottom: -42,
    left: -12, right: -12, alignItems: 'center', gap: 2,
  },
  name: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: '#FFF8E8',
    marginTop: 0,
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    maxWidth: 96, textAlign: 'center',
  },
  chips: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: '#00FFAA',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  allIn: { fontFamily: 'PressStart2P_400Regular', fontSize: 5, color: '#FF6B6B' },
  foldedLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 5, color: 'rgba(255,255,255,0.4)' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Themed alert modal
// ─────────────────────────────────────────────────────────────────────────────

interface GameAlertProps {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

const GameAlert = memo(function GameAlert({ visible, title, message, onClose }: GameAlertProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={gaStyles.overlay}>
        <View style={gaStyles.panel}>
          <View style={gaStyles.topBar} />
          <Text style={gaStyles.title}>{title}</Text>
          <View style={gaStyles.divider} />
          <Text style={gaStyles.message}>{message}</Text>
          <Pressable style={gaStyles.btn} onPress={onClose}>
            <Text style={gaStyles.btnText}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const gaStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '78%',
    backgroundColor: '#1A0A2E',
    borderWidth: 2,
    borderColor: '#FFD700',
    borderRadius: 16,
    alignItems: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 18 },
      android: { elevation: 20 },
    }),
  },
  topBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#FFD700',
  },
  title: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 12,
    color: '#FFD700',
    marginTop: 22,
    letterSpacing: 1,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  divider: {
    width: '80%',
    height: 1,
    backgroundColor: 'rgba(255,215,0,0.25)',
    marginVertical: 14,
  },
  message: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 7,
    color: 'rgba(255,235,180,0.9)',
    lineHeight: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 22,
  },
  btn: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,215,0,0.3)',
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.07)',
  },
  btnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 10,
    color: '#FFD700',
    letterSpacing: 2,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Buy-in modal (opens when player taps an empty seat)
// ─────────────────────────────────────────────────────────────────────────────

interface BuyInModalProps {
  visible: boolean;
  seatIndex: number;
  tableId: string;
  minBuyIn: number;
  maxBuyIn: number;
  onClose: () => void;
}

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(lamports % 1_000_000_000 === 0 ? 2 : 4);
}

const BuyInModal = memo(function BuyInModal({
  visible, seatIndex, tableId, minBuyIn, maxBuyIn, onClose,
}: BuyInModalProps) {
  const [amount, setAmount] = useState(String(minBuyIn));
  const avatarSeed = useUserStore((s) => s.avatarSeed);
  const username = useUserStore((s) => s.username);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);

  const { token, isAuthenticated } = useAuth();
  const { accounts, signAndSendTransaction } = useWallet();

  // Reset to minBuyIn whenever the modal opens for a new seat
  useEffect(() => {
    if (visible) setAmount(String(minBuyIn));
  }, [visible, minBuyIn]);

  const handleConfirm = useCallback(async () => {
    const buyIn = parseInt(amount, 10);
    if (isNaN(buyIn) || buyIn < minBuyIn) {
      setAlert({ title: 'INVALID AMOUNT', message: `Minimum buy-in is ${lamportsToSol(minBuyIn)} SOL` });
      return;
    }
    if (buyIn > maxBuyIn) {
      setAlert({ title: 'INVALID AMOUNT', message: `Maximum buy-in is ${lamportsToSol(maxBuyIn)} SOL` });
      return;
    }

    if (!accounts?.[0] || !isAuthenticated || !token) {
      setAlert({ title: 'WALLET REQUIRED', message: 'Connect your wallet first' });
      return;
    }

    setSending(true);
    try {
      const walletAddress = new PublicKey(accounts[0].address).toBase58();
      const tx = await buildVaultBuyInTransaction(walletAddress, buyIn, tableId);
      const txSignature = await signAndSendTransaction(tx);
      await notifyDeposit(token, 'SOL', txSignature, String(buyIn));
      onClose();
      const res = await SocketService.sitAtSeat(tableId, buyIn, seatIndex, avatarSeed, username);
      if ('error' in res) setAlert({ title: 'CANNOT JOIN', message: res.error });
    } catch (e) {
      setAlert({ title: 'TRANSACTION FAILED', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }, [amount, tableId, seatIndex, minBuyIn, maxBuyIn, onClose, accounts, isAuthenticated, token, signAndSendTransaction]);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={bimStyles.overlay}>
            <TouchableWithoutFeedback onPress={() => { }}>
              <View style={bimStyles.panel}>
                <Text style={bimStyles.title}>BUY IN</Text>
                <Text style={bimStyles.sub}>Seat {seatIndex + 1}</Text>
                <Text style={bimStyles.range}>
                  {lamportsToSol(minBuyIn)} – {lamportsToSol(maxBuyIn)} SOL
                </Text>
                <TextInput
                  style={bimStyles.input}
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <Pressable
                  style={({ pressed }) => [bimStyles.btn, pressed && bimStyles.btnPressed, sending && { opacity: 0.5 }]}
                  onPress={handleConfirm}
                  disabled={sending}>
                  <Text style={bimStyles.btnText}>{sending ? 'SIGNING...' : 'SIT DOWN'}</Text>
                </Pressable>
                <Pressable onPress={onClose} style={{ paddingVertical: 4 }}>
                  <Text style={bimStyles.cancel}>Cancel</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      <GameAlert
        visible={!!alert}
        title={alert?.title ?? ''}
        message={alert?.message ?? ''}
        onClose={() => setAlert(null)}
      />
    </>
  );
});

const bimStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center', alignItems: 'center',
  },
  panel: {
    backgroundColor: '#1a0a2e', borderWidth: 2, borderColor: gold,
    borderRadius: 16, padding: 24, width: 280,
    alignItems: 'center', gap: 12,
  },
  title: { fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold },
  sub: { fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: 'rgba(255,255,255,0.6)' },
  range: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,215,0,0.8)', marginBottom: 4 },
  input: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 12, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)', borderRadius: 8,
    padding: 10, width: '100%', textAlign: 'center',
  },
  btn: {
    backgroundColor: '#512E7B', borderWidth: 2, borderColor: gold,
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24,
    width: '100%', alignItems: 'center',
  },
  btnPressed: { opacity: 0.85 },
  btnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: gold },
  cancel: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Countdown overlay (WAITING → COUNTDOWN transition)
// ─────────────────────────────────────────────────────────────────────────────

interface CountdownOverlayProps { seconds: number; }

const CountdownOverlay = memo(function CountdownOverlay({ seconds }: CountdownOverlayProps) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.4, duration: 150, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [seconds]);

  return (
    <View style={cdStyles.overlay} pointerEvents="none">
      <View style={cdStyles.box}>
        <Text style={cdStyles.label}>GAME STARTING IN</Text>
        <Animated.Text style={[cdStyles.number, { transform: [{ scale }] }]}>
          {seconds}
        </Animated.Text>
      </View>
    </View>
  );
});

const cdStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    zIndex: 30, top: '30%', bottom: '30%',
  },
  box: {
    backgroundColor: 'rgba(26,10,46,0.92)',
    borderWidth: 2, borderColor: gold, borderRadius: 20,
    paddingHorizontal: 32, paddingVertical: 20,
    alignItems: 'center', gap: 12,
  },
  label: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 9,
    color: 'rgba(255,255,255,0.8)', letterSpacing: 1,
  },
  number: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 56, color: gold,
    textShadowColor: '#FFD700', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Waiting overlay (< 2 players, no countdown)
// ─────────────────────────────────────────────────────────────────────────────

interface WaitingOverlayProps { seatedCount: number; }

const WaitingOverlay = memo(function WaitingOverlay({ seatedCount }: WaitingOverlayProps) {
  return (
    <View style={woStyles.overlay} pointerEvents="none">
      <View style={woStyles.box}>
        <Text style={woStyles.title}>WAITING</Text>
        <Text style={woStyles.sub}>
          {seatedCount === 0 ? 'Tap a seat to join' : 'Need one more player…'}
        </Text>
        {seatedCount > 0 && (
          <Text style={woStyles.count}>{seatedCount} / 6 seated</Text>
        )}
      </View>
    </View>
  );
});

const woStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 20,
    justifyContent: 'center', alignItems: 'center',
    top: '35%', bottom: '35%',
  },
  box: {
    backgroundColor: 'rgba(26,10,46,0.88)',
    borderWidth: 2, borderColor: 'rgba(255,215,0,0.55)', borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 16,
    alignItems: 'center', gap: 8,
  },
  title: { fontFamily: 'PressStart2P_400Regular', fontSize: 13, color: gold, letterSpacing: 2 },
  sub: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  count: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.4)' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Chip sweep animation — coins fly from pot center to winner's seat
// ─────────────────────────────────────────────────────────────────────────────

const CHIP_COUNT = 10;

interface ChipSweepProps {
  origin: { x: number; y: number };
  target: { x: number; y: number };
  winAmount: number;
  handName: string;
  onComplete: () => void;
}

const ChipSweep = memo(function ChipSweep({ origin, target, winAmount, handName, onComplete }: ChipSweepProps) {
  const chips = useRef(
    Array.from({ length: CHIP_COUNT }, () => ({
      x: new Animated.Value(origin.x),
      y: new Animated.Value(origin.y),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0.2),
    }))
  ).current;

  const labelOpacity = useRef(new Animated.Value(0)).current;
  const labelScale = useRef(new Animated.Value(0.6)).current;
  const handNameOpacity = useRef(new Animated.Value(0)).current;
  const handNameScale = useRef(new Animated.Value(0.4)).current;
  const handNameY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const chipAnims = chips.map((chip, i) => {
      const tx = target.x + (Math.random() - 0.5) * 14;
      const ty = target.y + (Math.random() - 0.5) * 14;
      return Animated.sequence([
        Animated.delay(i * 55),
        Animated.parallel([
          Animated.timing(chip.x, { toValue: tx, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(chip.y, { toValue: ty, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(chip.opacity, { toValue: 1, duration: 60, useNativeDriver: true }),
            Animated.delay(340),
            Animated.timing(chip.opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(chip.scale, { toValue: 1.1, duration: 220, useNativeDriver: true }),
            Animated.timing(chip.scale, { toValue: 0.7, duration: 300, useNativeDriver: true }),
          ]),
        ]),
      ]);
    });

    const labelAnim = Animated.sequence([
      Animated.delay(180),
      Animated.parallel([
        Animated.timing(labelOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(labelScale, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
      ]),
      Animated.delay(800),
      Animated.parallel([
        Animated.timing(labelOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(labelScale, { toValue: 1.2, duration: 300, useNativeDriver: true }),
      ]),
    ]);

    const handNameAnim = Animated.sequence([
      Animated.parallel([
        Animated.timing(handNameOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(handNameScale, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
      ]),
      Animated.delay(900),
      Animated.parallel([
        Animated.timing(handNameOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(handNameY, { toValue: -18, duration: 300, useNativeDriver: true }),
      ]),
    ]);

    Animated.parallel([...chipAnims, labelAnim, handNameAnim]).start(() => onComplete());
  }, []);

  return (
    <>
      {chips.map((chip, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -10, top: -10,
            width: 20, height: 20,
            borderRadius: 10,
            backgroundColor: gold,
            borderWidth: 2,
            borderColor: '#B8860B',
            opacity: chip.opacity,
            transform: [{ translateX: chip.x }, { translateY: chip.y }, { scale: chip.scale }],
            ...Platform.select({
              ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6 },
              android: { elevation: 6 },
              default: {},
            }),
          }}
        />
      ))}
      {/* Winning hand name — bursts from pot center */}
      <Animated.Text
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: origin.x - 110,
          top: origin.y - 70,
          width: 220,
          textAlign: 'center',
          fontFamily: 'PressStart2P_400Regular',
          fontSize: 13,
          color: gold,
          opacity: handNameOpacity,
          transform: [{ scale: handNameScale }, { translateY: handNameY }],
          textShadowColor: 'rgba(0,0,0,0.9)',
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 6,
          zIndex: 55,
        }}
      >
        {handName.toUpperCase()}
      </Animated.Text>

      {/* +amount label near winner's avatar */}
      <Animated.Text
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: target.x - 55,
          top: target.y - 52,
          width: 110,
          textAlign: 'center',
          fontFamily: 'PressStart2P_400Regular',
          fontSize: 10,
          color: '#00FF88',
          opacity: labelOpacity,
          transform: [{ scale: labelScale }],
          textShadowColor: '#000',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 4,
          zIndex: 60,
        }}
      >
        +{formatChips(winAmount)}
      </Animated.Text>
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase badge (PRE-FLOP / FLOP / TURN / RIVER / SHOWDOWN)
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  preflop: 'PRE-FLOP', flop: 'FLOP', turn: 'TURN',
  river: 'RIVER', showdown: 'SHOWDOWN',
};

const PhaseBadge = memo(function PhaseBadge({ phase }: { phase: string }) {
  const label = PHASE_LABEL[phase];
  if (!label) return null;
  return (
    <View style={pbStyles.badge}>
      <Text style={pbStyles.text}>{label}</Text>
    </View>
  );
});

const pbStyles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -24, alignSelf: 'center',
    backgroundColor: 'rgba(81,46,123,0.92)',
    borderWidth: 1, borderColor: gold, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  text: { fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: gold, letterSpacing: 1 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Raise amount input
// ─────────────────────────────────────────────────────────────────────────────

interface RaiseInputProps { min: number; max: number; value: number; onChange: (v: number) => void; }

const RaiseAmountInput = memo(function RaiseAmountInput({ min, max, value, onChange }: RaiseInputProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => { setText(String(value)); }, [value]);

  const commit = useCallback(() => {
    const raw = text.replace(/\D/g, '');
    const n = parseInt(raw, 10);
    if (!isNaN(n) && raw.length > 0) {
      const clamped = Math.round(Math.max(min, Math.min(max, n)) / 100) * 100;
      onChange(clamped);
      setText(String(clamped));
    } else {
      setText(String(value));
    }
  }, [text, value, min, max, onChange]);

  const current = (() => {
    const raw = text.replace(/\D/g, '');
    const n = parseInt(raw, 10);
    return !isNaN(n) && raw.length > 0 ? n : value;
  })();

  const dec = useCallback(() => {
    const step = Math.max(100, Math.round(current * 0.10));
    const next = Math.round(Math.max(min, current - step) / 100) * 100;
    onChange(next); setText(String(next));
  }, [current, min, onChange]);

  const inc = useCallback(() => {
    const step = Math.max(100, Math.round(current * 0.10));
    const next = Math.round(Math.min(max, current + step) / 100) * 100;
    onChange(next); setText(String(next));
  }, [current, max, onChange]);

  return (
    <View style={riStyles.wrap}>
      <ImageBackground
        source={require('@/assets/images/raise-input-bg.png')}
        style={riStyles.bg} resizeMode="stretch">
        <Pressable style={({ pressed }) => [riStyles.btn, pressed && riStyles.btnP]} onPress={dec} hitSlop={8}>
          <Image source={require('@/assets/images/btn-minus.png')} style={riStyles.icon} resizeMode="contain" />
        </Pressable>
        <TextInput
          style={riStyles.input}
          value={text}
          onChangeText={(t) => setText(t.replace(/\D/g, ''))}
          onBlur={commit} onSubmitEditing={commit}
          keyboardType="number-pad" selectTextOnFocus showSoftInputOnFocus
        />
        <Pressable style={({ pressed }) => [riStyles.btn, pressed && riStyles.btnP]} onPress={inc} hitSlop={8}>
          <Image source={require('@/assets/images/btn-plus.png')} style={riStyles.icon} resizeMode="contain" />
        </Pressable>
      </ImageBackground>
    </View>
  );
});

const riStyles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  bg: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    height: 80, marginHorizontal: 50, paddingHorizontal: 20,
    overflow: 'hidden', marginVertical: -15,
  },
  input: {
    flex: 1, fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 11 : 10, color: '#E8E4C8',
    textAlign: 'center', paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btnP: { opacity: 0.7 },
  icon: { width: 35, height: 35 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Dust particles (ambient atmosphere)
// ─────────────────────────────────────────────────────────────────────────────

const PARTICLES = [
  { x: 0.08, s: 3, o: 0.35, d: 11000 }, { x: 0.19, s: 2, o: 0.22, d: 14500 },
  { x: 0.31, s: 3.5, o: 0.28, d: 10000 }, { x: 0.44, s: 2, o: 0.18, d: 16000 },
  { x: 0.55, s: 4, o: 0.30, d: 12500 }, { x: 0.63, s: 2.5, o: 0.20, d: 9500 },
  { x: 0.72, s: 3, o: 0.25, d: 13000 }, { x: 0.82, s: 2, o: 0.18, d: 15500 },
  { x: 0.91, s: 3.5, o: 0.32, d: 11500 }, { x: 0.25, s: 2.5, o: 0.22, d: 17000 },
  { x: 0.50, s: 3, o: 0.28, d: 10500 }, { x: 0.77, s: 2, o: 0.20, d: 13500 },
];

const DustParticles = memo(function DustParticles() {
  const anims = useRef(PARTICLES.map((_, i) => new Animated.Value(i / PARTICLES.length))).current;

  useEffect(() => {
    const loops = PARTICLES.map((p, i) => {
      const remaining = (1 - i / PARTICLES.length) * p.d;
      return Animated.sequence([
        Animated.timing(anims[i], { toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: true }),
        Animated.loop(Animated.sequence([
          Animated.timing(anims[i], { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(anims[i], { toValue: 1, duration: p.d, easing: Easing.linear, useNativeDriver: true }),
        ])),
      ]);
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {PARTICLES.map((p, i) => {
        const tY = anims[i].interpolate({ inputRange: [0, 1], outputRange: [700, -80] });
        const tX = anims[i].interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, 8, -5, 3] });
        const op = anims[i].interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, p.o, p.o, 0] });
        return (
          <Animated.View key={i} style={{
            position: 'absolute', left: `${p.x * 100}%` as any, bottom: 0,
            width: p.s, height: p.s, borderRadius: p.s / 2,
            backgroundColor: '#FFD060', opacity: op,
            transform: [{ translateY: tY }, { translateX: tX }],
          }} />
        );
      })}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Table screen
// ─────────────────────────────────────────────────────────────────────────────

export default function TableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Layout geometry — computed from actual screen size so nothing clips the top bar
  // Top bar: safe-area + 6 margin + ~52px bar = insets.top + 58
  const TABLE_TOP = insets.top + 58;
  // Bottom controls: raise input (~52) + action bar (~56) + padding (~80)
  const TABLE_BOT = 188;
  let TABLE_H = screenH - TABLE_BOT ;
  TABLE_H = TABLE_H + Math.round(TABLE_H * 0.18) ;

  // Seat positions: absolute coords inside the main container
  // 0=top-center, 1=top-left, 2=top-right, 3=bottom-left, 4=bottom-right, 5=bottom-center
  const SEAT_POSITIONS = [
    { top: TABLE_TOP + 15, left: screenW / 2 - 32 }, // 0 top-center (straddles top edge)
    { top: TABLE_TOP + Math.round(TABLE_H * 0.15), left: 4 }, // 1 top-left
    { top: TABLE_TOP + Math.round(TABLE_H * 0.15), right: 4 }, // 2 top-right
    { top: TABLE_TOP + Math.round(TABLE_H * 0.50), left: 4 }, // 3 bottom-left
    { top: TABLE_TOP + Math.round(TABLE_H * 0.50), right: 4 }, // 4 bottom-right
    { top: TABLE_TOP + Math.round(TABLE_H * 0.68), left: screenW / 2 - 32 }, // 5 bottom-center
  ];

  // Granular store subscriptions – each selector is independent
  const phase = useGameStore((s) => s.phase);
  const countdownSeconds = useGameStore((s) => s.countdownSeconds);
  const seats = useGameStore((s) => s.seats);
  const communityCards = useGameStore((s) => s.communityCards);
  const pot = useGameStore((s) => s.pot);
  const myChips = useGameStore((s) => s.myChips);
  const currentBet = useGameStore((s) => s.currentBet);
  const isMyTurn = useGameStore((s) => s.isMyTurn);
  const mySeatIndex = useGameStore((s) => s.mySeatIndex);
  const activePlayerSeatIndex = useGameStore((s) => s.activePlayerSeatIndex);
  const tablMinBuyIn = useGameStore((s) => s.minBuyIn);
  const tablMaxBuyIn = useGameStore((s) => s.maxBuyIn);
  const raiseAmount = useGameStore((s) => s.raiseAmount);
  const setRaiseAmount = useGameStore((s) => s.setRaiseAmount);
  const myHand = useGameStore((s) => s.myHand);
  const lastHandResult = useGameStore((s) => s.lastHandResult);
  const dismissHandResult = useGameStore((s) => s.dismissHandResult);

  // Must be before any early return (Rules of Hooks)
  const lobbyTables = useLobbyStore((s) => s.tables);

  const { fold, call, raise, minRaise, maxRaise } = usePokerActions();
  const { secondsLeft, progress } = useTurnTimer(useGameStore((s) => s.turnTimeoutAt));

  const { hideTransition } = useTransition();
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const [buyInModal, setBuyInModal] = useState<{ visible: boolean; seatIndex: number }>({
    visible: false, seatIndex: 0,
  });
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);

  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
      hideTransition();
    }
  }, [fontsLoaded, fontError, hideTransition]);

  // Haptic pulse on turn start
  useEffect(() => {
    if (isMyTurn) {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch (_) { }
    }
  }, [isMyTurn]);

  // Always leave the room when this screen unmounts — covers both the Leave
  // button press and swiping back without pressing Leave.
  useEffect(() => {
    return () => {
      if (id) SocketService.leaveTable(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request a public table snapshot so spectators can see seated players
  useEffect(() => {
    if (id) SocketService.watchTable(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmLeave = useCallback(() => {
    router.back(); // unmount triggers leaveTable via the cleanup useEffect above
  }, [router]);

  const handleLeave = useCallback(() => {
    setLeaveConfirmVisible(true);
  }, []);

  // Intercept Android hardware back button — show confirmation instead of leaving instantly
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setLeaveConfirmVisible(true);
      return true; // prevent default back behaviour
    });
    return () => sub.remove();
  }, []);

  const handleSeatPress = useCallback((seatIndex: number) => {
    setBuyInModal({ visible: true, seatIndex });
  }, []);

  const closeBuyIn = useCallback(() => {
    setBuyInModal((p) => ({ ...p, visible: false }));
  }, []);

  const handleAction = useCallback((action: 'fold' | 'call' | 'raise') => {
    if (!isMyTurn) return;
    if (action === 'fold') fold();
    else if (action === 'call') call();
    else raise(raiseAmount);
  }, [isMyTurn, fold, call, raise, raiseAmount]);

  // ── Loading gate ───────────────────────────────────────────────────────────
  // Only block rendering until fonts are loaded. The table renders immediately
  // and seats update live as table_state events arrive from the server.
  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.container}>
        <ImageBackground source={require('@/assets/images/table-room-bg.png')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </View>
    );
  }

  // ── Lobby data — used to show occupied seats before we have full table_state ─
  const lobbyTable = lobbyTables.find((t) => t.id === id);
  const lobbyOccupiedSeats: number[] = lobbyTable?.occupiedSeats ?? [];

  // ── Derived values ─────────────────────────────────────────────────────────
  const roomId = (id?.length ?? 0) > 8 ? `${id!.slice(0, 6)}…${id!.slice(-2)}` : (id ?? '—');
  const seatedCount = seats.filter(Boolean).length;
  const isInHand = phase !== 'waiting' && phase !== 'countdown';

  // ── Animation layout coords (absolute screen coords) ──────────────────────
  // The tableArea has `top: TABLE_TOP` + `marginTop: -90`, so visual top = TABLE_TOP - 90
  const tableVisualTop = TABLE_TOP - 90;
  // Community cards are at 42% down the table + half card height (31) to reach center
  const deckOrigin = {
    x: screenW / 2,
    y: tableVisualTop + TABLE_H * 0.42 + 31,
  };

  // Compute center of any seat given its SEAT_POSITIONS entry
  const getSeatCenter = (idx: number) => {
    const pos = SEAT_POSITIONS[idx] as { top: number; left?: number; right?: number };
    const cx = pos.left !== undefined ? pos.left + 32 : screenW - (pos.right ?? 0) - 32;
    return { x: cx, y: pos.top + 32 };
  };

  // A seat is joinable only when: empty, game not in progress, and we're not already seated
  const canJoinAnySeat = !isInHand && mySeatIndex === null;

  return (
    <View style={styles.container} onLayout={onLayoutRoot}>
      {/* Disable swipe-back on iOS and hide the native header */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <ImageBackground source={require('@/assets/images/table-room-bg.png')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <DustParticles />

      {/* Dealing animation — 2 cards fly from deck to local player's seat */}
      {mySeatIndex !== null && (
        <DealingCards
          deckOrigin={deckOrigin}
          mySeatCenter={getSeatCenter(mySeatIndex)}
        />
      )}

      {/* Buy-in modal */}
      {id && (
        <BuyInModal
          visible={buyInModal.visible}
          seatIndex={buyInModal.seatIndex}
          tableId={id}
          minBuyIn={tablMinBuyIn || 10_000_000}
          maxBuyIn={tablMaxBuyIn || 100_000_000}
          onClose={closeBuyIn}
        />
      )}

      {/* Chip sweep — coins fly from pot to winner's seat on hand end */}
      {lastHandResult && lastHandResult.winners.map((w) => (
        <ChipSweep
          key={`${lastHandResult.handId}-${w.playerId}`}
          origin={deckOrigin}
          target={getSeatCenter(w.seatIndex)}
          winAmount={w.winAmount}
          handName={w.bestHandName}
          onComplete={dismissHandResult}
        />
      ))}

      {/* Countdown overlay */}
      {phase === 'countdown' && <CountdownOverlay seconds={countdownSeconds} />}

      {/* Waiting overlay */}
      {phase === 'waiting' && seatedCount < 2 && <WaitingOverlay seatedCount={seatedCount} />}

      {/* Table image — positioned between top bar and bottom controls */}
      <View style={[styles.tableArea, { marginTop:-90,top: TABLE_TOP, height: TABLE_H }]}>
        <Image source={require('@/assets/images/table.png')} style={styles.tableImage} resizeMode="stretch" />

        {/* Community cards + phase badge + pot */}
        <View style={styles.communityOverlay}>
          <PhaseBadge phase={phase} />
          <View style={styles.communityRow}>
            {[0, 1, 2, 3, 4].map((i) => {
              const card = communityCards[i] as CardValue | null;
              const showBack = !card && isInHand;
              return (
                <View key={i} style={styles.communitySlot}>
                  {card
                    ? <PokerCard card={card} style={styles.cardSize} />
                    : showBack
                      ? <PokerCard card={null} faceDown style={styles.cardSize} />
                      : <View style={styles.emptyCard} />}
                </View>
              );
            })}
          </View>
          {pot > 0 && <Text style={styles.potLabel}>POT: {formatChips(pot)}</Text>}

          {/* Player's hole cards — shown below pot, only when in a hand */}
          {isInHand && mySeatIndex !== null && (
            <View style={styles.holeCardsRow}>
              {myHand.map((card, i) =>
                card ? (
                  <PokerCard key={i} card={card as CardValue} style={styles.holeCard} />
                ) : (
                  <PokerCard key={i} card={null} faceDown style={styles.holeCard} />
                )
              )}
            </View>
          )}
        </View>
      </View>

      {/* Keyboard dismiss layer */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[StyleSheet.absoluteFillObject, { bottom: 220, zIndex: 1 }]} collapsable={false} />
      </TouchableWithoutFeedback>

      {/* Avatar slots — no rotation, seats stay at their clicked positions. */}
      {SEAT_POSITIONS.map((pos: object, v: number) => {
        const seatOccupied = !!seats[v] || lobbyOccupiedSeats.includes(v);
        return (
          <View key={v} style={[styles.seatWrap, pos]}>
            <SeatSlot
              seatIndex={v}
              isMine={mySeatIndex === v}
              isActive={activePlayerSeatIndex === v}
              timerProgress={activePlayerSeatIndex === v ? progress : 1}
              canJoin={canJoinAnySeat && !seatOccupied}
              isTaken={!seats[v] && lobbyOccupiedSeats.includes(v)}
              onJoin={handleSeatPress}
            />
          </View>
        );
      })}

      {/* Top bar */}
      <View style={[styles.topBarWrap, { top: insets.top + 6 }]}>
        <ImageBackground source={require('@/assets/images/topbar-bg.png')} style={styles.topBar} resizeMode="stretch">
          <Image source={require('@/assets/images/coin.png')} style={styles.coinIcon} resizeMode="contain" />
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>BALANCE: </Text>
            <Text style={styles.balanceValue} numberOfLines={1}>{formatChips(myChips)}</Text>
          </View>
          <View style={styles.flex1} />
          <Text style={styles.roomChip} numberOfLines={1}>{roomId}</Text>
        </ImageBackground>
        <Pressable
          style={({ pressed }) => [styles.leaveBtn, pressed && styles.leaveBtnP]}
          onPress={handleLeave}>
          <Text style={styles.leaveText}>LEAVE</Text>
        </Pressable>
      </View>

      {/* Turn countdown — absolute, floats below the top bar on the right */}
      {isMyTurn && (
        <View style={[styles.turnTimerWrap, { top: insets.top + 66 }]}>
          <Text style={[styles.turnTimerText, secondsLeft <= 5 && styles.turnTimerUrgent]}>
            {secondsLeft}s
          </Text>
        </View>
      )}

      {/* Leave confirmation modal */}
      <Modal
        visible={leaveConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLeaveConfirmVisible(false)}>
        <View style={lcStyles.overlay}>
          <View style={lcStyles.panel}>
            <Text style={lcStyles.title}>LEAVE GAME?</Text>
            <Text style={lcStyles.sub}>You will forfeit your seat and any chips in play.</Text>
            <Pressable
              style={({ pressed }) => [lcStyles.confirmBtn, pressed && lcStyles.btnPressed]}
              onPress={confirmLeave}>
              <Text style={lcStyles.confirmText}>LEAVE</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [lcStyles.cancelBtn, pressed && lcStyles.btnPressed]}
              onPress={() => setLeaveConfirmVisible(false)}>
              <Text style={lcStyles.cancelText}>STAY</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Action bar — only when seated */}
      {mySeatIndex !== null && (
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 12 }]}>

          {/* Action buttons — only rendered when it's my turn */}
          {isMyTurn && (
            <>
              <View style={styles.raiseRow}>
                <RaiseAmountInput
                  min={minRaise}
                  max={maxRaise}
                  value={Math.max(minRaise, Math.min(maxRaise, raiseAmount))}
                  onChange={setRaiseAmount}
                />
              </View>

              <View style={styles.actionBar}>
                {/* FOLD */}
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.foldWrap, pressed && styles.actionBtnP]}
                  onPress={() => handleAction('fold')}>
                  {({ pressed }) => (
                    <ImageBackground
                      source={pressed ? require('@/assets/images/buttons/fold-btn-pressed.png') : require('@/assets/images/buttons/fold-btn.png')}
                      style={styles.btnBg} resizeMode="stretch">
                      <Text style={styles.btnText}>FOLD</Text>
                    </ImageBackground>
                  )}
                </Pressable>

                {/* CALL / CHECK */}
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.callWrap, pressed && styles.actionBtnP]}
                  onPress={() => handleAction('call')}>
                  {({ pressed }) => (
                    <ImageBackground
                      source={pressed ? require('@/assets/images/buttons/call-btn-pressed.png') : require('@/assets/images/buttons/call-btn.png')}
                      style={styles.btnBg} resizeMode="stretch">
                      <Text style={styles.btnText}>
                        {currentBet > 0 ? `CALL ${formatChips(currentBet)}` : 'CHECK'}
                      </Text>
                    </ImageBackground>
                  )}
                </Pressable>

                {/* RAISE */}
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.raiseWrap, pressed && styles.actionBtnP]}
                  onPress={() => handleAction('raise')}>
                  {({ pressed }) => (
                    <ImageBackground
                      source={pressed ? require('@/assets/images/buttons/raise-btn-pressed.png') : require('@/assets/images/buttons/raise-btn.png')}
                      style={styles.btnBg} resizeMode="stretch">
                      <Text style={styles.raiseBtnText}>RAISE</Text>
                    </ImageBackground>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: gold, fontSize: 14 },

  tableArea: { position: 'absolute', left: 0, right: 0, zIndex: 2 },
  tableImage: { width: '110%', height: '100%', marginLeft: '-5%' },

  communityOverlay: {
    position: 'absolute', top: '42%',
    left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  communityRow: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  communitySlot: { width: 46, alignItems: 'center', justifyContent: 'center' },
  cardSize: { width: 44, height: 62 },
  emptyCard: {
    width: 44, height: 62, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4 },
      android: { elevation: 4 }, default: {},
    }),
  },
  potLabel: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: gold, marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  seatWrap: { position: 'absolute', zIndex: 20 },

  // Top bar
  topBarWrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, overflow: 'hidden' },
  balanceRow: { marginStart: 6, marginTop: 5, flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  flex1: { flex: 1, minWidth: 6 },
  coinIcon: { width: 22, height: 22, marginRight: 4, marginVertical: 6, marginStart: 34 },
  balanceLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 8 : 7, color: 'rgba(255,245,220,0.8)' },
  balanceValue: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 8 : 7, color: '#FFF8E8', flex: 1 },
  roomChip: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 6,
    color: 'rgba(255,255,255,0.5)', marginEnd: 10,
  },
  timerBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.6)',
  },
  timerBadgeUrgent: { borderColor: '#FF4444', backgroundColor: 'rgba(180,0,0,0.4)' },
  timerText: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: gold },
  timerTextUrgent: { color: '#FF4444' },
  leaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(180,30,30,0.92)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FF4444',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#FF0000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 6 },
      android: { elevation: 6 },
      default: {},
    }),
  },
  leaveBtnP: { opacity: 0.8 },
  leaveText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 8 : 7,
    color: '#fff',
    letterSpacing: 0.5,
  },

  // Bottom controls
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, zIndex: 10 },
  turnTimerWrap: {
    position: 'absolute', right: 16, zIndex: 30,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10, borderWidth: 1.5, borderColor: '#00FF88',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  turnTimerText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 18, color: '#00FF88',
    textShadowColor: '#00FF88', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  turnTimerUrgent: {
    color: '#FF4444',
    textShadowColor: '#FF4444',
  },
  holeCardsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 10 },
  holeCard: { width: 52, height: 74 },
  raiseRow: { flexDirection: 'row', marginBottom: 12, paddingHorizontal: 4 },
  actionBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  actionBtn: {
    flex: 1, minHeight: 48,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 1, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 4 }, default: {},
    }),
  },
  actionBtnP: { opacity: 0.85 },
  actionBtnOff: { opacity: 0.35 },
  foldWrap: { overflow: 'hidden' },
  callWrap: { overflow: 'hidden' },
  raiseWrap: {
    overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,220,100,0.75)',
    ...Platform.select({
      ios: { shadowColor: '#FFD060', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 6 },
      android: { elevation: 8 }, default: {},
    }),
  },
  btnBg: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  btnText: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: '#fff' },
  btnTextOff: { opacity: 0.4 },
  raiseBtnText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: '#fff',
    textShadowColor: 'rgba(0,60,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
});

// Leave-confirmation modal styles
const lcStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center', alignItems: 'center',
  },
  panel: {
    backgroundColor: '#1a0a2e', borderWidth: 2, borderColor: gold,
    borderRadius: 20, padding: 28, width: 300,
    alignItems: 'center', gap: 16,
    ...Platform.select({
      ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 12 }, default: {},
    }),
  },
  title: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: gold, letterSpacing: 1,
  },
  sub: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 7,
    color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 14,
  },
  confirmBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 12,
    backgroundColor: 'rgba(198,34,34,0.9)', borderWidth: 2, borderColor: '#FF4444',
    alignItems: 'center',
  },
  cancelBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 12,
    backgroundColor: 'rgba(81,46,123,0.9)', borderWidth: 2, borderColor: gold,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.8 },
  confirmText: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: '#fff' },
  cancelText: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: gold },
});
