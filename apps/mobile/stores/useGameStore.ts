/**
 * useGameStore – single source of truth for the active poker hand.
 *
 * Populated exclusively by server `table_state` and `hand_result` events.
 * Components must NEVER mutate this directly – dispatch through SocketService.
 *
 * Separated slices:
 *  - networkSlice  : server-authoritative data mirrored from TableStatePayload
 *  - uiSlice       : local-only state (card peek, raise input, last hand result)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ─── Shared types (mirrors @goldenflop/shared without adding a dep) ──────────

export type GamePhase =
  | 'waiting'
  | 'countdown'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown';

export interface CardValue {
  suit: '♠' | '♥' | '♦' | '♣';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
}

export interface SeatView {
  seatIndex: number;
  playerId: string;
  name: string;
  avatarSeed: string;
  chips: number;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  isConnected: boolean;
  /** Player is sitting out (timed out or disconnected, waiting to return) */
  isSittingOut: boolean;
  /** UTC ms when the player will be removed if they don't return */
  sitOutTimeoutAt: number | null;
  currentBet: number;
  holeCards: (CardValue | null)[];
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface ReservedSeatInfo {
  seatIndex: number;
  playerId: string;
  playerName: string;
  avatarSeed: string;
}

export interface TableStatePayload {
  tableId: string;
  phase: GamePhase;
  countdownSeconds: number;
  seats: (SeatView | null)[];
  communityCards: (CardValue | null)[];
  pot: number;
  sidePots: SidePot[];
  currentBet: number;
  minRaise: number;
  maxRaise: number;
  activePlayerSeatIndex: number | null;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  turnTimeoutAt: number | null;
  turnTimeoutMs?: number;
  serverTime: number;
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  reservedSeats?: ReservedSeatInfo[];
  tokenType?: 'SOL' | 'SEEKER';
}

export interface PlayerShowdownResult {
  playerId: string;
  seatIndex: number;
  name: string;
  holeCards: CardValue[];
  bestHandName: string;
  bestHandCards: CardValue[];
  winAmount: number;
  isWinner: boolean;
}

export interface HandResultPayload {
  tableId: string;
  handId: string;
  winners: PlayerShowdownResult[];
  allPlayers: PlayerShowdownResult[];
  pot: number;
  sidePots: SidePot[];
  seed: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface NetworkSlice {
  tableId: string | null;
  phase: GamePhase;
  countdownSeconds: number;
  seats: (SeatView | null)[];
  communityCards: (CardValue | null)[];
  pot: number;
  sidePots: SidePot[];
  currentBet: number;
  minRaise: number;
  maxRaise: number;
  activePlayerSeatIndex: number | null;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  turnTimeoutAt: number | null;
  turnTimeoutMs: number;
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  reservedSeats: ReservedSeatInfo[];
  tokenType: 'SOL' | 'SEEKER' | null;
}

export interface EmojiReactionInfo {
  emoji: string;
  id: string; // unique key for animation re-trigger
}

interface UISlice {
  /** True while we're in the join/create flow before first table_state arrives */
  isJoining: boolean;
  /** Controls local card peek animation — never sent to server */
  holeCardsRevealed: [boolean, boolean];
  /** Last raise value typed in the input */
  raiseAmount: number;
  /** Result of the last finished hand, shown in overlay */
  lastHandResult: HandResultPayload | null;
  /** Non-null when the player was kicked from the table (e.g. busted out) */
  kickedReason: string | null;
  /** Active emoji reactions per seat (auto-cleared after animation) */
  emojiReactions: Record<number, EmojiReactionInfo | null>;
}

interface GameActions {
  // Called by SocketService only
  applyTableState: (payload: TableStatePayload) => void;
  applyHandResult: (payload: HandResultPayload) => void;
  setIsJoining: (joining: boolean) => void;
  addReservation: (info: ReservedSeatInfo) => void;
  removeReservation: (seatIndex: number) => void;

  // Local UI – safe to call from components
  setHoleCardRevealed: (index: 0 | 1, revealed: boolean) => void;
  setRaiseAmount: (amount: number) => void;
  dismissHandResult: () => void;
  reset: () => void;
  /** Optimistically clears isMyTurn after dispatching an action to prevent double-sends */
  clearMyTurn: () => void;
  /** Set when the player is kicked from the table */
  setKicked: (reason: string) => void;
  clearKicked: () => void;
  /** Add an emoji reaction at a seat (auto-clears after 3s) */
  addEmojiReaction: (seatIndex: number, emoji: string) => void;
}

const EMPTY_SEATS = Array(6).fill(null) as (SeatView | null)[];
const EMPTY_COMMUNITY = Array(5).fill(null) as (CardValue | null)[];

const defaultNetworkSlice: NetworkSlice = {
  tableId: null,
  phase: 'waiting',
  countdownSeconds: 0,
  seats: EMPTY_SEATS,
  communityCards: EMPTY_COMMUNITY,
  pot: 0,
  sidePots: [],
  currentBet: 0,
  minRaise: 0,
  maxRaise: 0,
  activePlayerSeatIndex: null,
  dealerSeatIndex: 0,
  smallBlindSeatIndex: 0,
  bigBlindSeatIndex: 0,
  turnTimeoutAt: null,
  turnTimeoutMs: 30_000,
  mySeatIndex: null,
  myHand: [null, null],
  isMyTurn: false,
  myChips: 0,
  smallBlind: 0,
  bigBlind: 0,
  minBuyIn: 0,
  maxBuyIn: 0,
  reservedSeats: [],
  tokenType: null,
};

const defaultUISlice: UISlice = {
  isJoining: false,
  holeCardsRevealed: [false, false],
  raiseAmount: 0,
  lastHandResult: null,
  kickedReason: null,
  emojiReactions: {},
};

export const useGameStore = create<NetworkSlice & UISlice & GameActions>()(
  subscribeWithSelector((set, get) => ({
    ...defaultNetworkSlice,
    ...defaultUISlice,

    // ── Network actions (SocketService only) ──────────────────────────────
    applyTableState: (payload) => {
      set({
        tableId: payload.tableId,
        phase: payload.phase,
        countdownSeconds: payload.countdownSeconds ?? 0,
        seats: payload.seats,
        communityCards: payload.communityCards,
        pot: payload.pot,
        sidePots: payload.sidePots,
        currentBet: payload.currentBet,
        minRaise: payload.minRaise,
        maxRaise: payload.maxRaise,
        activePlayerSeatIndex: payload.activePlayerSeatIndex,
        dealerSeatIndex: payload.dealerSeatIndex,
        smallBlindSeatIndex: payload.smallBlindSeatIndex,
        bigBlindSeatIndex: payload.bigBlindSeatIndex,
        // Adjust for client/server clock skew so the timer starts ticking immediately
        turnTimeoutAt: payload.turnTimeoutAt != null
          ? (payload.serverTime
              ? payload.turnTimeoutAt - payload.serverTime + Date.now()
              : payload.turnTimeoutAt)
          : null,
        turnTimeoutMs: payload.turnTimeoutMs,
        mySeatIndex: payload.mySeatIndex,
        myHand: payload.myHand,
        isMyTurn: payload.isMyTurn,
        myChips: payload.myChips,
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
        minBuyIn: payload.minBuyIn,
        maxBuyIn: payload.maxBuyIn,
        reservedSeats: payload.reservedSeats ?? [],
        tokenType: payload.tokenType ?? null,
        isJoining: false,
        // Reset raise amount to min on each new state if it's our turn
        raiseAmount: payload.isMyTurn ? Math.min(payload.minRaise, payload.maxRaise) : get().raiseAmount,
      });
    },

    applyHandResult: (payload) => set({ lastHandResult: payload }),

    setIsJoining: (isJoining) => set({ isJoining }),

    addReservation: (info) => set((s) => ({
      reservedSeats: [
        ...s.reservedSeats.filter(r => r.seatIndex !== info.seatIndex),
        info,
      ],
    })),

    removeReservation: (seatIndex) => set((s) => ({
      reservedSeats: s.reservedSeats.filter(r => r.seatIndex !== seatIndex),
    })),

    // ── UI actions ────────────────────────────────────────────────────────
    setHoleCardRevealed: (index, revealed) =>
      set((s) => {
        const next: [boolean, boolean] = [...s.holeCardsRevealed] as [boolean, boolean];
        next[index] = revealed;
        return { holeCardsRevealed: next };
      }),

    setRaiseAmount: (raiseAmount) => set({ raiseAmount }),

    clearMyTurn: () => set({ isMyTurn: false }),

    dismissHandResult: () => set({ lastHandResult: null }),

    setKicked: (reason) => set({ kickedReason: reason }),
    clearKicked: () => set({ kickedReason: null }),

    addEmojiReaction: (seatIndex, emoji) => {
      const id = `${seatIndex}-${Date.now()}`;
      set((s) => ({
        emojiReactions: { ...s.emojiReactions, [seatIndex]: { emoji, id } },
      }));
      // Auto-clear after animation completes
      setTimeout(() => {
        const current = get().emojiReactions[seatIndex];
        if (current?.id === id) {
          set((s) => ({
            emojiReactions: { ...s.emojiReactions, [seatIndex]: null },
          }));
        }
      }, 3000);
    },

    reset: () => set({ ...defaultNetworkSlice, ...defaultUISlice }),
  }))
);

// ─── Derived selectors (call in components to minimise re-renders) ────────────

/** True if we are seated and a hand is in progress. */
export const selectIsInHand = (s: ReturnType<typeof useGameStore.getState>) =>
  s.mySeatIndex !== null && s.phase !== 'waiting';

/** Active seat view (the player whose turn it is). */
export const selectActiveSeat = (s: ReturnType<typeof useGameStore.getState>) =>
  s.activePlayerSeatIndex !== null ? s.seats[s.activePlayerSeatIndex] : null;

/** Own seat view. */
export const selectMySeat = (s: ReturnType<typeof useGameStore.getState>) =>
  s.mySeatIndex !== null ? s.seats[s.mySeatIndex] : null;
