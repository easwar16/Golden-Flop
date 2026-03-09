/**
 * BotPlayer – AI opponent for practice tables.
 *
 * Plugs into the Room as a normal RoomPlayer with a synthetic socket ID.
 * When it's the bot's turn, Room calls `scheduleBotAction()` which runs
 * the decision engine after a human-like delay and calls back with an action.
 */

import type { PlayerAction, CardValue, GamePhase } from '@goldenflop/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Bot identity
// ─────────────────────────────────────────────────────────────────────────────

let botCounter = 0;

export interface BotIdentity {
  id: string;
  socketId: string;
  name: string;
  avatarSeed: string;
}

export function createBotIdentity(): BotIdentity {
  const n = ++botCounter;
  return {
    id: `bot-${n}-${Date.now()}`,
    socketId: `bot-socket-${n}-${Date.now()}`,
    name: 'Practice Bot',
    avatarSeed: `bot-${n}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision engine
// ─────────────────────────────────────────────────────────────────────────────

export interface BotDecisionInput {
  holeCards: [CardValue, CardValue];
  communityCards: CardValue[];
  phase: GamePhase;
  pot: number;
  currentBet: number;
  myCurrentBet: number;
  myChips: number;
  bigBlind: number;
}

export interface BotDecision {
  action: PlayerAction;
  amount?: number;
}

/**
 * Simple poker decision engine.
 * Not meant to be strong — just believable enough for practice.
 */
export function decide(input: BotDecisionInput): BotDecision {
  const { holeCards, communityCards, phase, pot, currentBet, myCurrentBet, myChips, bigBlind } = input;
  const toCall = Math.min(currentBet - myCurrentBet, myChips);
  const canCheck = toCall === 0;

  if (phase === 'preflop') {
    return preflopDecision(holeCards, toCall, myChips, bigBlind, canCheck);
  }

  return postflopDecision(holeCards, communityCards, pot, toCall, myChips, bigBlind, canCheck);
}

// ─── Preflop strategy ────────────────────────────────────────────────────────

const PREMIUM_RANKS = new Set(['A', 'K', 'Q', 'J']);
const STRONG_RANKS = new Set(['A', 'K', 'Q', 'J', 'T', '9']);

function preflopDecision(
  cards: [CardValue, CardValue],
  toCall: number,
  chips: number,
  bigBlind: number,
  canCheck: boolean,
): BotDecision {
  const [c1, c2] = cards;
  const isPair = c1.rank === c2.rank;
  const isSuited = c1.suit === c2.suit;
  const bothPremium = PREMIUM_RANKS.has(c1.rank) && PREMIUM_RANKS.has(c2.rank);
  const bothStrong = STRONG_RANKS.has(c1.rank) && STRONG_RANKS.has(c2.rank);
  const hasAce = c1.rank === 'A' || c2.rank === 'A';

  const handStrength = getHandTier(isPair, bothPremium, bothStrong, isSuited, hasAce);
  const roll = Math.random();

  // Tier 1: Premium (AA, KK, QQ, AK) → raise/re-raise
  if (handStrength === 1) {
    const raiseSize = Math.min(bigBlind * 3, chips);
    if (toCall === 0) return { action: 'raise', amount: raiseSize };
    if (toCall <= chips * 0.3) return { action: 'raise', amount: Math.min(toCall + bigBlind * 3, chips) };
    return { action: 'call' };
  }

  // Tier 2: Strong (JJ-TT, AQ, AJs, KQs) → call or small raise
  if (handStrength === 2) {
    if (canCheck) {
      return roll < 0.4 ? { action: 'raise', amount: Math.min(bigBlind * 2, chips) } : { action: 'check' };
    }
    if (toCall <= bigBlind * 4) return { action: 'call' };
    return roll < 0.3 ? { action: 'call' } : { action: 'fold' };
  }

  // Tier 3: Playable (suited connectors, medium pairs, Ax suited)
  if (handStrength === 3) {
    if (canCheck) return { action: 'check' };
    if (toCall <= bigBlind * 2) return roll < 0.7 ? { action: 'call' } : { action: 'fold' };
    return { action: 'fold' };
  }

  // Tier 4: Junk → mostly fold, occasional bluff
  if (canCheck) return { action: 'check' };
  if (toCall <= bigBlind && roll < 0.2) return { action: 'call' };
  return { action: 'fold' };
}

function getHandTier(isPair: boolean, bothPremium: boolean, bothStrong: boolean, isSuited: boolean, hasAce: boolean): number {
  if (isPair && bothPremium) return 1;                    // AA, KK, QQ, JJ
  if (bothPremium) return 1;                              // AK, AQ, KQ etc.
  if (isPair && bothStrong) return 2;                     // TT, 99
  if (isSuited && bothStrong) return 2;                   // KJs, QTs, etc.
  if (isPair) return 3;                                   // 88-22
  if (hasAce && isSuited) return 3;                       // Axs
  if (bothStrong) return 3;                               // KJo, QTo, etc.
  if (hasAce) return 3;                                   // Axo
  return 4;
}

// ─── Postflop strategy ───────────────────────────────────────────────────────

function postflopDecision(
  holeCards: [CardValue, CardValue],
  communityCards: CardValue[],
  pot: number,
  toCall: number,
  chips: number,
  bigBlind: number,
  canCheck: boolean,
): BotDecision {
  const strength = evaluatePostflopStrength(holeCards, communityCards);
  const roll = Math.random();
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  // Strong hand (top pair+, two pair, set, straight, flush, etc.)
  if (strength >= 0.7) {
    if (canCheck) {
      // Slow-play sometimes
      if (roll < 0.3) return { action: 'check' };
      const betSize = Math.min(Math.floor(pot * (0.5 + roll * 0.5)), chips);
      return betSize > 0 ? { action: 'raise', amount: betSize } : { action: 'check' };
    }
    if (toCall <= chips * 0.5) return { action: 'call' };
    return roll < 0.6 ? { action: 'call' } : { action: 'raise', amount: Math.min(toCall * 2, chips) };
  }

  // Medium hand (middle pair, draws)
  if (strength >= 0.4) {
    if (canCheck) {
      return roll < 0.6 ? { action: 'check' } : { action: 'raise', amount: Math.min(Math.floor(pot * 0.4), chips) };
    }
    if (potOdds < 0.3 && toCall <= bigBlind * 4) return { action: 'call' };
    return roll < 0.3 ? { action: 'call' } : { action: 'fold' };
  }

  // Weak hand
  if (canCheck) {
    // Occasional bluff
    if (roll < 0.15) return { action: 'raise', amount: Math.min(Math.floor(pot * 0.5), chips) };
    return { action: 'check' };
  }
  if (toCall <= bigBlind && roll < 0.25) return { action: 'call' };
  return { action: 'fold' };
}

/**
 * Rough postflop hand strength estimate (0–1).
 * Not a real evaluator — just enough for believable play.
 */
function evaluatePostflopStrength(holeCards: [CardValue, CardValue], communityCards: CardValue[]): number {
  const all = [...holeCards, ...communityCards];
  const ranks = all.map(c => rankToNum(c.rank));
  const suits = all.map(c => c.suit);

  const holeRanks = holeCards.map(c => rankToNum(c.rank));
  const boardRanks = communityCards.map(c => rankToNum(c.rank));

  let strength = 0;

  // Pair with board
  for (const hr of holeRanks) {
    if (boardRanks.includes(hr)) {
      strength += hr >= 10 ? 0.6 : 0.35; // top pair vs low pair
    }
  }

  // Pocket pair
  if (holeRanks[0] === holeRanks[1]) {
    strength += 0.4;
    // Set (trips)
    if (boardRanks.includes(holeRanks[0])) {
      strength += 0.4;
    }
  }

  // Two pair check
  const pairCount = holeRanks.filter(hr => boardRanks.includes(hr)).length;
  if (pairCount === 2 && holeRanks[0] !== holeRanks[1]) {
    strength += 0.2;
  }

  // Flush draw / flush
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
  const maxSuit = Math.max(...suitCounts.values());
  if (maxSuit >= 5) strength += 0.8;
  else if (maxSuit === 4) strength += 0.2; // flush draw

  // Straight draw (rough)
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  for (let i = 0; i <= uniqueRanks.length - 4; i++) {
    if (uniqueRanks[i + 3] - uniqueRanks[i] <= 4) {
      if (uniqueRanks[i + 3] - uniqueRanks[i] === 3 && uniqueRanks.length >= 5) {
        // Check if we have 5 in a row
        const slice = uniqueRanks.slice(i, i + 5);
        if (slice.length >= 5 && slice[4] - slice[0] === 4) {
          strength += 0.85;
        }
      }
      strength += 0.15; // open-ended or gutshot
    }
  }

  // High card kicker
  const maxHole = Math.max(...holeRanks);
  if (maxHole >= 12) strength += 0.1; // A or K

  return Math.min(strength, 1);
}

function rankToNum(rank: string): number {
  const map: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };
  return map[rank] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action delay (mimic human thinking time)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a random delay between 1–3 seconds. */
export function getActionDelay(): number {
  return 1_000 + Math.floor(Math.random() * 2_000);
}
