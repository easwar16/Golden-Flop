/**
 * GameEngine – pure poker logic.
 *
 * Rules:
 *  - All functions are STATELESS: they receive a state and return a new state.
 *  - No I/O, no timers, no socket references.
 *  - The Room layer owns state and calls these functions.
 */

import { v4 as uuid } from 'uuid';
import type {
  CardValue,
  GamePhase,
  PlayerAction,
  SidePot,
  TableConfig,
  PlayerShowdownResult,
  HandResultPayload,
} from '@goldenflop/shared';
import { buildShuffledDeck, drawCard } from './Deck';
import { evaluateBestHand, compareHands } from './HandEvaluator';
import type { HandState, EnginePlayer, ActionResult } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Hand initialisation
// ─────────────────────────────────────────────────────────────────────────────

export interface SeatInput {
  id: string;
  seatIndex: number;
  name: string;
  chips: number;
}

/**
 * Create the initial HandState for a new hand.
 * dealerSeatIndex indicates which *seat* holds the dealer button this hand.
 */
export function createHand(
  seats: SeatInput[],
  config: TableConfig,
  dealerSeatIndex: number,
  seed: string,
): HandState {
  if (seats.length < 2) throw new Error('Need at least 2 players to start a hand');

  const players: EnginePlayer[] = seats.map(s => ({
    id: s.id,
    seatIndex: s.seatIndex,
    name: s.name,
    chips: s.chips,
    holeCards: null,
    currentBet: 0,
    totalContributed: 0,
    isFolded: false,
    isAllIn: false,
    hasActed: false,
    isConnected: true,
  }));

  const dealerIndex = players.findIndex(p => p.seatIndex === dealerSeatIndex)
    ?? 0;

  // Heads-up: SB = dealer; normal: SB = dealer + 1
  const n = players.length;
  const smallBlindIndex = n === 2 ? dealerIndex : (dealerIndex + 1) % n;
  const bigBlindIndex = (smallBlindIndex + 1) % n;

  const deck = buildShuffledDeck(seed);

  return {
    handId: uuid(),
    seed,
    phase: 'preflop',
    deck,
    players,
    communityCards: [],
    pot: 0,
    sidePots: [],
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    activePlayerIndex: 0,       // set properly in postBlinds
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    config,
    actionLog: [],
    actionSequence: 0,
    isComplete: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Posting blinds  (call immediately after createHand)
// ─────────────────────────────────────────────────────────────────────────────

export function postBlinds(state: HandState): HandState {
  let s = { ...state, players: state.players.map(p => ({ ...p })) };

  s = applyBet(s, s.smallBlindIndex, s.config.smallBlind, false);
  s = applyBet(s, s.bigBlindIndex, s.config.bigBlind, false);

  // First to act preflop is the player after the big blind
  const n = s.players.length;
  s.activePlayerIndex = (s.bigBlindIndex + 1) % n;

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dealing cards
// ─────────────────────────────────────────────────────────────────────────────

export function dealHoleCards(state: HandState): HandState {
  const deck = [...state.deck];
  const players = state.players.map(p => {
    const c1 = deck.pop()!;
    const c2 = deck.pop()!;
    return { ...p, holeCards: [c1, c2] as [CardValue, CardValue] };
  });
  return { ...state, deck, players };
}

export function dealFlop(state: HandState): HandState {
  const deck = [...state.deck];
  deck.pop(); // burn
  const communityCards = [deck.pop()!, deck.pop()!, deck.pop()!];
  return { ...state, deck, communityCards, phase: 'flop' };
}

export function dealTurn(state: HandState): HandState {
  const deck = [...state.deck];
  deck.pop(); // burn
  const communityCards = [...state.communityCards, deck.pop()!];
  return { ...state, deck, communityCards, phase: 'turn' };
}

export function dealRiver(state: HandState): HandState {
  const deck = [...state.deck];
  deck.pop(); // burn
  const communityCards = [...state.communityCards, deck.pop()!];
  return { ...state, deck, communityCards, phase: 'river' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action processing
// ─────────────────────────────────────────────────────────────────────────────

export function processAction(
  state: HandState,
  playerId: string,
  action: PlayerAction,
  raiseAmount?: number,
): ActionResult {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex < 0) throw new Error(`Player ${playerId} not in hand`);
  if (playerIndex !== state.activePlayerIndex) {
    throw new Error('Not this player\'s turn');
  }

  const player = state.players[playerIndex];
  if (player.isFolded || player.isAllIn) {
    throw new Error('Player cannot act: folded or all-in');
  }

  let s = { ...state, players: state.players.map(p => ({ ...p })) };
  let amount = 0;

  switch (action) {
    case 'fold': {
      s.players[playerIndex].isFolded = true;
      s.players[playerIndex].hasActed = true;
      break;
    }

    case 'check': {
      if (s.currentBet > s.players[playerIndex].currentBet) {
        throw new Error('Cannot check when there is a bet to call');
      }
      s.players[playerIndex].hasActed = true;
      break;
    }

    case 'call': {
      if (s.players[playerIndex].chips <= 0) {
        throw new Error('Cannot call with zero balance');
      }
      const toCall = Math.min(
        s.currentBet - s.players[playerIndex].currentBet,
        s.players[playerIndex].chips,
      );
      amount = toCall;
      s = applyBet(s, playerIndex, toCall, false);
      s.players[playerIndex].hasActed = true;
      break;
    }

    case 'raise': {
      if (s.players[playerIndex].chips <= 0) {
        throw new Error('Cannot raise with zero balance');
      }
      if (raiseAmount === undefined) throw new Error('raise requires an amount');
      const minRaise = calcMinRaise(s);
      const maxRaise = s.players[playerIndex].chips;
      if (raiseAmount < minRaise && raiseAmount < maxRaise) {
        throw new Error(`Raise must be at least ${minRaise}`);
      }
      const clamped = Math.min(raiseAmount, maxRaise);
      amount = clamped;
      // Reset hasActed for all other non-folded, non-all-in players
      s.players.forEach((p, i) => {
        if (i !== playerIndex && !p.isFolded && !p.isAllIn) {
          p.hasActed = false;
        }
      });
      s = applyBet(s, playerIndex, clamped, true);
      s.players[playerIndex].hasActed = true;
      break;
    }

    case 'all-in': {
      if (s.players[playerIndex].chips <= 0) {
        throw new Error('Cannot go all-in with zero balance');
      }
      const allInAmount = s.players[playerIndex].chips;
      amount = allInAmount;
      const isRaise = allInAmount + s.players[playerIndex].currentBet > s.currentBet;
      if (isRaise) {
        s.players.forEach((p, i) => {
          if (i !== playerIndex && !p.isFolded && !p.isAllIn) {
            p.hasActed = false;
          }
        });
      }
      s = applyBet(s, playerIndex, allInAmount, isRaise);
      s.players[playerIndex].isAllIn = true;
      s.players[playerIndex].hasActed = true;
      break;
    }
  }

  // Log action
  s.actionLog = [
    ...s.actionLog,
    {
      handId: s.handId,
      sequence: ++s.actionSequence,
      timestamp: Date.now(),
      playerId,
      action,
      amount,
      phase: s.phase,
    },
  ];

  // Recalculate side pots if anyone is all-in
  s.sidePots = calculateSidePots(s.players);

  // Check round/hand completion
  const activePlayers = s.players.filter(p => !p.isFolded);
  const handComplete = activePlayers.length === 1 ||
    (s.phase === 'showdown' && activePlayers.every(p => p.isAllIn || p.hasActed));

  if (handComplete) {
    s.isComplete = true;
    return { state: s, roundComplete: true, handComplete: true, amount };
  }

  const roundComplete = isBettingRoundComplete(s);
  if (!roundComplete) {
    s.activePlayerIndex = nextActivePlayer(s, playerIndex);
  }

  return { state: s, roundComplete, handComplete: false, amount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase advancement  (call after roundComplete === true)
// ─────────────────────────────────────────────────────────────────────────────

export function advancePhase(state: HandState): HandState {
  let s = resetBettingRound(state);

  switch (state.phase) {
    case 'preflop': s = dealFlop(s); break;
    case 'flop':    s = dealTurn(s); break;
    case 'turn':    s = dealRiver(s); break;
    case 'river':   s = { ...s, phase: 'showdown' as GamePhase }; break;
    default: break;
  }

  // First to act post-flop is left of dealer (skip folded/all-in)
  const n = s.players.length;
  let firstActor = (s.dealerIndex + 1) % n;
  for (let i = 0; i < n; i++) {
    const idx = (firstActor + i) % n;
    if (!s.players[idx].isFolded && !s.players[idx].isAllIn) {
      firstActor = idx;
      break;
    }
  }
  s.activePlayerIndex = firstActor;

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Showdown  (call when handComplete === true or after advancePhase to showdown)
// ─────────────────────────────────────────────────────────────────────────────

export function resolveShowdown(state: HandState): HandResultPayload {
  const activePlayers = state.players.filter(p => !p.isFolded);

  // If only one player remains (everyone else folded), they win the whole pot
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    return buildHandResult(state, [
      {
        playerId: winner.id,
        seatIndex: winner.seatIndex,
        name: winner.name,
        holeCards: winner.holeCards ?? [],
        bestHandName: 'Last Player Standing',
        bestHandCards: [],
        winAmount: state.pot,
        isWinner: true,
      },
    ]);
  }

  // Evaluate all active players
  const evaluated = activePlayers.map(p => {
    const allCards = [...(p.holeCards ?? []), ...state.communityCards];
    const hand = evaluateBestHand(allCards);
    return { player: p, hand };
  });

  // Calculate side pot winners
  const pots = state.sidePots.length > 0
    ? state.sidePots
    : [{ amount: state.pot, eligiblePlayerIds: activePlayers.map(p => p.id) }];

  const winAmounts: Record<string, number> = {};
  activePlayers.forEach(p => { winAmounts[p.id] = 0; });

  for (const pot of pots) {
    const eligible = evaluated.filter(e =>
      pot.eligiblePlayerIds.includes(e.player.id)
    );
    if (eligible.length === 0) continue;

    eligible.sort((a, b) => compareHands(b.hand, a.hand));
    const bestHandRank = eligible[0].hand.rank;
    const winners = eligible.filter(
      e => compareHands(e.hand, eligible[0].hand) === 0
    );

    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    winners.forEach((w, i) => {
      winAmounts[w.player.id] += share + (i === 0 ? remainder : 0);
    });
  }

  const results: PlayerShowdownResult[] = activePlayers.map(p => {
    const e = evaluated.find(ev => ev.player.id === p.id)!;
    return {
      playerId: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      holeCards: p.holeCards ?? [],
      bestHandName: e.hand.name,
      bestHandCards: e.hand.cards,
      winAmount: winAmounts[p.id] ?? 0,
      isWinner: (winAmounts[p.id] ?? 0) > 0,
    };
  });

  return buildHandResult(state, results);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-fold (call when a player's turn timer expires)
// ─────────────────────────────────────────────────────────────────────────────

export function autoFold(state: HandState, playerId: string): ActionResult {
  return processAction(state, playerId, 'fold');
}

// ─────────────────────────────────────────────────────────────────────────────
// Getters
// ─────────────────────────────────────────────────────────────────────────────

export function calcMinRaise(state: HandState): number {
  // Min raise = current bet + size of last raise (no-limit Texas Hold'em rule)
  return state.currentBet + state.lastRaiseSize;
}

export function activePlayer(state: HandState): EnginePlayer | null {
  return state.players[state.activePlayerIndex] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rake calculation (pure function)
// ─────────────────────────────────────────────────────────────────────────────

export interface RakeResult {
  /** Pot after rake deduction */
  playerPot: number;
  /** Rake collected by the house */
  rakeAmount: number;
}

/**
 * Calculate rake from the total pot.
 *
 * @param pot            Total pot in lamports
 * @param rakePercentage Rake percentage (e.g. 2.5 = 2.5%)
 * @param rakeCap        Maximum rake per hand in lamports (0 = no cap)
 */
export function applyRake(
  pot: number,
  rakePercentage: number,
  rakeCap: number = 0,
): RakeResult {
  if (rakePercentage <= 0 || pot <= 0) {
    return { playerPot: pot, rakeAmount: 0 };
  }

  let rakeAmount = Math.floor(pot * (rakePercentage / 100));
  if (rakeCap > 0 && rakeAmount > rakeCap) {
    rakeAmount = rakeCap;
  }

  return {
    playerPot: pot - rakeAmount,
    rakeAmount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function applyBet(
  state: HandState,
  playerIndex: number,
  amount: number,
  isRaise: boolean,
): HandState {
  const s = { ...state, players: state.players.map(p => ({ ...p })) };
  const player = s.players[playerIndex];
  const actualAmount = Math.min(amount, player.chips);

  player.chips -= actualAmount;
  player.currentBet += actualAmount;
  player.totalContributed += actualAmount;
  s.pot += actualAmount;

  if (isRaise || player.currentBet > s.currentBet) {
    const raiseSize = player.currentBet - s.currentBet;
    s.lastRaiseSize = Math.max(raiseSize, s.config.bigBlind);
    s.currentBet = player.currentBet;
  }

  return s;
}

function isBettingRoundComplete(state: HandState): boolean {
  const active = state.players.filter(p => !p.isFolded && !p.isAllIn);
  if (active.length === 0) return true;
  return active.every(p => p.hasActed && p.currentBet === state.currentBet);
}

function nextActivePlayer(state: HandState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    const p = state.players[idx];
    if (!p.isFolded && !p.isAllIn) return idx;
  }
  return fromIndex;
}

function resetBettingRound(state: HandState): HandState {
  return {
    ...state,
    currentBet: 0,
    lastRaiseSize: state.config.bigBlind,
    players: state.players.map(p => ({
      ...p,
      currentBet: 0,
      hasActed: false,
    })),
  };
}

function calculateSidePots(players: EnginePlayer[]): SidePot[] {
  const allInContribs = players
    .filter(p => p.isAllIn)
    .map(p => p.totalContributed)
    .sort((a, b) => a - b);

  if (allInContribs.length === 0) return [];

  const sidePots: SidePot[] = [];
  let prevCap = 0;

  for (const cap of [...new Set(allInContribs)]) {
    const amount = players.reduce((sum, p) => {
      return sum + Math.min(Math.max(p.totalContributed - prevCap, 0), cap - prevCap);
    }, 0);
    const eligible = players
      .filter(p => !p.isFolded && p.totalContributed >= cap)
      .map(p => p.id);
    sidePots.push({ amount, eligiblePlayerIds: eligible });
    prevCap = cap;
  }

  // Main pot (remaining after all-in levels)
  const mainAmount = players.reduce((sum, p) => {
    return sum + Math.max(p.totalContributed - prevCap, 0);
  }, 0);
  if (mainAmount > 0) {
    const eligible = players.filter(p => !p.isFolded).map(p => p.id);
    sidePots.push({ amount: mainAmount, eligiblePlayerIds: eligible });
  }

  return sidePots;
}

function buildHandResult(
  state: HandState,
  results: PlayerShowdownResult[],
): HandResultPayload {
  return {
    tableId: '',           // filled in by Room
    handId: state.handId,
    winners: results.filter(r => r.isWinner),
    allPlayers: results,
    pot: state.pot,
    sidePots: state.sidePots,
    seed: state.seed,
    actionLog: state.actionLog,
  };
}
