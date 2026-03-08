export declare const SUITS: readonly ["♠", "♥", "♦", "♣"];
export declare const RANKS: readonly ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export interface CardValue {
    suit: Suit;
    rank: Rank;
}
export type GamePhase = 'waiting' | 'countdown' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';
export interface TableConfig {
    /** All monetary values are in lamports (1 SOL = 1_000_000_000 lamports) */
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
    maxPlayers: number;
    turnTimeoutMs: number;
    seed?: string;
    /** Solana token mint address. 'SOL' = native SOL, SPL mint address otherwise */
    tokenMint: string;
    /** Premium tables require higher buy-ins; used for UI badging + future gating */
    isPremium: boolean;
    /** Practice tables use free chips — no wallet or balance required */
    isPractice?: boolean;
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
    /** UTC ms when the player will be removed if they don't return (null if not sitting out) */
    sitOutTimeoutAt: number | null;
    currentBet: number;
    /** Hole cards: present only for recipient or at showdown */
    holeCards: (CardValue | null)[];
}
export interface SidePot {
    amount: number;
    eligiblePlayerIds: string[];
}
export interface TableStatePayload {
    tableId: string;
    phase: GamePhase;
    /** 6 slots – null means empty seat */
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
    /** UTC ms when the active player's clock expires – null if not their turn */
    turnTimeoutAt: number | null;
    /** Turn duration in ms – varies by table speed (slow=45s, normal=30s, fast=15s) */
    turnTimeoutMs: number;
    /** Seconds remaining in pre-game countdown (only set when phase === 'countdown') */
    countdownSeconds: number;
    mySeatIndex: number | null;
    myHand: (CardValue | null)[];
    isMyTurn: boolean;
    myChips: number;
    reservedSeats: {
        seatIndex: number;
        playerId: string;
        playerName: string;
        avatarSeed: string;
    }[];
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
    /** Token type for this table */
    tokenType?: 'SOL' | 'SEEKER';
    /** Server's Date.now() when this payload was built – used to correct client clock skew */
    serverTime: number;
}
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
    /** Turn timeout in milliseconds — drives the lobby speed label */
    turnTimeoutMs: number;
    /** Practice tables use free chips — no wallet required */
    isPractice: boolean;
    /** True for server-bootstrapped tables that persist when empty */
    isPersistent: boolean;
    /** Which seat indices are currently occupied (0-indexed) */
    occupiedSeats: number[];
    /** Which seat indices are reserved (pre-wallet-tx lock) */
    reservedSeats: number[];
    /** Token type for this table */
    tokenType?: 'SOL' | 'SEEKER';
}
export interface ActionLogEntry {
    handId: string;
    sequence: number;
    timestamp: number;
    playerId: string;
    action: PlayerAction;
    amount: number;
    phase: GamePhase;
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
    actionLog: ActionLogEntry[];
}
