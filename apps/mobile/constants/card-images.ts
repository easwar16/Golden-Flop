/**
 * Static lookup for all 52 card images.
 * React Native requires static require() calls — no dynamic paths allowed.
 * Key format: "{rank}_{suit_name}"  e.g. "A_spades", "10_hearts", "K_diamonds"
 */

const CARD_IMAGES: Record<string, number> = {
  // Spades
  '2_spades':  require('@/assets/images/cards/2_spades.png'),
  '3_spades':  require('@/assets/images/cards/3_spades.png'),
  '4_spades':  require('@/assets/images/cards/4_spades.png'),
  '5_spades':  require('@/assets/images/cards/5_spades.png'),
  '6_spades':  require('@/assets/images/cards/6_spades.png'),
  '7_spades':  require('@/assets/images/cards/7_spades.png'),
  '8_spades':  require('@/assets/images/cards/8_spades.png'),
  '9_spades':  require('@/assets/images/cards/9_spades.png'),
  '10_spades': require('@/assets/images/cards/10_spades.png'),
  'J_spades':  require('@/assets/images/cards/J_spades.png'),
  'Q_spades':  require('@/assets/images/cards/Q_spades.png'),
  'K_spades':  require('@/assets/images/cards/K_spades.png'),
  'A_spades':  require('@/assets/images/cards/A_spades.png'),
  // Hearts
  '2_hearts':  require('@/assets/images/cards/2_hearts.png'),
  '3_hearts':  require('@/assets/images/cards/3_hearts.png'),
  '4_hearts':  require('@/assets/images/cards/4_hearts.png'),
  '5_hearts':  require('@/assets/images/cards/5_hearts.png'),
  '6_hearts':  require('@/assets/images/cards/6_hearts.png'),
  '7_hearts':  require('@/assets/images/cards/7_hearts.png'),
  '8_hearts':  require('@/assets/images/cards/8_hearts.png'),
  '9_hearts':  require('@/assets/images/cards/9_hearts.png'),
  '10_hearts': require('@/assets/images/cards/10_hearts.png'),
  'J_hearts':  require('@/assets/images/cards/J_hearts.png'),
  'Q_hearts':  require('@/assets/images/cards/Q_hearts.png'),
  'K_hearts':  require('@/assets/images/cards/K_hearts.png'),
  'A_hearts':  require('@/assets/images/cards/A_hearts.png'),
  // Diamonds
  '2_diamonds':  require('@/assets/images/cards/2_diamonds.png'),
  '3_diamonds':  require('@/assets/images/cards/3_diamonds.png'),
  '4_diamonds':  require('@/assets/images/cards/4_diamonds.png'),
  '5_diamonds':  require('@/assets/images/cards/5_diamonds.png'),
  '6_diamonds':  require('@/assets/images/cards/6_diamonds.png'),
  '7_diamonds':  require('@/assets/images/cards/7_diamonds.png'),
  '8_diamonds':  require('@/assets/images/cards/8_diamonds.png'),
  '9_diamonds':  require('@/assets/images/cards/9_diamonds.png'),
  '10_diamonds': require('@/assets/images/cards/10_diamonds.png'),
  'J_diamonds':  require('@/assets/images/cards/J_diamonds.png'),
  'Q_diamonds':  require('@/assets/images/cards/Q_diamonds.png'),
  'K_diamonds':  require('@/assets/images/cards/K_diamonds.png'),
  'A_diamonds':  require('@/assets/images/cards/A_diamonds.png'),
  // Clubs
  '2_clubs':  require('@/assets/images/cards/2_clubs.png'),
  '3_clubs':  require('@/assets/images/cards/3_clubs.png'),
  '4_clubs':  require('@/assets/images/cards/4_clubs.png'),
  '5_clubs':  require('@/assets/images/cards/5_clubs.png'),
  '6_clubs':  require('@/assets/images/cards/6_clubs.png'),
  '7_clubs':  require('@/assets/images/cards/7_clubs.png'),
  '8_clubs':  require('@/assets/images/cards/8_clubs.png'),
  '9_clubs':  require('@/assets/images/cards/9_clubs.png'),
  '10_clubs': require('@/assets/images/cards/10_clubs.png'),
  'J_clubs':  require('@/assets/images/cards/J_clubs.png'),
  'Q_clubs':  require('@/assets/images/cards/Q_clubs.png'),
  'K_clubs':  require('@/assets/images/cards/K_clubs.png'),
  'A_clubs':  require('@/assets/images/cards/A_clubs.png'),
};

const SUIT_NAME: Record<string, string> = {
  '♠': 'spades',
  '♥': 'hearts',
  '♦': 'diamonds',
  '♣': 'clubs',
};

/** Returns the image asset for a given rank + suit, or undefined if not found. */
export function getCardImage(rank: string, suit: string): number | undefined {
  // 'T' is Ten in poker notation; image files use '10'
  const r = rank === 'T' ? '10' : rank;
  const s = SUIT_NAME[suit] ?? suit;
  return CARD_IMAGES[`${r}_${s}`];
}

export const CARD_BACK = require('@/assets/images/card-back.png');
