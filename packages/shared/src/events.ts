import type {
  TableStatePayload,
  TableInfo,
  HandResultPayload,
  PlayerAction,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Client → Server
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTablePayload {
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers?: number;
  turnTimeoutMs?: number;
}

export interface JoinTablePayload {
  tableId: string;
  buyIn: number;
  playerName: string;
}

/** Sit at a specific numbered seat (0–5). Auto-assigns if seatIndex omitted. */
export interface SitAtSeatPayload {
  tableId: string;
  seatIndex?: number;   // undefined = auto-assign first available
  buyIn: number;        // in lamports
  avatarSeed?: string;  // override handshake value with current store value
  playerName?: string;  // override handshake value with current store value
}

/** Reserve a seat before initiating a wallet transaction. */
export interface ReserveSeatPayload {
  tableId: string;
  seatIndex: number;
}

/** Release a previously reserved seat (cancel / tx failure). */
export interface ReleaseSeatPayload {
  tableId: string;
  seatIndex: number;
}

export interface LeaveTablePayload {
  tableId: string;
}

export interface PlayerActionPayload {
  tableId: string;
  action: PlayerAction;
  /** Required for 'raise'. Ignored otherwise. */
  amount?: number;
}

export interface ClientToServerEvents {
  create_table: (payload: CreateTablePayload, ack: (tableId: string) => void) => void;
  join_table: (payload: JoinTablePayload, ack: (err: string | null) => void) => void;
  /**
   * Sit at a predefined table seat.
   * ACK returns { seatIndex } on success or { error: string } on failure.
   */
  sit_at_seat: (payload: SitAtSeatPayload, ack: (res: { seatIndex: number } | { error: string }) => void) => void;
  leave_table: (payload: LeaveTablePayload) => void;
  /** Reserve a seat before wallet tx. ACK returns { ok: true } or { error: string }. */
  reserve_seat: (payload: ReserveSeatPayload, ack: (res: { ok: true } | { error: string }) => void) => void;
  /** Release a previously reserved seat. */
  release_seat: (payload: ReleaseSeatPayload) => void;
  player_action: (payload: PlayerActionPayload) => void;
  /** Player returns from sitting out */
  return_to_table: (payload: { tableId: string }) => void;
  request_tables: () => void;
  /** Preferred alias for request_tables — returns the same tables_list event */
  get_tables: () => void;
  /** Stop receiving periodic lobby updates (when entering a table). */
  leave_lobby: () => void;
  /** Spectate a table — server responds with table_state (no hole cards) */
  watch_table: (payload: { tableId: string }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server → Client
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerJoinedPayload {
  tableId: string;
  playerId: string;
  playerName: string;
  seatIndex: number;
  chips: number;
}

export interface PlayerLeftPayload {
  tableId: string;
  playerId: string;
  seatIndex: number;
}

export interface TurnStartPayload {
  tableId: string;
  playerId: string;
  seatIndex: number;
  timeoutAt: number;    // UTC ms
  minRaise: number;
  maxRaise: number;
  callAmount: number;
}

export interface ActionAckPayload {
  tableId: string;
  playerId: string;
  action: PlayerAction;
  amount: number;
}

export interface PlayerKickedPayload {
  tableId: string;
  reason: string;
}

export interface PlayerSitOutPayload {
  tableId: string;
  playerId: string;
  seatIndex: number;
  /** UTC ms when the player will be removed from the table */
  timeoutAt: number;
}

export interface PlayerReturnedPayload {
  tableId: string;
  playerId: string;
  seatIndex: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface CashOutCompletePayload {
  tableId: string;
  /** Lamports returned to the player's wallet */
  amount: number;
  /** On-chain transaction signature (null if payout failed) */
  txSignature: string | null;
}

export interface ServerToClientEvents {
  /** Full filtered state — sent to each player individually after any change */
  table_state: (payload: TableStatePayload) => void;
  /** Lobby listing */
  tables_list: (tables: TableInfo[]) => void;
  /** Emitted when a new hand starts */
  game_started: (payload: { tableId: string; handId: string }) => void;
  /** Emitted at showdown / hand end */
  hand_result: (payload: HandResultPayload) => void;
  /** Broadcast to room when someone joins */
  player_joined: (payload: PlayerJoinedPayload) => void;
  /** Broadcast to room when someone leaves */
  player_left: (payload: PlayerLeftPayload) => void;
  /** Sent only to the player whose turn it is */
  turn_start: (payload: TurnStartPayload) => void;
  /** Echo of processed action — confirms it landed */
  action_ack: (payload: ActionAckPayload) => void;
  /** A seat has been reserved (pre-wallet-tx lock) */
  seat_reserved: (payload: { tableId: string; seatIndex: number; playerId: string; playerName: string; avatarSeed: string }) => void;
  /** A reserved seat has been released */
  seat_released: (payload: { tableId: string; seatIndex: number }) => void;
  /** Sent to a player who has been removed from the table (e.g. busted out) */
  player_kicked: (payload: PlayerKickedPayload) => void;
  /** Broadcast when a player enters sit-out state */
  player_sitting_out: (payload: PlayerSitOutPayload) => void;
  /** Broadcast when a sitting-out player returns */
  player_returned: (payload: PlayerReturnedPayload) => void;
  /** Error back to the requesting socket */
  error: (payload: ErrorPayload) => void;
  /** Sent on reconnect — same shape as table_state */
  reconnect_state: (payload: TableStatePayload) => void;
  /** Sent to the leaving player after vault cash-out completes */
  cash_out_complete: (payload: CashOutCompletePayload) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inter-server room events (if you later add clustering)
// ─────────────────────────────────────────────────────────────────────────────

export interface InterServerEvents {
  ping: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-socket data attached by middleware
// ─────────────────────────────────────────────────────────────────────────────

export interface SocketData {
  playerId: string;
  playerName: string;
  currentTableId: string | null;
}
