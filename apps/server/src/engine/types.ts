import type {
  CardValue,
  GamePhase,
  PlayerAction,
  SidePot,
  ActionLogEntry,
  TableConfig,
} from '@goldenflop/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Internal engine types – never leave the server boundary
// ─────────────────────────────────────────────────────────────────────────────

export interface EnginePlayer {
  id: string;
  seatIndex: number;
  name: string;
  chips: number;
  holeCards: [CardValue, CardValue] | null;
  /** Amount bet in the current betting round */
  currentBet: number;
  /** Total contributed to pot this hand */
  totalContributed: number;
  isFolded: boolean;
  isAllIn: boolean;
  /** True once the player has voluntarily acted in the current round */
  hasActed: boolean;
  isConnected: boolean;
}

export interface HandState {
  handId: string;
  seed: string;
  phase: GamePhase;
  deck: CardValue[];
  players: EnginePlayer[];            // only seated, active players
  communityCards: CardValue[];        // 0–5 cards
  pot: number;                        // total chips in pot (all rounds)
  sidePots: SidePot[];
  /** Highest bet placed in the current betting round */
  currentBet: number;
  /** Index into players[] whose turn it is */
  activePlayerIndex: number;
  dealerIndex: number;                // index into players[]
  smallBlindIndex: number;
  bigBlindIndex: number;
  config: TableConfig;
  actionLog: ActionLogEntry[];
  actionSequence: number;
  /** Whether this hand has finished */
  isComplete: boolean;
  /** Size of the last bet or raise in this betting round (used for min-raise calculation) */
  lastRaiseSize: number;
}

export interface ActionResult {
  state: HandState;
  /** True when the betting round is over and phase should advance */
  roundComplete: boolean;
  /** True when the entire hand is complete (everyone folded or showdown done) */
  handComplete: boolean;
  /** The validated amount used (0 for fold/check) */
  amount: number;
}
