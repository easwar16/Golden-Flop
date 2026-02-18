export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface CardValue {
  suit: Suit;
  rank: Rank;
}

export function cardToString(c: CardValue): string {
  return `${c.rank}${c.suit}`;
}

export function stringToCard(s: string): CardValue | null {
  if (s.length < 2) return null;
  const rank = s[0] as Rank;
  const suit = s[1] as Suit;
  if (RANKS.includes(rank) && SUITS.includes(suit)) return { rank, suit };
  return null;
}

export const RED_SUITS: Suit[] = ['♥', '♦'];
