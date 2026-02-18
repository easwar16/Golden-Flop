import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback for poker UX (Thumb-first / Seeker).
 * - Your turn: light impact
 * - Big blind approaching: pattern
 * - All-in: strong notification
 */
export function usePokerHaptics() {
  const yourTurn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const bigBlindApproaching = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 100);
  };

  const allIn = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return { yourTurn, bigBlindApproaching, allIn };
}
