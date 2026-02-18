import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';

const BACKGROUND_MUSIC = require('../assets/music/funoro-youx27re-gonna-like-it-here-469728.mp3');
const VOLUME = 0.15;

type MusicContextValue = {
  isPlaying: boolean;
  audioReady: boolean;
  togglePlayPause: () => void;
};

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic() {
  return useContext(MusicContext);
}

function MusicProviderInner({ children }: { children: React.ReactNode }) {
  const [audioReady, setAudioReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<{ play: () => void; pause: () => void; cleanup?: () => void } | null>(null);

  const togglePlayPause = useCallback(() => {
    if (!audioReady || !playerRef.current) return;
    try {
      if (isPlaying) {
        playerRef.current.pause();
        setIsPlaying(false);
      } else {
        playerRef.current.play();
        setIsPlaying(true);
      }
    } catch {
      // ignore
    }
  }, [audioReady, isPlaying]);

  useEffect(() => {
    let cancelled = false;

    async function setupWithExpoAudio() {
      const { createAudioPlayer, setAudioModeAsync } = require('expo-audio');
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      if (cancelled) return;

      const player = createAudioPlayer(BACKGROUND_MUSIC);
      player.loop = true;
      player.volume = VOLUME;

      if (cancelled) {
        player.remove();
        return;
      }

      playerRef.current = {
        play: () => player.play(),
        pause: () => player.pause(),
        cleanup: () => player.remove(),
      };
      setAudioReady(true);
      player.play();
      if (!cancelled) setIsPlaying(true);
    }

    async function setupWithExpoAV() {
      const { Audio } = require('expo-av');
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      if (cancelled) return;

      const { sound } = await Audio.Sound.createAsync(BACKGROUND_MUSIC, {
        isLooping: true,
        volume: VOLUME,
      });
      if (cancelled) {
        await sound.unloadAsync();
        return;
      }

      playerRef.current = {
        play: () => sound.playAsync(),
        pause: () => sound.pauseAsync(),
        cleanup: () => sound.unloadAsync(),
      };
      setAudioReady(true);
      await sound.playAsync();
      if (!cancelled) setIsPlaying(true);
    }

    async function setup() {
      // expo-audio is only available after a rebuild that includes it.
      // Check for the native module before attempting to use it, to avoid
      // expo-modules-core throwing an uncaught global error.
      const hasExpoAudio = !!NativeModules?.ExpoAudio;
      if (hasExpoAudio) {
        try {
          await setupWithExpoAudio();
          return;
        } catch {
          // fall through to expo-av
        }
      }
      try {
        await setupWithExpoAV();
      } catch (err) {
        console.warn('[MusicProvider] All audio setup failed:', err);
      }
    }

    const timeoutId = setTimeout(() => setup().catch(() => {}), 600);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      playerRef.current?.cleanup?.();
    };
  }, []);

  return (
    <MusicContext.Provider value={{ isPlaying, audioReady, togglePlayPause }}>
      {children}
    </MusicContext.Provider>
  );
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  return <MusicProviderInner>{children}</MusicProviderInner>;
}
