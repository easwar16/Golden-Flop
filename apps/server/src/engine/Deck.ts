import { SUITS, RANKS, CardValue } from '@goldenflop/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Seeded PRNG – mulberry32 (fast, deterministic, passes basic randomness tests)
// Injecting a seed enables provable-fairness: reveal seed post-hand so players
// can independently verify the shuffle.
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 0xffffffff;
  };
}

function seedToNumber(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deck
// ─────────────────────────────────────────────────────────────────────────────

/** Build and return a fresh 52-card shuffled deck using the given seed. */
export function buildShuffledDeck(seed: string): CardValue[] {
  const deck: CardValue[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return fisherYates(deck, mulberry32(seedToNumber(seed)));
}

/** Fisher-Yates in-place shuffle using a provided RNG. */
function fisherYates<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Draw the next card from the deck (mutates deck). */
export function drawCard(deck: CardValue[]): CardValue {
  const card = deck.pop();
  if (!card) throw new Error('Deck is empty');
  return card;
}
