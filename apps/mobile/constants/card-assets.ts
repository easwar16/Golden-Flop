/**
 * Static map of card (rank + suit code) to image require.
 * Used so Metro can bundle card assets; keys are "As", "2s", ..., "Kc", "back".
 */
import type { CardValue } from './poker';

const SUIT_TO_CODE: Record<string, string> = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

export const CARD_IMAGES: Record<string, number> = {
  back: require('@/assets/images/cards/back.png'),
  As: require('@/assets/images/cards/As.png'),
  '2s': require('@/assets/images/cards/2s.png'),
  '3s': require('@/assets/images/cards/3s.png'),
  '4s': require('@/assets/images/cards/4s.png'),
  '5s': require('@/assets/images/cards/5s.png'),
  '6s': require('@/assets/images/cards/6s.png'),
  '7s': require('@/assets/images/cards/7s.png'),
  '8s': require('@/assets/images/cards/8s.png'),
  '9s': require('@/assets/images/cards/9s.png'),
  Ts: require('@/assets/images/cards/Ts.png'),
  Js: require('@/assets/images/cards/Js.png'),
  Qs: require('@/assets/images/cards/Qs.png'),
  Ks: require('@/assets/images/cards/Ks.png'),
  Ah: require('@/assets/images/cards/Ah.png'),
  '2h': require('@/assets/images/cards/2h.png'),
  '3h': require('@/assets/images/cards/3h.png'),
  '4h': require('@/assets/images/cards/4h.png'),
  '5h': require('@/assets/images/cards/5h.png'),
  '6h': require('@/assets/images/cards/6h.png'),
  '7h': require('@/assets/images/cards/7h.png'),
  '8h': require('@/assets/images/cards/8h.png'),
  '9h': require('@/assets/images/cards/9h.png'),
  Th: require('@/assets/images/cards/Th.png'),
  Jh: require('@/assets/images/cards/Jh.png'),
  Qh: require('@/assets/images/cards/Qh.png'),
  Kh: require('@/assets/images/cards/Kh.png'),
  Ad: require('@/assets/images/cards/Ad.png'),
  '2d': require('@/assets/images/cards/2d.png'),
  '3d': require('@/assets/images/cards/3d.png'),
  '4d': require('@/assets/images/cards/4d.png'),
  '5d': require('@/assets/images/cards/5d.png'),
  '6d': require('@/assets/images/cards/6d.png'),
  '7d': require('@/assets/images/cards/7d.png'),
  '8d': require('@/assets/images/cards/8d.png'),
  '9d': require('@/assets/images/cards/9d.png'),
  Td: require('@/assets/images/cards/Td.png'),
  Jd: require('@/assets/images/cards/Jd.png'),
  Qd: require('@/assets/images/cards/Qd.png'),
  Kd: require('@/assets/images/cards/Kd.png'),
  Ac: require('@/assets/images/cards/Ac.png'),
  '2c': require('@/assets/images/cards/2c.png'),
  '3c': require('@/assets/images/cards/3c.png'),
  '4c': require('@/assets/images/cards/4c.png'),
  '5c': require('@/assets/images/cards/5c.png'),
  '6c': require('@/assets/images/cards/6c.png'),
  '7c': require('@/assets/images/cards/7c.png'),
  '8c': require('@/assets/images/cards/8c.png'),
  '9c': require('@/assets/images/cards/9c.png'),
  Tc: require('@/assets/images/cards/Tc.png'),
  Jc: require('@/assets/images/cards/Jc.png'),
  Qc: require('@/assets/images/cards/Qc.png'),
  Kc: require('@/assets/images/cards/Kc.png'),
};

export function getCardImageSource(card: CardValue | null, faceDown: boolean): number {
  if (faceDown || !card) return CARD_IMAGES.back;
  const code = SUIT_TO_CODE[card.suit];
  if (!code) return CARD_IMAGES.back;
  const key = `${card.rank}${code}`;
  return CARD_IMAGES[key] ?? CARD_IMAGES.back;
}
