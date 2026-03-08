/**
 * EmojiPanel – small reaction picker that appears when the emoji button is tapped.
 * The panel opens as an absolute overlay above the trigger button so it never
 * pushes down the action buttons.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const EMOJIS = ['🙂', '😂', '😡', '👀', '🔥', '💰', '😎', '🤯'] as const;
const COOLDOWN_MS = 3_000;

interface EmojiPanelProps {
  onSend: (emoji: string) => void;
}

export const EmojiPanel = memo(function EmojiPanel({ onSend }: EmojiPanelProps) {
  const [open, setOpen] = useState(false);
  const [onCooldown, setOnCooldown] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback(() => {
    if (open) {
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setOpen(false));
    } else {
      setOpen(true);
      Animated.spring(slideAnim, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true }).start();
    }
  }, [open, slideAnim]);

  const handlePick = useCallback((emoji: string) => {
    if (onCooldown) return;
    onSend(emoji);
    setOnCooldown(true);

    Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setOpen(false));

    cooldownTimer.current = setTimeout(() => setOnCooldown(false), COOLDOWN_MS);
  }, [onCooldown, onSend, slideAnim]);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  return (
    <View style={styles.root}>
      {/* Floating panel — positioned absolutely above the trigger */}
      {open && (
        <Animated.View
          style={[
            styles.panel,
            {
              opacity: slideAnim,
              transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => handlePick(e)}
              style={({ pressed }) => [styles.emojiBtn, pressed && styles.emojiBtnPressed]}
            >
              <Text style={styles.emojiText}>{e}</Text>
            </Pressable>
          ))}
        </Animated.View>
      )}

      {/* Trigger button */}
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [
          styles.triggerBtn,
          onCooldown && styles.triggerCooldown,
          pressed && styles.triggerPressed,
        ]}
      >
        <Text style={styles.triggerText}>{onCooldown ? '⏳' : '😀'}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  panel: {
    position: 'absolute',
    bottom: 48, // sits above the 40px trigger + 8px gap
    right: -4,
    flexDirection: 'row',
    backgroundColor: 'rgba(26,10,46,0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,255,0.4)',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 2,
    zIndex: 999,
    elevation: 20,
  },
  emojiBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  emojiBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  emojiText: {
    fontSize: 22,
  },
  triggerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(26,10,46,0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerPressed: {
    opacity: 0.7,
  },
  triggerCooldown: {
    opacity: 0.5,
  },
  triggerText: {
    fontSize: 20,
  },
});
