import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';

const LOGO_VIDEO = require('@/assets/videos/logo_loading_small.mp4');
const HOLD_DURATION = 1500; // ms the video plays before navigation proceeds

type TransitionContextValue = {
  showTransition: () => Promise<void>;
  hideTransition: () => void;
};

const TransitionContext = createContext<TransitionContextValue>({
  showTransition: () => Promise.resolve(),
  hideTransition: () => {},
});

export function useTransition() {
  return useContext(TransitionContext);
}

export function TransitionProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const hiding = useRef(false);

  // Returns a Promise that resolves after the video has played for HOLD_DURATION.
  // The caller should await this before navigating so the user sees the video first.
  const showTransition = useCallback((): Promise<void> => {
    hiding.current = false;
    setVisible(true);
    return new Promise((resolve) => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setTimeout(resolve, HOLD_DURATION);
      });
    });
  }, [opacity]);

  const hideTransition = useCallback(() => {
    if (hiding.current) return;
    hiding.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
    });
  }, [opacity]);

  return (
    <TransitionContext.Provider value={{ showTransition, hideTransition }}>
      {children}
      {visible && (
        <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="none">
          <Video
            source={LOGO_VIDEO}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted
          />
        </Animated.View>
      )}
    </TransitionContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 99998,
  },
});
