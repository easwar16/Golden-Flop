import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';

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
    let subscription: { remove: () => void } | null = null;
    let startId: ReturnType<typeof setTimeout>;
    let fallbackId: ReturnType<typeof setTimeout>;

    async function init() {
      try {
        console.log('[Music] Configuring audio session...');
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          interruptionMode: 'doNotMix',
        });

        console.log('[Music] Creating player...');
        player = createAudioPlayer(BACKGROUND_MUSIC);
        playerRef.current = player;

        player.loop = true;
        player.volume = VOLUME;

        const startPlay = () => {
          if (!player) return;
          try {
            player.play();
            setAudioReady(true);
            setIsPlaying(true);
            console.log('[Music] Playing ✓');
          } catch (e) {
            console.error('[Music] play() error:', e);
          }
        };

        // If already loaded (rare but possible), play immediately
        if (player.isLoaded) {
          startPlay();
          return;
        }

        // Event-driven: fire as soon as the native player signals it's ready
        subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.isLoaded) {
            subscription?.remove();
            subscription = null;
            clearTimeout(fallbackId);
            startPlay();
          }
        });

        // Fallback: if the event never fires within 8s, try playing anyway
        fallbackId = setTimeout(() => {
          subscription?.remove();
          subscription = null;
          console.warn('[Music] Fallback play triggered');
          startPlay();
        }, 8000);

      } catch (err) {
        console.error('[Music] INIT ERROR:', err);
      }
    }

    // Small startup delay — Android audio subsystem needs a moment after app launch
    startId = setTimeout(() => init(), 500);

    return () => {
      clearTimeout(startId);
      clearTimeout(fallbackId);
      subscription?.remove();
      try { player?.remove(); } catch (_) {}
      playerRef.current = null;
    };
  }, []);

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      console.warn('[Music] No player');
      return;
    }
    try {
      if (isPlaying) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('[Music] Toggle error:', err);
    }
  }, [isPlaying]);

  return (
    <MusicContext.Provider value={{ isPlaying, audioReady, togglePlayPause }}>
      {children}
    </MusicContext.Provider>
  );
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  return <MusicProviderInner>{children}</MusicProviderInner>;
}
