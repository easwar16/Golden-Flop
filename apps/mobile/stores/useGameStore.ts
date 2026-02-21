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
  chips: number;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  isConnected: boolean;
  currentBet: number;
  holeCards: (CardValue | null)[];
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface TableStatePayload {
  tableId: string;
  phase: GamePhase;
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
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;
  smallBlind: number;
  bigBlind: number;
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
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;
  smallBlind: number;
  bigBlind: number;
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
}

interface GameActions {
  // Called by SocketService only
  applyTableState: (payload: TableStatePayload) => void;
  applyHandResult: (payload: HandResultPayload) => void;
  setIsJoining: (joining: boolean) => void;

  // Local UI – safe to call from components
  setHoleCardRevealed: (index: 0 | 1, revealed: boolean) => void;
  setRaiseAmount: (amount: number) => void;
  dismissHandResult: () => void;
  reset: () => void;
}

const EMPTY_SEATS = Array(6).fill(null) as (SeatView | null)[];
const EMPTY_COMMUNITY = Array(5).fill(null) as (CardValue | null)[];

const defaultNetworkSlice: NetworkSlice = {
  tableId: null,
  phase: 'waiting',
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
  mySeatIndex: null,
  myHand: [null, null],
  isMyTurn: false,
  myChips: 0,
  smallBlind: 0,
  bigBlind: 0,
};

const defaultUISlice: UISlice = {
  isJoining: false,
  holeCardsRevealed: [false, false],
  raiseAmount: 0,
  lastHandResult: null,
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
        turnTimeoutAt: payload.turnTimeoutAt,
        mySeatIndex: payload.mySeatIndex,
        myHand: payload.myHand,
        isMyTurn: payload.isMyTurn,
        myChips: payload.myChips,
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
        isJoining: false,
        // Reset raise amount to min on each new state if it's our turn
        raiseAmount: payload.isMyTurn ? payload.minRaise : get().raiseAmount,
      });
    },

    applyHandResult: (payload) => set({ lastHandResult: payload }),

    setIsJoining: (isJoining) => set({ isJoining }),

    // ── UI actions ────────────────────────────────────────────────────────
    setHoleCardRevealed: (index, revealed) =>
      set((s) => {
        const next: [boolean, boolean] = [...s.holeCardsRevealed] as [boolean, boolean];
        next[index] = revealed;
        return { holeCardsRevealed: next };
      }),

    setRaiseAmount: (raiseAmount) => set({ raiseAmount }),

    dismissHandResult: () => set({ lastHandResult: null }),

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
