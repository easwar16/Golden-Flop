import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

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
  const playerRef = useRef<AudioPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    let player: AudioPlayer | null = null;
    let unmounted = false;

    async function init() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          allowsRecording: false,
        });

        player = createAudioPlayer(BACKGROUND_MUSIC);
        player.loop = true;
        player.volume = VOLUME;

        if (unmounted) {
          player.remove();
          return;
        }

        playerRef.current = player;
        setAudioReady(true);

        player.play();
        setIsPlaying(true);
        console.log('[Music] Playing ✓');
      } catch (err) {
        console.error('[Music] INIT ERROR:', err);
      }
    }

    init();

    return () => {
      unmounted = true;
      player?.remove();
      playerRef.current = null;
    };
  }, []);

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      console.warn('[Music] No player loaded');
      return;
    }
    try {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('[Music] Toggle error:', err);
    }
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
