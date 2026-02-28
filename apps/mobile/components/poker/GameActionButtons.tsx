import React, { memo } from 'react';
import {
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type GameAction = 'fold' | 'call' | 'raise' | 'all-in';

interface GameActionButtonsProps {
  currentBet: number;
  myChips: number;
  onAction: (action: GameAction) => void;
}

export const GameActionButtons = memo(function GameActionButtons({
  currentBet,
  myChips,
  onAction,
}: GameActionButtonsProps) {
  const zeroBalance = myChips <= 0;

  return (
    <View style={styles.actionBar}>
      {/* FOLD */}
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.foldWrap, pressed && styles.actionBtnP]}
        onPress={() => onAction('fold')}>
        {({ pressed }) => (
          <ImageBackground
            source={pressed ? require('@/assets/images/buttons/fold-btn-pressed.png') : require('@/assets/images/buttons/fold-btn.png')}
            style={styles.btnBg} resizeMode="stretch">
            <Text style={styles.btnText}>FOLD</Text>
          </ImageBackground>
        )}
      </Pressable>

      {/* CALL / CHECK */}
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.callWrap, pressed && styles.actionBtnP, zeroBalance && currentBet > 0 && styles.actionBtnDisabled]}
        onPress={() => onAction('call')}
        disabled={zeroBalance && currentBet > 0}>
        {({ pressed }) => (
          <ImageBackground
            source={pressed ? require('@/assets/images/buttons/call-btn-pressed.png') : require('@/assets/images/buttons/call-btn.png')}
            style={styles.btnBg} resizeMode="stretch">
            <Text style={styles.btnText}>
              {currentBet > 0 ? 'CALL' : 'CHECK'}
            </Text>
          </ImageBackground>
        )}
      </Pressable>

      {/* RAISE */}
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.raiseWrap, pressed && styles.actionBtnP, zeroBalance && styles.actionBtnDisabled]}
        onPress={() => onAction('raise')}
        disabled={zeroBalance}>
        {({ pressed }) => (
          <ImageBackground
            source={pressed ? require('@/assets/images/buttons/raise-btn-pressed.png') : require('@/assets/images/buttons/raise-btn.png')}
            style={styles.btnBg} resizeMode="stretch">
            <Text style={styles.raiseBtnText}>RAISE</Text>
          </ImageBackground>
        )}
      </Pressable>

      {/* ALL-IN */}
      <Pressable
        style={({ pressed }) => [styles.allInBtn, pressed && styles.actionBtnP, zeroBalance && styles.actionBtnDisabled]}
        onPress={() => onAction('all-in')}
        disabled={zeroBalance}>
        <Text style={styles.allInBtnText}>ALL-IN</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  actionBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  actionBtn: {
    flex: 1, minHeight: 48,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 1, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 4 }, default: {},
    }),
  },
  actionBtnP: { opacity: 0.85 },
  actionBtnDisabled: { opacity: 0.35 },
  foldWrap: { overflow: 'hidden' },
  callWrap: { overflow: 'hidden' },
  raiseWrap: {
    overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,220,100,0.75)',
    ...Platform.select({
      ios: { shadowColor: '#FFD060', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 6 },
      android: { elevation: 8 }, default: {},
    }),
  },
  btnBg: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  btnText: { fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: '#fff' },
  raiseBtnText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 10 : 9, color: '#fff',
    textShadowColor: 'rgba(0,60,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  allInBtn: {
    paddingHorizontal: 10, minHeight: 48,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6a1b9a',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 1, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 4 }, default: {},
    }),
  },
  allInBtnText: {
    fontFamily: 'PressStart2P_400Regular', fontSize: Platform.OS === 'web' ? 8 : 7, color: '#fff',
  },
});
