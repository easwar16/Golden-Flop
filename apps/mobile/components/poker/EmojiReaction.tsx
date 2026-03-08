/**
 * EmojiReaction – floating emoji animation above a player's avatar.
 *
 * Shows an emoji that floats upward and fades out over ~2.5 seconds.
 * Supports queuing multiple reactions smoothly.
 */

import React, { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

interface EmojiReactionProps {
  emoji: string;
  id: string; // unique key to trigger re-animation
}

export const EmojiReaction = memo(function EmojiReaction({ emoji, id }: EmojiReactionProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(0);
    scale.setValue(0.3);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(translateY, { toValue: -50, duration: 2500, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.2, friction: 4, tension: 120, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
    ]).start();
  }, [id]);

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity, transform: [{ translateY }, { scale }] },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.emoji}>{emoji}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -20,
    alignSelf: 'center',
    zIndex: 100,
  },
  emoji: {
    fontSize: 32,
    textAlign: 'center',
  },
});
