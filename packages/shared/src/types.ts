// ─────────────────────────────────────────────────────────────────────────────
// Cards  (mirror of apps/mobile/constants/poker.ts so frontend can import here)
// ─────────────────────────────────────────────────────────────────────────────

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface CardValue {
  suit: Suit;
  rank: Rank;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game phases & actions
// ─────────────────────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'countdown' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

// ─────────────────────────────────────────────────────────────────────────────
// Table config
// ─────────────────────────────────────────────────────────────────────────────

export interface TableConfig {
  /** All monetary values are in lamports (1 SOL = 1_000_000_000 lamports) */
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;        // always 6 for predefined tables
  turnTimeoutMs: number;     // default 30_000
  seed?: string;             // injected for deterministic shuffle

  // ── Web3-ready fields ──────────────────────────────────────────────────────
  /** Solana token mint address. 'SOL' = native SOL, SPL mint address otherwise */
  tokenMint: string;
  /** Premium tables require higher buy-ins; used for UI badging + future gating */
  isPremium: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seat view (what clients see about each seat – cards filtered per recipient)
// ─────────────────────────────────────────────────────────────────────────────

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
  currentBet: number;   // amount bet in this betting round
  /** Hole cards: present only for recipient or at showdown */
  holeCards: (CardValue | null)[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Side pot (produced when a player goes all-in)
// ─────────────────────────────────────────────────────────────────────────────

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Full filtered state snapshot sent to ONE player
// ─────────────────────────────────────────────────────────────────────────────

export interface TableStatePayload {
  tableId: string;
  phase: GamePhase;

  /** 6 slots – null means empty seat */
  seats: (SeatView | null)[];

  communityCards: (CardValue | null)[];   // always length 5, nulls for undealt
  pot: number;
  sidePots: SidePot[];
  currentBet: number;                     // highest bet on the table this round
  minRaise: number;
  maxRaise: number;                       // recipient's remaining chips

  activePlayerSeatIndex: number | null;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;

  /** UTC ms when the active player's clock expires – null if not their turn */
  turnTimeoutAt: number | null;

  /** Seconds remaining in pre-game countdown (only set when phase === 'countdown') */
  countdownSeconds: number;

  // ── Recipient-specific ──────────────────────────────────────────────────
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;

  // Table metadata
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TableInfo – lobby listing
// ─────────────────────────────────────────────────────────────────────────────

export interface TableInfo {
  id: string;
  name: string;
  creator: string;
  /** All monetary values in lamports */
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  playerCount: number;
  maxPlayers: number;
  phase: GamePhase;
  tokenMint: string;
  isPremium: boolean;
  /** True for server-bootstrapped tables that persist when empty */
  isPersistent: boolean;
  /** Which seat indices are currently occupied (0-indexed) */
  occupiedSeats: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Action log entry (for provable fairness / audit trail)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionLogEntry {
  handId: string;
  sequence: number;
  timestamp: number;
  playerId: string;
  action: PlayerAction;
  amount: number;
  phase: GamePhase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Showdown result
// ─────────────────────────────────────────────────────────────────────────────

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
  seed: string;           // revealed post-hand for provable fairness
  actionLog: ActionLogEntry[];
}
