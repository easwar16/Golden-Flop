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
  player_action: (payload: PlayerActionPayload) => void;
  request_tables: () => void;
  /** Preferred alias for request_tables — returns the same tables_list event */
  get_tables: () => void;
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

export interface ErrorPayload {
  code: string;
  message: string;
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
  /** Error back to the requesting socket */
  error: (payload: ErrorPayload) => void;
  /** Sent on reconnect — same shape as table_state */
  reconnect_state: (payload: TableStatePayload) => void;
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
