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
  useMemo,
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
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing as REasing,
} from 'react-native-reanimated';

import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PokerCard, type CardMagnifyInfo } from '@/components/poker/poker-card';
import { GameActionButtons } from '@/components/poker/GameActionButtons';
import { EmojiReaction } from '@/components/poker/EmojiReaction';
import { EmojiPanel } from '@/components/poker/EmojiPanel';
import PixelAvatar from '@/components/PixelAvatar';
import DealingCards from '@/components/animations/DealingCards';
import type { CardValue } from '@/constants/poker';
import { SocketService } from '@/services/SocketService';
import { useWallet } from '@/contexts/wallet-context';
import { buildVaultBuyInTransaction, buildSPLVaultBuyInTransaction } from '@/services/DepositService';
import { SOLANA_NETWORK } from '@/constants/solana';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useGameStore } from '@/stores/useGameStore';
import { useLobbyStore } from '@/stores/useLobbyStore';
import { useUserStore } from '@/stores/useUserStore';
import { usePokerActions } from '@/hooks/usePokerActions';
import { useTurnTimer } from '@/hooks/useTurnTimer';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const gold = '#FFD700';

function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol === 0) return '0 ◎';
  // Show up to 4 decimals, strip trailing zeros
  const str = sol.toFixed(4).replace(/\.?0+$/, '');
  return `${str} ◎`;
}

function formatChips(chips: number): string {
  if (chips >= 1_000_000) return `${(chips / 1_000_000).toFixed(1)}M`;
  if (chips >= 1_000) return `${Math.round(chips).toLocaleString()}`;
  return `${Math.round(chips)}`;
}

function formatSeekerValue(amount: number): string {
  if (amount === 0) return '0 SK';
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M SK`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K SK`;
  return `${amount} SK`;
}

/** Returns the right formatter based on whether the table uses practice chips, SEEKER, or SOL. */
function getFormatter(isPractice: boolean, isSeeker: boolean = false): (value: number) => string {
  if (isPractice) return formatChips;
  if (isSeeker) return formatSeekerValue;
  return formatSol;
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
  reservation?: { seatIndex: number; playerId: string; playerName: string; avatarSeed: string };
  onJoin: (seatIndex: number) => void;
  formatValue: (v: number) => string;
}

const SeatSlot = memo(function SeatSlot({
  seatIndex,
  isMine,
  isActive,
  timerProgress,
  canJoin,
  isTaken,
  reservation,
  onJoin,
  formatValue,
}: SeatSlotProps) {
  // Read only this seat from the store to prevent re-renders when other seats change
  const seat = useGameStore((s) => s.seats[seatIndex]);
  const emojiReaction = useGameStore((s) => s.emojiReactions[seatIndex]);
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

      {/* Avatar (dimmed if sitting out or disconnected) */}
      {seat ? (
        <View style={seat.isSittingOut ? { opacity: 0.4 } : undefined}>
          <PixelAvatar seed={seed} size={56} borderRadius={25} />
        </View>
      ) : reservation ? (
        <View style={{ opacity: 0.45 }}>
          <PixelAvatar seed={reservation.avatarSeed} size={56} borderRadius={25} />
        </View>
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

      {/* Emoji reaction */}
      {emojiReaction && (
        <EmojiReaction emoji={emojiReaction.emoji} id={emojiReaction.id} />
      )}

      {/* + join badge on empty seats only */}
      {!seat && canJoin && !isTaken && (
        <View style={slotStyles.joinBadge}>
          <Text style={slotStyles.joinBadgeText}>+</Text>
        </View>
      )}

      {/* Reserved indicator — avatar shown at reduced opacity with "..." */}
      {!seat && reservation && (
        <View style={slotStyles.takenBadge}>
          <Text style={slotStyles.takenBadgeText}>...</Text>
        </View>
      )}

      {/* Taken indicator when seat is occupied but no seat data yet */}
      {!seat && isTaken && !reservation && (
        <View style={slotStyles.takenBadge}>
          <Text style={slotStyles.takenBadgeText}>•</Text>
        </View>
      )}

      {/* Player info strip below avatar */}
      {seat ? (
        <View style={[
          slotStyles.info,
          seatIndex === 1 || seatIndex === 3 ? slotStyles.infoLeft : undefined,
          seatIndex === 2 || seatIndex === 4 ? slotStyles.infoRight : undefined,
        ]}>
          <View style={slotStyles.infoPill}>
            <Text style={slotStyles.name} numberOfLines={1}>{displayName}</Text>
            <Text style={slotStyles.chips} numberOfLines={1}>{formatValue(seat.chips)}</Text>
            {seat.isAllIn && <Text style={slotStyles.allIn}>ALL IN</Text>}
            {seat.isFolded && <Text style={slotStyles.foldedLabel}>FOLD</Text>}
            {seat.isSittingOut && !seat.isFolded && <Text style={slotStyles.sitOutLabel}>SIT OUT</Text>}
          </View>
          {seat.currentBet > 0 && !seat.isFolded && (
            <Text style={slotStyles.betLabel}>{seat.isAllIn ? 'ALL IN' : formatValue(seat.currentBet)}</Text>
          )}
        </View>
      ) : reservation ? (
        <View style={[
          slotStyles.info,
          seatIndex === 1 || seatIndex === 3 ? slotStyles.infoLeft : undefined,
          seatIndex === 2 || seatIndex === 4 ? slotStyles.infoRight : undefined,
        ]}>
          <View style={slotStyles.infoPill}>
            <Text style={[slotStyles.name, { opacity: 0.5 }]} numberOfLines={1}>{reservation.playerName}</Text>
          </View>
        </View>
      ) : null}
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
    position: 'absolute', top: -5, right: -5,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1a0a2e', borderWidth: 2, borderColor: '#FFD700',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4, elevation: 6,
  },
  dealerText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: '#FFD700' },
  joinBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(81,46,123,0.9)',
    borderWidth: 1.5, borderColor: gold,
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  joinBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 12, color: gold, lineHeight: 14 },
  info: {
    position: 'absolute', bottom: -46,
    left: -24, right: -24,
    alignItems: 'center', gap: 2,
  },
  infoPill: {
    backgroundColor: 'rgba(10,4,20,0.75)',
    borderRadius: 8,
    paddingVertical: 3, paddingHorizontal: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', gap: 1,
  },
  infoLeft: {
    left: -30, right: -30, alignItems: 'center',
  },
  infoRight: {
    left: -30, right: -30, alignItems: 'center',
  },
  name: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: '#FFF8E8',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    textAlign: 'center',
  },
  chips: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: '#00FF88',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    textAlign: 'center',
  },
  allIn: { fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: '#FF6B6B' },
  foldedLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 5, color: 'rgba(255,255,255,0.4)' },
  sitOutLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 5, color: '#FF9944' },
  betLabel: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: '#FFE066',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    textAlign: 'center',
  },
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
  isPractice?: boolean;
  tokenType?: 'SOL' | 'SEEKER';
  tableId: string;
  minBuyIn: number;
  maxBuyIn: number;
  onClose: () => void;
}

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(lamports % 1_000_000_000 === 0 ? 2 : 4);
}

const BuyInModal = memo(function BuyInModal({
  visible, seatIndex, tableId, minBuyIn, maxBuyIn, onClose, isPractice, tokenType,
}: BuyInModalProps) {
  const isSeeker = tokenType === 'SEEKER';
  // Input is in SOL (e.g. "0.05") or SEEKER units, converted to smallest unit on confirm
  const [amount, setAmount] = useState(isPractice || isSeeker ? String(minBuyIn) : lamportsToSol(minBuyIn));
  const avatarSeed = useUserStore((s) => s.avatarSeed);
  const username = useUserStore((s) => s.username);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  /** Tracks whether a reservation is active — release on modal close unless consumed */
  const hasReservationRef = useRef(false);

  const { accounts, signAndSendTransaction, deauthorize } = useWallet();

  // Reset to min whenever the modal opens for a new seat
  useEffect(() => {
    if (visible) {
      setAmount(isPractice || isSeeker ? String(minBuyIn) : lamportsToSol(minBuyIn));
      hasReservationRef.current = false;
    }
  }, [visible, minBuyIn, isSeeker]);

  // Close the modal — reservation stays active and expires via server timeout
  const handleClose = useCallback(() => {
    hasReservationRef.current = false;
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    let buyIn: number;
    if (isPractice || isSeeker) {
      buyIn = parseInt(amount, 10);
      if (isNaN(buyIn) || buyIn <= 0) {
        setAlert({ title: 'INVALID AMOUNT', message: isSeeker ? 'Enter a valid SEEKER amount' : 'Enter a valid chip amount' });
        return;
      }
    } else {
      const solAmount = parseFloat(amount);
      if (isNaN(solAmount) || solAmount <= 0) {
        setAlert({ title: 'INVALID AMOUNT', message: 'Enter a valid SOL amount' });
        return;
      }
      buyIn = Math.round(solAmount * 1_000_000_000);
    }
    if (buyIn < minBuyIn) {
      setAlert({ title: 'INVALID AMOUNT', message: isPractice
        ? `Minimum buy-in is ${minBuyIn.toLocaleString()} chips`
        : isSeeker
        ? `Minimum buy-in is ${minBuyIn.toLocaleString()} SEEKER`
        : `Minimum buy-in is ${lamportsToSol(minBuyIn)} SOL` });
      return;
    }
    if (buyIn > maxBuyIn) {
      setAlert({ title: 'INVALID AMOUNT', message: isPractice
        ? `Maximum buy-in is ${maxBuyIn.toLocaleString()} chips`
        : isSeeker
        ? `Maximum buy-in is ${maxBuyIn.toLocaleString()} SEEKER`
        : `Maximum buy-in is ${lamportsToSol(maxBuyIn)} SOL` });
      return;
    }

    // Practice tables: skip wallet/tx — just sit with free chips
    if (isPractice) {
      setSending(true);
      try {
        onClose();
        const res = await SocketService.sitAtSeat(tableId, buyIn, seatIndex, avatarSeed, username);
        if ('error' in res) setAlert({ title: 'CANNOT JOIN', message: res.error });
      } catch (e) {
        setAlert({ title: 'JOIN FAILED', message: e instanceof Error ? e.message : String(e) });
      } finally {
        setSending(false);
      }
      return;
    }

    if (!accounts?.[0]) {
      setAlert({ title: 'WALLET REQUIRED', message: 'Connect your wallet first' });
      return;
    }

    setSending(true);
    try {
      // 1. Reserve the seat server-side BEFORE any wallet interaction
      const reservation = await SocketService.reserveSeat(tableId, seatIndex);
      if ('error' in reservation) {
        setAlert({ title: 'SEAT UNAVAILABLE', message: reservation.error });
        setSending(false);
        return;
      }
      hasReservationRef.current = true;

      // 2. Build and sign the wallet transaction
      const walletAddress = new PublicKey(accounts[0].address).toBase58();
      const tx = isSeeker
        ? await buildSPLVaultBuyInTransaction(walletAddress, BigInt(buyIn) * 1_000_000_000n, tableId, 9, SOLANA_NETWORK)
        : await buildVaultBuyInTransaction(walletAddress, buyIn, tableId, SOLANA_NETWORK);
      const txSignature = await signAndSendTransaction(tx);
      // Reservation will be consumed by sit_at_seat — don't release on close
      hasReservationRef.current = false;
      onClose();

      // 3. Server verifies the on-chain deposit and seats the player
      const res = await SocketService.sitAtSeat(tableId, buyIn, seatIndex, avatarSeed, username, txSignature, walletAddress);
      if ('error' in res) setAlert({ title: 'CANNOT JOIN', message: res.error });
    } catch (e) {
      // Don't release the reservation on failure — let the server timeout (15s)
      // handle it so other players still see the seat as blocked.
      hasReservationRef.current = false;

      const raw = e instanceof Error ? e.message : String(e);
      let message = raw;
      if (raw.includes('ConnectionFailedException') || raw.includes('Unable to connect to websocket')) {
        message = 'Could not connect to your wallet. Make sure your wallet app is open and try again.';
      } else if (raw.includes('authorization request failed') || raw.includes('authorization')) {
        message = 'Wallet session expired. Reconnect your wallet in Settings to continue.';
        deauthorize().catch(() => {});
      } else if (raw.includes('declined') || raw.includes('rejected') || raw.includes('cancelled')) {
        message = 'Transaction was cancelled.';
      } else if (raw.includes('insufficient') || raw.includes('Insufficient')) {
        message = isSeeker ? 'Insufficient SEEKER balance for this buy-in.' : 'Insufficient SOL balance for this buy-in.';
      } else if (raw.includes('timeout') || raw.includes('Timeout')) {
        message = 'Wallet request timed out. Please try again.';
      }
      setAlert({ title: 'TRANSACTION FAILED', message });
    } finally {
      setSending(false);
    }
  }, [amount, tableId, seatIndex, minBuyIn, maxBuyIn, onClose, accounts, signAndSendTransaction, isPractice, isSeeker]);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={bimStyles.overlay}>
            <TouchableWithoutFeedback onPress={() => { }}>
              <View style={bimStyles.panel}>
                <Text style={bimStyles.title}>BUY IN</Text>
                <Text style={bimStyles.sub}>Seat {seatIndex + 1}</Text>
                <Text style={bimStyles.range}>
                  {isPractice
                    ? `${minBuyIn.toLocaleString()} – ${maxBuyIn.toLocaleString()} chips`
                    : isSeeker
                    ? `${minBuyIn.toLocaleString()} – ${maxBuyIn.toLocaleString()} SEEKER`
                    : `${lamportsToSol(minBuyIn)} – ${lamportsToSol(maxBuyIn)} SOL`}
                </Text>
                <TextInput
                  style={bimStyles.input}
                  value={amount}
                  onChangeText={(t) => setAmount(isPractice || isSeeker ? t.replace(/[^0-9]/g, '') : t.replace(/[^0-9.]/g, ''))}
                  keyboardType={isPractice || isSeeker ? 'number-pad' : 'decimal-pad'}
                  selectTextOnFocus
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <Pressable
                  style={({ pressed }) => [bimStyles.btn, pressed && bimStyles.btnPressed, sending && { opacity: 0.5 }]}
                  onPress={handleConfirm}
                  disabled={sending}>
                  <Text style={bimStyles.btnText}>{sending ? 'SIGNING...' : 'SIT DOWN'}</Text>
                </Pressable>
                <Pressable onPress={handleClose} style={{ paddingVertical: 4 }}>
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

interface WaitingOverlayProps { seatedCount: number; isSeated: boolean; }

const WaitingOverlay = memo(function WaitingOverlay({ seatedCount, isSeated }: WaitingOverlayProps) {
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
        {!isSeated && seatedCount > 0 && (
          <Text style={woStyles.hint}>Tap on a seat to join</Text>
        )}
      </View>
    </View>
  );
});

const woStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 20,
    justifyContent: 'center', alignItems: 'center',
    top: '25%', bottom: '35%',
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
  hint: { fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: '#00FFFF', marginTop: 4 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Chip sweep animation — coins fly from pot center to winner's seat
// ─────────────────────────────────────────────────────────────────────────────

const COIN_IMG = require('@/assets/images/coin.png');
const SWEEP_COIN_COUNT = 8;
const SWEEP_COIN_SIZE = 26;
const SWEEP_DURATION = 550;
const SWEEP_STAGGER = 80;
const sweepEase = REasing.bezier(0.33, 1, 0.68, 1);

interface ChipSweepProps {
  origin: { x: number; y: number };
  target: { x: number; y: number };
  winAmount: number;
  handName: string;
  winnerName: string;
  bestHandCards: CardValue[];
  onComplete: () => void;
  formatValue: (v: number) => string;
}

/** Single animated coin — uses react-native-reanimated shared values. */
function SweepCoin({ fromX, fromY, dx, dy, delay }: {
  fromX: number; fromY: number; dx: number; dy: number; delay: number;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  const sc = useSharedValue(0.3);

  useEffect(() => {
    const cfg = { duration: SWEEP_DURATION, easing: sweepEase };
    op.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 60 }),
      withTiming(1, { duration: SWEEP_DURATION - 160 }),
      withTiming(0, { duration: 200 }),
    ));
    tx.value = withDelay(delay, withTiming(dx, cfg));
    ty.value = withDelay(delay, withTiming(dy, cfg));
    sc.value = withDelay(delay, withSequence(
      withTiming(1.15, { duration: SWEEP_DURATION * 0.4, easing: sweepEase }),
      withTiming(0.5, { duration: SWEEP_DURATION * 0.6, easing: sweepEase }),
    ));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }],
  }));

  return (
    <ReAnimated.View style={[{
      position: 'absolute',
      left: fromX,
      top: fromY,
      width: SWEEP_COIN_SIZE,
      height: SWEEP_COIN_SIZE,
      zIndex: 100,
    }, style]} pointerEvents="none">
      <Image source={COIN_IMG} style={{ width: SWEEP_COIN_SIZE, height: SWEEP_COIN_SIZE }} />
    </ReAnimated.View>
  );
}

/** Animated text label — uses reanimated. */
function SweepLabel({ x, y, text, color, fontSize, delay, holdMs, onDone }: {
  x: number; y: number; text: string; color: string; fontSize: number;
  delay: number; holdMs: number; onDone?: () => void;
}) {
  const op = useSharedValue(0);
  const sc = useSharedValue(0.5);

  useEffect(() => {
    op.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(1, { duration: holdMs }),
      withTiming(0, { duration: 300 }),
    ));
    sc.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 250, easing: sweepEase }),
      withTiming(1, { duration: holdMs }),
      withTiming(1.15, { duration: 300 }),
    ));
    if (onDone) {
      const t = setTimeout(onDone, delay + 200 + holdMs + 300 + 100);
      return () => clearTimeout(t);
    }
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ scale: sc.value }],
  }));

  return (
    <ReAnimated.Text style={[{
      position: 'absolute',
      left: x - 110, top: y, width: 220,
      textAlign: 'center',
      fontFamily: 'PressStart2P_400Regular',
      fontSize,
      lineHeight: fontSize * 2,
      color,
      textShadowColor: 'rgba(0,0,0,0.9)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 6,
      zIndex: 100,
    }, style]} pointerEvents="none">
      {text}
    </ReAnimated.Text>
  );
}

const ChipSweep = memo(function ChipSweep({ origin, target, winAmount, handName, onComplete, formatValue }: ChipSweepProps) {
  // Pre-compute random offsets once
  const offsets = useRef(
    Array.from({ length: SWEEP_COIN_COUNT }, () => ({
      sx: (Math.random() - 0.5) * 24,
      sy: (Math.random() - 0.5) * 16,
      ex: (Math.random() - 0.5) * 16,
      ey: (Math.random() - 0.5) * 16,
    }))
  ).current;

  return (
    <>
      {offsets.map((o, i) => {
        const fromX = origin.x - SWEEP_COIN_SIZE / 2 + o.sx;
        const fromY = origin.y - SWEEP_COIN_SIZE / 2 + o.sy;
        const toX = target.x - SWEEP_COIN_SIZE / 2 + o.ex;
        const toY = target.y - SWEEP_COIN_SIZE / 2 + o.ey;
        return (
          <SweepCoin
            key={i}
            fromX={fromX}
            fromY={fromY}
            dx={toX - fromX}
            dy={toY - fromY}
            delay={i * SWEEP_STAGGER}
          />
        );
      })}
      <SweepLabel
        x={origin.x}
        y={origin.y - 70}
        text={handName.toUpperCase()}
        color={gold}
        fontSize={13}
        delay={0}
        holdMs={3500}
        onDone={onComplete}
      />
      <SweepLabel
        x={target.x}
        y={target.y - 52}
        text={`+${formatValue(winAmount)}`}
        color="#00FF88"
        fontSize={10}
        delay={300}
        holdMs={3000}
      />
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Win popup — small bottom-right toast showing winner info
// ─────────────────────────────────────────────────────────────────────────────

interface WinPopupProps {
  winnerName: string;
  handName: string;
  bestHandCards: CardValue[];
  winAmount: number;
  formatValue: (v: number) => string;
}

const WinPopup = memo(function WinPopup({ winnerName, handName, bestHandCards, winAmount, formatValue }: WinPopupProps) {
  const slideAnim = useRef(new Animated.Value(120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 160,
        right: 10,
        backgroundColor: 'rgba(15, 5, 30, 0.92)',
        borderWidth: 1,
        borderColor: gold,
        borderRadius: 12,
        padding: 14,
        maxWidth: 190,
        zIndex: 70,
        opacity: opacityAnim,
        transform: [{ translateX: slideAnim }],
        ...Platform.select({
          ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8 },
          android: { elevation: 8 },
          default: {},
        }),
      }}
    >
      <Text style={{
        fontFamily: 'PressStart2P_400Regular',
        fontSize: 7,
        lineHeight: 14,
        color: '#FFF',
        marginBottom: 6,
      }}>
        {winnerName.toUpperCase()} WINS
      </Text>
      <Text style={{
        fontFamily: 'PressStart2P_400Regular',
        fontSize: 8,
        lineHeight: 20,
        color: gold,
        marginBottom: 6,
      }}>
        {handName.toUpperCase()}
      </Text>
      <Text style={{
        fontFamily: 'PressStart2P_400Regular',
        fontSize: 7,
        lineHeight: 14,
        color: '#00FF88',
        marginBottom: 8,
      }}>
        +{formatValue(winAmount)}
      </Text>
      {bestHandCards.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {bestHandCards.map((card, i) => (
            <PokerCard key={i} card={card} style={{ width: 28, height: 40 }} />
          ))}
        </View>
      )}
    </Animated.View>
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
    alignSelf: 'center',
    backgroundColor: 'rgba(81,46,123,0.92)',
    borderWidth: 1, borderColor: gold, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 5, marginBottom: 6,
  },
  text: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: gold, letterSpacing: 1, textAlign: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Pot display with coin stack
// ─────────────────────────────────────────────────────────────────────────────

const COIN_SIZE = 22;

/**
 * Derive 1–5 coins based on pot size relative to big blind.
 * 1 coin  = pot ≤ 2 BB
 * 2 coins = pot ≤ 5 BB
 * 3 coins = pot ≤ 10 BB
 * 4 coins = pot ≤ 20 BB
 * 5 coins = pot > 20 BB
 */
function getCoinCount(pot: number, bigBlind: number): number {
  if (bigBlind <= 0) return 1;
  const ratio = pot / bigBlind;
  if (ratio <= 2) return 1;
  if (ratio <= 5) return 2;
  if (ratio <= 10) return 3;
  if (ratio <= 20) return 4;
  return 5;
}

const PotDisplay = memo(function PotDisplay({
  pot, bigBlind, formatValue,
}: { pot: number; bigBlind: number; formatValue: (v: number) => string }) {
  if (pot <= 0) return null;
  const count = getCoinCount(pot, bigBlind);
  return (
    <View style={potStyles.wrap}>
      <View style={potStyles.coinRow}>
        {Array.from({ length: count }).map((_, i) => (
          <Image
            key={i}
            source={COIN_IMG}
            style={[
              potStyles.coin,
              { marginLeft: i === 0 ? 0 : -8, zIndex: count - i },
            ]}
          />
        ))}
      </View>
      <Text style={potStyles.label}>POT: {formatValue(pot)}</Text>
    </View>
  );
});

const potStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center', gap: 3, marginBottom: 14,
  },
  coinRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    marginBottom: 6,
  },
  coin: {
    width: COIN_SIZE, height: COIN_SIZE,
  },
  label: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: gold,
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Raise amount input
// ─────────────────────────────────────────────────────────────────────────────

interface RaiseInputProps { min: number; max: number; value: number; onChange: (v: number) => void; isPractice?: boolean; }

/** For SOL tables: values are in lamports, display in SOL. For practice: values are raw chips. */
const RaiseAmountInput = memo(function RaiseAmountInput({ min, max, value, onChange, isPractice = false }: RaiseInputProps) {
  const toDisplay = isPractice ? (v: number) => v : (lamports: number) => lamports / LAMPORTS_PER_SOL;
  const toInternal = isPractice ? (v: number) => Math.round(v) : (sol: number) => Math.round(sol * LAMPORTS_PER_SOL);
  const fmtDisplay = (internal: number) => {
    const display = toDisplay(internal);
    if (isPractice) return Math.round(display).toLocaleString();
    if (display >= 1) return display.toFixed(2);
    if (display >= 0.01) return display.toFixed(2);
    if (display > 0) return display.toFixed(4);
    return '0';
  };

  const [text, setText] = useState(fmtDisplay(value));

  useEffect(() => { setText(fmtDisplay(value)); }, [value]);

  const handleTextChange = useCallback((t: string) => {
    const cleaned = t.replace(/[^0-9.]/g, '');
    setText(cleaned);
    // Immediately sync valid values to the store so the RAISE button always uses the latest input
    const n = parseFloat(cleaned);
    if (!isNaN(n) && n > 0) {
      const internal = toInternal(n);
      const clamped = Math.max(min, Math.min(max, internal));
      onChange(clamped);
    }
  }, [min, max, onChange]);

  const commit = useCallback(() => {
    const n = parseFloat(text);
    if (!isNaN(n) && n > 0) {
      const internal = toInternal(n);
      const clamped = Math.max(min, Math.min(max, internal));
      onChange(clamped);
      setText(fmtDisplay(clamped));
    } else {
      setText(fmtDisplay(value));
    }
  }, [text, value, min, max, onChange]);

  const currentInternal = (() => {
    const n = parseFloat(text);
    return !isNaN(n) && n > 0 ? toInternal(n) : value;
  })();

  const minStep = isPractice ? 1 : toInternal(0.0001);

  const dec = useCallback(() => {
    const step = Math.max(minStep, Math.round(currentInternal * 0.10));
    const next = Math.max(min, currentInternal - step);
    onChange(next); setText(fmtDisplay(next));
  }, [currentInternal, min, minStep, onChange]);

  const inc = useCallback(() => {
    const step = Math.max(minStep, Math.round(currentInternal * 0.10));
    const next = Math.min(max, currentInternal + step);
    onChange(next); setText(fmtDisplay(next));
  }, [currentInternal, max, minStep, onChange]);

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
          onChangeText={handleTextChange}
          onBlur={commit} onSubmitEditing={commit}
          keyboardType="decimal-pad" selectTextOnFocus showSoftInputOnFocus
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
  const tokenType = useGameStore((s) => s.tokenType);
  const isPractice = id.startsWith('practice-');
  const isSeeker = tokenType === 'SEEKER' || (!tokenType && id.startsWith('seeker-'));
  const fmtValue = useMemo(() => getFormatter(isPractice, isSeeker), [isPractice, isSeeker]);

  // Layout geometry — computed from actual screen size so nothing clips the top bar
  // Top bar: safe-area + 6 margin + ~52px bar = insets.top + 58
  let TABLE_TOP = insets.top ;
  TABLE_TOP = TABLE_TOP + (TABLE_TOP * 0.18);
  // Bottom controls: raise input (~52) + action bar (~56) + padding (~80)
  const TABLE_BOT = 188;
  let TABLE_H = screenH - TABLE_BOT ;
  TABLE_H = TABLE_H + Math.round(TABLE_H * 0.18) ;

  // Seat positions: absolute coords inside the main container
  // 0=top-center, 1=top-left, 2=top-right, 3=bottom-left, 4=bottom-right, 5=bottom-center
  const SEAT_POSITIONS = [
    { top: TABLE_TOP , left: screenW / 2 - 32 }, // 0 top-center (straddles top edge)
    { top: TABLE_TOP + Math.round(TABLE_H * 0.20), left: 4 }, // 1 top-left
    { top: TABLE_TOP + Math.round(TABLE_H * 0.20), right: 4 }, // 2 top-right
    { top: TABLE_TOP + Math.round(TABLE_H * 0.53), left: 4 }, // 3 bottom-left
    { top: TABLE_TOP + Math.round(TABLE_H * 0.53), right: 4 }, // 4 bottom-right
    { top: TABLE_TOP + Math.round(TABLE_H * 0.70), left: screenW / 2 - 32 }, // 5 bottom-center
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
  const reservedSeats = useGameStore((s) => s.reservedSeats);
  const tablMinBuyIn = useGameStore((s) => s.minBuyIn);
  const tablMaxBuyIn = useGameStore((s) => s.maxBuyIn);
  const tablSmallBlind = useGameStore((s) => s.smallBlind);
  const tablBigBlind = useGameStore((s) => s.bigBlind);
  const raiseAmount = useGameStore((s) => s.raiseAmount);
  const setRaiseAmount = useGameStore((s) => s.setRaiseAmount);
  const myHand = useGameStore((s) => s.myHand);
  const lastHandResult = useGameStore((s) => s.lastHandResult);
  const dismissHandResult = useGameStore((s) => s.dismissHandResult);

  // Must be before any early return (Rules of Hooks)
  const lobbyTables = useLobbyStore((s) => s.tables);

  // Check if the local player is sitting out
  const mySeat = mySeatIndex !== null ? seats[mySeatIndex] : null;
  const iAmSittingOut = mySeat?.isSittingOut ?? false;
  const iAmAllIn = mySeat?.isAllIn ?? false;

  const { fold, call, raise, allIn, minRaise, maxRaise } = usePokerActions();
  const turnTimeoutMs = useGameStore((s) => s.turnTimeoutMs);
  const { secondsLeft, progress } = useTurnTimer(useGameStore((s) => s.turnTimeoutAt), turnTimeoutMs);

  const { hideTransition } = useTransition();
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const [buyInModal, setBuyInModal] = useState<{ visible: boolean; seatIndex: number }>({
    visible: false, seatIndex: 0,
  });
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);
  const [roomInfoVisible, setRoomInfoVisible] = useState(false);
  const [leavingInProgress, setLeavingInProgress] = useState(false);
  const [cashOutAlert, setCashOutAlert] = useState<{ title: string; message: string } | null>(null);
  const [magnifyInfo, setMagnifyInfo] = useState<CardMagnifyInfo | null>(null);
  const leftAlreadyRef = useRef(false);

  // ── Busted out — player stays as spectator ──────────────────────────────
  const kickedReason = useGameStore((s) => s.kickedReason);


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

  // Always leave the room when this screen unmounts — covers swiping back
  // without pressing Leave. Skipped if confirmLeave already handled it.
  useEffect(() => {
    return () => {
      if (id && !leftAlreadyRef.current) SocketService.leaveTable(id);
      useGameStore.getState().clearKicked();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request a public table snapshot so spectators can see seated players
  useEffect(() => {
    if (id) SocketService.watchTable(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmLeave = useCallback(async () => {
    if (!id || leavingInProgress) return;
    setLeaveConfirmVisible(false);
    leftAlreadyRef.current = true;

    // If the user is not seated, just leave immediately — no payout needed
    if (mySeatIndex === null) {
      SocketService.leaveTable(id);
      router.back();
      return;
    }

    setLeavingInProgress(true);

    try {
      const result = await SocketService.leaveTableWithPayout(id);
      if (result && result.amount > 0) {
        const tokenLabel = isSeeker ? 'SEEKER' : 'SOL';
        const amtStr = isSeeker
          ? result.amount.toLocaleString()
          : (() => { const sol = result.amount / 1_000_000_000; return sol >= 0.01 ? sol.toFixed(2) : sol.toFixed(4); })();
        if (result.txSignature === 'internal') {
          setCashOutAlert({
            title: 'CASH OUT COMPLETE',
            message: `${amtStr} ${tokenLabel} has been credited to your internal balance.`,
          });
        } else if (result.txSignature) {
          setCashOutAlert({
            title: 'CASH OUT COMPLETE',
            message: `${amtStr} ${tokenLabel} has been transferred to your wallet.`,
          });
        } else {
          setCashOutAlert({
            title: 'CASH OUT FAILED',
            message: `Transfer of ${amtStr} ${tokenLabel} failed. Please contact support.`,
          });
        }
        // Don't navigate yet — wait for user to dismiss the alert
        return;
      }
    } catch {
      // Fall through — navigate immediately
    }

    setLeavingInProgress(false);
    router.back();
  }, [id, router, leavingInProgress, mySeatIndex]);

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
    // Clear busted state so the player can re-join
    useGameStore.getState().clearKicked();
    setBuyInModal({ visible: true, seatIndex });
  }, []);

  const closeBuyIn = useCallback(() => {
    setBuyInModal((p) => ({ ...p, visible: false }));
  }, []);

  const handleAction = useCallback((action: 'fold' | 'call' | 'raise' | 'all-in') => {
    if (!isMyTurn) return;
    if (action === 'fold') fold();
    else if (action === 'call') {
      if (myChips <= 0) return;
      call();
    } else if (action === 'raise') {
      if (myChips <= 0) return;
      raise(raiseAmount);
    } else if (action === 'all-in') {
      if (myChips <= 0) return;
      allIn();
    }
  }, [isMyTurn, fold, call, raise, allIn, raiseAmount, myChips]);

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
  // Once we have real seat data from table_state, stop using stale lobby data.
  const hasTableState = seats.some(Boolean);
  const lobbyTable = lobbyTables.find((t) => t.id === id);
  const lobbyOccupiedSeats: number[] = hasTableState ? [] : (lobbyTable?.occupiedSeats ?? []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const roomId = (id?.length ?? 0) > 8 ? `${id!.slice(0, 6)}…${id!.slice(-2)}` : (id ?? '—');
  const seatedCount = seats.filter(Boolean).length;
  const isInHand = phase !== 'waiting' && phase !== 'countdown';

  // ── Animation layout coords (absolute screen coords) ──────────────────────
  // The tableArea has `top: TABLE_TOP` + `marginTop: -90`, so visual top = TABLE_TOP - 90
  const tableVisualTop = TABLE_TOP - 90;
  // Community cards are at 36% down the table + pot/badge height (~50) + half card height (31)
  const deckOrigin = {
    x: screenW / 2,
    y: tableVisualTop + TABLE_H * 0.36 + 50 + 31,
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
          isPractice={isPractice}
          tokenType={isSeeker ? 'SEEKER' : 'SOL'}
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
          winnerName={w.name}
          bestHandCards={w.bestHandCards ?? []}
          onComplete={dismissHandResult}
          formatValue={fmtValue}
        />
      ))}

      {/* Win popup — bottom-right toast */}
      {lastHandResult && lastHandResult.winners.length > 0 && (
        <WinPopup
          winnerName={lastHandResult.winners[0].name}
          handName={lastHandResult.winners[0].bestHandName}
          bestHandCards={lastHandResult.winners[0].bestHandCards ?? []}
          winAmount={lastHandResult.winners[0].winAmount}
          formatValue={fmtValue}
        />
      )}

      {/* Countdown overlay */}
      {phase === 'countdown' && <CountdownOverlay seconds={countdownSeconds} />}

      {/* Waiting overlay */}
      {phase === 'waiting' && seatedCount < 2 && <WaitingOverlay seatedCount={seatedCount} isSeated={mySeatIndex !== null} />}

      {/* Table image — positioned between top bar and bottom controls */}
      <View style={[styles.tableArea, { marginTop:-90,top: TABLE_TOP, height: TABLE_H }]}>
        <Image source={require('@/assets/images/table.png')} style={styles.tableImage} resizeMode="contain" />

        {/* Community cards + phase badge + pot */}
        <View style={styles.communityOverlay}>
          <PotDisplay pot={pot} bigBlind={tablBigBlind} formatValue={fmtValue} />
          <PhaseBadge phase={phase} />
          {!lastHandResult && (
            <View style={styles.communityRow}>
              {[0, 1, 2, 3, 4].map((i) => {
                const card = communityCards[i] as CardValue | null;
                const showBack = !card && isInHand;
                return (
                  <View key={i} style={styles.communitySlot}>
                    {card
                      ? <PokerCard card={card} style={styles.cardSize} onMagnifyStart={setMagnifyInfo} onMagnifyEnd={() => setMagnifyInfo(null)} />
                      : showBack
                        ? <PokerCard card={null} faceDown style={styles.cardSize} />
                        : null}
                  </View>
                );
              })}
            </View>
          )}

          {/* Player's hole cards — shown below pot, only when in a hand */}
          {isInHand && mySeatIndex !== null && (
            <View style={styles.holeCardsRow}>
              {myHand.map((card, i) =>
                card ? (
                  <PokerCard key={i} card={card as CardValue} style={styles.holeCard} onMagnifyStart={setMagnifyInfo} onMagnifyEnd={() => setMagnifyInfo(null)} />
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
        const isReserved = reservedSeats.some(r => r.seatIndex === v);
        const seatOccupied = !!seats[v] || lobbyOccupiedSeats.includes(v) || isReserved;
        const reservation = reservedSeats.find(r => r.seatIndex === v);
        return (
          <View key={v} style={[styles.seatWrap, pos]}>
            <SeatSlot
              seatIndex={v}
              isMine={mySeatIndex === v}
              isActive={activePlayerSeatIndex === v}
              timerProgress={activePlayerSeatIndex === v ? progress : 1}
              canJoin={canJoinAnySeat && !seatOccupied}
              isTaken={!seats[v] && (lobbyOccupiedSeats.includes(v) || isReserved)}
              reservation={reservation}
              onJoin={handleSeatPress}
              formatValue={fmtValue}
            />
          </View>
        );
      })}

      {/* Top bar */}
      <View style={[styles.topBarWrap, { top: insets.top + 6 }]}>
        {secondsLeft > 0 && activePlayerSeatIndex !== null && (
          <View style={[styles.turnTimerWrap, secondsLeft <= 5 && styles.turnTimerWrapUrgent]}>
            <Text style={[styles.turnTimerText, secondsLeft <= 5 && styles.turnTimerUrgent]}>
              {secondsLeft}s
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Pressable style={({ pressed }) => [styles.infoBtn, pressed && { opacity: 0.7 }]} onPress={() => setRoomInfoVisible(true)}>
          <MaterialCommunityIcons name="information-outline" size={20} color="#00FFFF" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.leaveBtn, pressed && styles.leaveBtnP]}
          onPress={handleLeave}>
          <Text style={styles.leaveText}>LEAVE</Text>
        </Pressable>
      </View>

      {/* Leave confirmation modal */}
      <Modal
        visible={leaveConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLeaveConfirmVisible(false)}>
        <View style={lcStyles.overlay}>
          <View style={lcStyles.panel}>
            <Text style={lcStyles.title}>LEAVE GAME?</Text>
            <Text style={lcStyles.sub}>Your remaining balance will be transferred back to your wallet.</Text>
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

      {/* Room info modal */}
      <Modal
        visible={roomInfoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoomInfoVisible(false)}>
        <Pressable style={rmStyles.overlay} onPress={() => setRoomInfoVisible(false)}>
          <Pressable style={rmStyles.panel} onPress={(e) => e.stopPropagation?.()}>
            {/* Header */}
            <View style={rmStyles.header}>
              <View style={rmStyles.headerLine} />
              <Text style={rmStyles.title}>ROOM INFO</Text>
              <View style={rmStyles.headerLine} />
            </View>

            {/* Room ID card */}
            <Pressable
              onPress={async () => {
                if (id) {
                  await Clipboard.setStringAsync(id);
                }
              }}
              style={rmStyles.idRow}>
              <Text style={rmStyles.idLabel}>ROOM ID</Text>
              <Text style={rmStyles.idValue}>{id ?? '—'}</Text>
              <Text style={rmStyles.copyHint}>TAP TO COPY</Text>
            </Pressable>

            {/* Stats grid */}
            <View style={rmStyles.statsGrid}>
              <View style={rmStyles.statCard}>
                <Text style={rmStyles.statLabel}>BLINDS</Text>
                <Text style={rmStyles.statValue}>
                  {isPractice
                    ? `${tablSmallBlind}/${tablBigBlind}`
                    : isSeeker
                    ? `${formatSeekerValue(tablSmallBlind)}/${formatSeekerValue(tablBigBlind)}`
                    : `${formatSol(tablSmallBlind)}/${formatSol(tablBigBlind)}`}
                </Text>
              </View>
              <View style={rmStyles.statCard}>
                <Text style={rmStyles.statLabel}>BUY-IN</Text>
                <Text style={rmStyles.statValue}>
                  {isPractice
                    ? `${(tablMinBuyIn || 0).toLocaleString()}–${(tablMaxBuyIn || 0).toLocaleString()}`
                    : isSeeker
                    ? `${formatSeekerValue(tablMinBuyIn || 0)}–${formatSeekerValue(tablMaxBuyIn || 0)}`
                    : `${formatSol(tablMinBuyIn || 0)}–${formatSol(tablMaxBuyIn || 0)}`}
                </Text>
              </View>
              <View style={rmStyles.statCard}>
                <Text style={rmStyles.statLabel}>PLAYERS</Text>
                <Text style={rmStyles.statValueCyan}>{seatedCount}<Text style={rmStyles.statDim}> / 6</Text></Text>
              </View>
              <View style={rmStyles.statCard}>
                <Text style={rmStyles.statLabel}>TIMER</Text>
                <Text style={rmStyles.statValueCyan}>{turnTimeoutMs ? `${turnTimeoutMs / 1000}s` : '—'}</Text>
              </View>
            </View>

            {/* Type badge */}
            <View style={rmStyles.typeBadgeRow}>
              <View style={[rmStyles.typeBadge, isPractice ? rmStyles.typePractice : isSeeker ? rmStyles.typeSeeker : rmStyles.typeSol]}>
                <Text style={rmStyles.typeBadgeText}>{isPractice ? 'PRACTICE' : isSeeker ? 'SEEKER' : 'SOL'}</Text>
              </View>
            </View>

            {/* Close */}
            <Pressable style={({ pressed }) => [rmStyles.closeBtn, pressed && { opacity: 0.7 }]} onPress={() => setRoomInfoVisible(false)}>
              <Text style={rmStyles.closeBtnText}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Card magnifier — floats above the held card */}
      {magnifyInfo && (() => {
        const centerX = magnifyInfo.x + magnifyInfo.width / 2;
        let left = centerX - MAGNIFY_W / 2;
        // Clamp horizontally within screen
        left = Math.max(8, Math.min(left, screenW - MAGNIFY_W - 8));
        // Prefer above the card; if too close to top, show below
        const aboveTop = magnifyInfo.y - MAGNIFY_H - 12;
        const top = aboveTop > 20
          ? aboveTop
          : magnifyInfo.y + magnifyInfo.height + 12;
        return (
          <View pointerEvents="none" style={[mgStyles.wrap, { left, top }]}>
            <View style={mgStyles.cardWrap}>
              <PokerCard card={magnifyInfo.card} style={mgStyles.card} />
            </View>
          </View>
        );
      })()}

      {/* Leaving / payout in progress overlay */}
      {leavingInProgress && !cashOutAlert && (
        <Modal visible transparent animationType="fade">
          <View style={lcStyles.overlay}>
            <View style={lcStyles.panel}>
              <Text style={lcStyles.title}>CASHING OUT...</Text>
              <Text style={lcStyles.sub}>Transferring your balance back to your wallet.</Text>
            </View>
          </View>
        </Modal>
      )}

      {/* Cash-out result alert */}
      <GameAlert
        visible={cashOutAlert !== null}
        title={cashOutAlert?.title ?? ''}
        message={cashOutAlert?.message ?? ''}
        onClose={() => {
          setCashOutAlert(null);
          setLeavingInProgress(false);
          router.back();
        }}
      />

      {/* Action bar — only when seated */}
      {/* Busted-out spectator banner */}
      {kickedReason && (
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.bustedBanner}>
            <Text style={styles.bustedText}>
              {kickedReason.includes('inactivity') ? 'KICKED FOR INACTIVITY' : 'BUSTED OUT'}
            </Text>
            <Text style={styles.bustedSub}>
              {kickedReason.includes('inactivity')
                ? 'Your balance has been transferred back to your account.'
                : 'You are now spectating this table.'}
            </Text>
          </View>
        </View>
      )}

      {/* Action buttons — only when seated and not busted */}
      {mySeatIndex !== null && !kickedReason && (
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 12 }]}>
          {iAmSittingOut ? (
            <Pressable
              style={({ pressed }) => [styles.imBackBtn, pressed && { opacity: 0.8 }]}
              onPress={() => SocketService.returnToTable(id)}>
              <Text style={styles.imBackText}>I'M BACK</Text>
            </Pressable>
          ) : isMyTurn && !iAmAllIn ? (
            <>
              <View style={styles.raiseRow}>
                <RaiseAmountInput
                  min={minRaise}
                  max={maxRaise}
                  value={Math.max(minRaise, Math.min(maxRaise, raiseAmount))}
                  onChange={setRaiseAmount}
                  isPractice={isPractice || isSeeker}
                />
              </View>

              <View style={styles.actionRow}>
                <View style={styles.actionRowButtons}>
                  <GameActionButtons
                    currentBet={currentBet}
                    myChips={myChips}
                    onAction={handleAction}
                  />
                </View>
                {isSeeker && <EmojiPanel onSend={(emoji) => SocketService.sendEmojiReaction(id, emoji)} />}
              </View>
            </>
          ) : isSeeker ? (
            <View style={styles.emojiOnly}>
              <EmojiPanel onSend={(emoji) => SocketService.sendEmojiReaction(id, emoji)} />
            </View>
          ) : null}
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
  tableImage: { width: '95%', height: '100%', alignSelf: 'center' },

  communityOverlay: {
    position: 'absolute', top: '36%',
    left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  communityRow: { flexDirection: 'row', justifyContent: 'center', gap: 2 },
  communitySlot: { width: 56, alignItems: 'center', justifyContent: 'center' },
  cardSize: { width: 54, height: 76 },
  emptyCard: {
    width: 54, height: 76, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4 },
      android: { elevation: 4 }, default: {},
    }),
  },
  seatWrap: { position: 'absolute', zIndex: 20 },

  // Top bar
  topBarWrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, overflow: 'hidden' },
  flex1: { flex: 1, minWidth: 6 },
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
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(180,30,30,0.92)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FF4444',
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
  infoBtn: {
    width: 36, height: 36, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5, borderColor: 'rgba(0,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Bottom controls
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, zIndex: 10 },
  turnTimerWrap: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10, borderWidth: 1.5, borderColor: '#00FF88',
    paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  turnTimerWrapUrgent: {
    borderColor: '#FF4444',
  },
  turnTimerText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 18, color: '#00FF88',
    marginTop: 6,
    textShadowColor: '#00FF88', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  turnTimerUrgent: {
    color: '#FF4444',
    textShadowColor: '#FF4444',
  },
  holeCardsRow: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 24 },
  holeCard: { width: 64, height: 90 },
  bustedBanner: {
    backgroundColor: 'rgba(26,10,46,0.92)',
    borderWidth: 2, borderColor: '#FF4444', borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 16,
    alignItems: 'center', gap: 6,
  },
  bustedText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: '#FF4444',
    textShadowColor: 'rgba(255,0,0,0.4)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },
  bustedSub: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 7, color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
  },
  actionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  actionRowButtons: { flex: 1 },
  emojiOnly: { alignItems: 'flex-end', paddingHorizontal: 8 },
  raiseRow: { flexDirection: 'row', marginBottom: 12, paddingHorizontal: 4 },
  imBackBtn: {
    backgroundColor: '#00AA66',
    borderWidth: 2, borderColor: '#00FFAA', borderRadius: 14,
    paddingHorizontal: 32, paddingVertical: 16,
    alignItems: 'center', alignSelf: 'center',
    ...Platform.select({
      ios: { shadowColor: '#00FFAA', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10 },
      android: { elevation: 8 }, default: {},
    }),
  },
  imBackText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: 14, color: '#fff',
    textShadowColor: 'rgba(0,60,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
});

// Room info modal styles
const rmStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: {
    width: '100%', maxWidth: 340,
    backgroundColor: '#0d0820', borderRadius: 16, borderWidth: 2, borderColor: '#00FFFF',
    padding: 20, gap: 14,
    ...Platform.select({
      ios: { shadowColor: '#00FFFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 20 },
      android: { elevation: 24 }, default: {},
    }),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  headerLine: { flex: 1, height: 1, backgroundColor: 'rgba(0,255,255,0.2)' },
  title: { fontFamily: 'PressStart2P_400Regular', fontSize: 11, color: '#00FFFF', textAlign: 'center', letterSpacing: 2 },
  idRow: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: 'rgba(0,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(0,255,255,0.15)', gap: 5,
  },
  idLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 },
  idValue: { fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: '#00FFFF', letterSpacing: 0.5 },
  copyHint: { fontFamily: 'PressStart2P_400Regular', fontSize: 5, color: 'rgba(255,255,255,0.25)', letterSpacing: 0.5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    width: '47%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 10, paddingHorizontal: 10, gap: 6,
  },
  statLabel: { fontFamily: 'PressStart2P_400Regular', fontSize: 6, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 },
  statValue: { fontFamily: 'PressStart2P_400Regular', fontSize: 9, color: '#FFFFFF', letterSpacing: 0.5 },
  statValueCyan: { fontFamily: 'PressStart2P_400Regular', fontSize: 10, color: '#00FFFF', letterSpacing: 0.5 },
  statDim: { color: 'rgba(255,255,255,0.35)' },
  typeBadgeRow: { alignItems: 'center' },
  typeBadge: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1 },
  typeSol: { backgroundColor: 'rgba(0,255,136,0.1)', borderColor: 'rgba(0,255,136,0.3)' },
  typeSeeker: { backgroundColor: 'rgba(191,95,255,0.1)', borderColor: 'rgba(191,95,255,0.3)' },
  typePractice: { backgroundColor: 'rgba(255,215,0,0.1)', borderColor: 'rgba(255,215,0,0.3)' },
  typeBadgeText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: '#FFFFFF', letterSpacing: 2 },
  closeBtn: {
    alignItems: 'center', paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  closeBtnText: { fontFamily: 'PressStart2P_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: 2 },
});

// Leave-confirmation modal styles
const MAGNIFY_W = 110;
const MAGNIFY_H = 157;

const mgStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', zIndex: 999,
  },
  cardWrap: {
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,215,0,0.6)',
    ...Platform.select({
      ios: { shadowColor: gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12 },
      android: { elevation: 16 }, default: {},
    }),
  },
  card: { width: MAGNIFY_W, height: MAGNIFY_H, borderRadius: 8 },
});

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
