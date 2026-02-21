import { CardValue, RANKS } from '@goldenflop/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Hand rank constants  (higher = stronger)
// ─────────────────────────────────────────────────────────────────────────────

export const enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  [HandRank.HighCard]: 'High Card',
  [HandRank.OnePair]: 'One Pair',
  [HandRank.TwoPair]: 'Two Pair',
  [HandRank.ThreeOfAKind]: 'Three of a Kind',
  [HandRank.Straight]: 'Straight',
  [HandRank.Flush]: 'Flush',
  [HandRank.FullHouse]: 'Full House',
  [HandRank.FourOfAKind]: 'Four of a Kind',
  [HandRank.StraightFlush]: 'Straight Flush',
  [HandRank.RoyalFlush]: 'Royal Flush',
};

export interface EvaluatedHand {
  rank: HandRank;
  name: string;
  /** The five cards that make up the winning hand */
  cards: CardValue[];
  /**
   * Tiebreaker value: an array of rank-indices (14 = Ace) used to break ties
   * within the same HandRank.  Compare element-by-element, largest wins.
   */
  tiebreakers: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rank value helper
// ─────────────────────────────────────────────────────────────────────────────

const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11,
  'Q': 12, 'K': 13, 'A': 14,
};

function rv(card: CardValue): number {
  return RANK_VALUES[card.rank];
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluate the best 5-card hand from 5–7 cards
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateBestHand(cards: CardValue[]): EvaluatedHand {
  if (cards.length < 5) throw new Error('Need at least 5 cards');

  let best: EvaluatedHand | null = null;

  // Generate all C(n,5) combinations
  for (const combo of combinations5(cards)) {
    const evaluated = evaluate5(combo);
    if (!best || compareHands(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return best!;
}

/** Compare two evaluated hands: returns positive if a > b, negative if a < b, 0 if equal. */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluate exactly 5 cards
// ─────────────────────────────────────────────────────────────────────────────

function evaluate5(cards: CardValue[]): EvaluatedHand {
  const sorted = [...cards].sort((a, b) => rv(b) - rv(a));
  const values = sorted.map(rv);
  const isFlush = cards.every(c => c.suit === cards[0].suit);
  const isStraight = checkStraight(values);
  const rankCounts = countRanks(sorted);

  if (isFlush && isStraight) {
    const isRoyal = values[0] === 14 && values[4] === 10;
    const rank = isRoyal ? HandRank.RoyalFlush : HandRank.StraightFlush;
    return make(rank, sorted, [straightHighCard(values)]);
  }

  const groups = groupByCount(rankCounts);

  if (groups[4]) {
    const quad = groups[4][0];
    const kicker = sorted.find(c => rv(c) !== quad)!;
    return make(HandRank.FourOfAKind, sorted, [quad, rv(kicker)]);
  }

  if (groups[3] && groups[2]) {
    return make(HandRank.FullHouse, sorted, [groups[3][0], groups[2][0]]);
  }

  if (isFlush) {
    return make(HandRank.Flush, sorted, values);
  }

  if (isStraight) {
    return make(HandRank.Straight, sorted, [straightHighCard(values)]);
  }

  if (groups[3]) {
    const kickers = sorted.filter(c => rv(c) !== groups[3][0]).map(rv);
    return make(HandRank.ThreeOfAKind, sorted, [groups[3][0], ...kickers]);
  }

  if (groups[2] && groups[2].length >= 2) {
    const [highPair, lowPair] = groups[2].sort((a, b) => b - a);
    const kicker = sorted.find(c => rv(c) !== highPair && rv(c) !== lowPair)!;
    return make(HandRank.TwoPair, sorted, [highPair, lowPair, rv(kicker)]);
  }

  if (groups[2]) {
    const pair = groups[2][0];
    const kickers = sorted.filter(c => rv(c) !== pair).map(rv);
    return make(HandRank.OnePair, sorted, [pair, ...kickers]);
  }

  return make(HandRank.HighCard, sorted, values);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function make(rank: HandRank, cards: CardValue[], tiebreakers: number[]): EvaluatedHand {
  return { rank, name: HAND_RANK_NAMES[rank], cards, tiebreakers };
}

function checkStraight(sortedValues: number[]): boolean {
  // Standard straight
  const isConsecutive = sortedValues.every(
    (v, i) => i === 0 || sortedValues[i - 1] - v === 1
  );
  if (isConsecutive) return true;
  // Wheel: A-2-3-4-5
  const isWheel =
    sortedValues[0] === 14 &&
    sortedValues[1] === 5 &&
    sortedValues[2] === 4 &&
    sortedValues[3] === 3 &&
    sortedValues[4] === 2;
  return isWheel;
}

function straightHighCard(sortedValues: number[]): number {
  // Wheel: high card is 5
  if (sortedValues[0] === 14 && sortedValues[1] === 5) return 5;
  return sortedValues[0];
}

function countRanks(sorted: CardValue[]): Map<CardValue, number> {
  // Map of a representative card → count of cards with that rank value
  const counts = new Map<number, { card: CardValue; count: number }>();
  for (const c of sorted) {
    const v = rv(c);
    if (counts.has(v)) {
      counts.get(v)!.count++;
    } else {
      counts.set(v, { card: c, count: 1 });
    }
  }
  return new Map([...counts.values()].map(e => [e.card, e.count]));
}

function groupByCount(rankCounts: Map<CardValue, number>): Record<number, number[]> {
  const groups: Record<number, number[]> = {};
  for (const [card, count] of rankCounts) {
    if (!groups[count]) groups[count] = [];
    groups[count].push(rv(card));
  }
  // Sort each group descending
  for (const key of Object.keys(groups)) {
    groups[Number(key)].sort((a, b) => b - a);
  }
  return groups;
}

function* combinations5(cards: CardValue[]): Generator<CardValue[]> {
  const n = cards.length;
  for (let i = 0; i < n - 4; i++)
    for (let j = i + 1; j < n - 3; j++)
      for (let k = j + 1; k < n - 2; k++)
        for (let l = k + 1; l < n - 1; l++)
          for (let m = l + 1; m < n; m++)
            yield [cards[i], cards[j], cards[k], cards[l], cards[m]];
}
