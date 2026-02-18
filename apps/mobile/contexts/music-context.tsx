import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import { Asset } from 'expo-asset';

const BACKGROUND_MUSIC = require('../assets/music/funoro-youx27re-gonna-like-it-here-469728.mp3');
const VOLUME = 0.15;
const TRACK_ID = 'background-music';

type MusicContextValue = {
  isPlaying: boolean;
  audioReady: boolean;
  togglePlayPause: () => void;
};

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic() {
  const ctx = useContext(MusicContext);
  return ctx;
}

function MusicProviderInner({ children }: { children: React.ReactNode }) {
  const [audioReady, setAudioReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const trackPlayerRef = useRef<typeof import('react-native-track-player') | null>(null);
  const expoSoundRef = useRef<{ play: () => Promise<void>; pause: () => Promise<void> } | null>(null);

  const togglePlayPause = useCallback(async () => {
    if (!audioReady) return;
    try {
      if (expoSoundRef.current) {
        if (isPlaying) {
          await expoSoundRef.current.pause();
          setIsPlaying(false);
        } else {
          await expoSoundRef.current.play();
          setIsPlaying(true);
        }
      } else if (trackPlayerRef.current) {
        const TrackPlayer = trackPlayerRef.current.default;
        if (isPlaying) {
          await TrackPlayer.pause();
          setIsPlaying(false);
        } else {
          await TrackPlayer.play();
          setIsPlaying(true);
        }
      }
    } catch {
      // ignore
    }
  }, [audioReady, isPlaying]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setupAndPlay().catch(() => {});
    }, 600);

    async function setupWithTrackPlayer() {
      const rntp = require('react-native-track-player');
      trackPlayerRef.current = rntp;
      const { default: TrackPlayer, Capability, RepeatMode } = rntp;
      if (!TrackPlayer) throw new Error('TrackPlayer not available');

      const { PlaybackService } = require('../services/PlaybackService');
      TrackPlayer.registerPlaybackService(() => PlaybackService);

      await TrackPlayer.setupPlayer({});
      if (cancelled) return;
      await TrackPlayer.updateOptions({
        capabilities: [Capability.Play, Capability.Pause, Capability.Stop],
        compactCapabilities: [Capability.Play, Capability.Pause],
      });
      if (cancelled) return;

      const asset = Asset.fromModule(BACKGROUND_MUSIC);
      await asset.downloadAsync();
      if (cancelled) return;
      const trackUrl = asset.localUri ?? asset.uri;
      if (!trackUrl) throw new Error('Could not resolve music asset URI');

      await TrackPlayer.add({
        id: TRACK_ID,
        url: trackUrl,
        title: 'Background',
        artist: '',
      });
      if (cancelled) return;
      await TrackPlayer.setRepeatMode(RepeatMode.Track);
      await TrackPlayer.setVolume(VOLUME);
      if (!cancelled) {
        setAudioReady(true);
        await new Promise((r) => setTimeout(r, 150));
        if (!cancelled) await TrackPlayer.play();
        if (!cancelled) setIsPlaying(true);
      }
    }

    async function setupWithExpoAV() {
      const { Audio } = require('expo-av');
      if (!Audio?.Sound) throw new Error('expo-av not available');
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
      await sound.setVolumeAsync(VOLUME);
      expoSoundRef.current = {
        play: () => sound.playAsync(),
        pause: () => sound.pauseAsync(),
      };
      setAudioReady(true);
      await sound.playAsync();
      setIsPlaying(true);
    }

    async function setupAndPlay() {
      // Try TrackPlayer first (Android primary), fall back to expo-av.
      // The NativeModules property access itself can throw on RN 0.81+ TurboModule interop,
      // so the entire TrackPlayer attempt must be wrapped in try-catch.
      try {
        const hasTrackPlayer = !!NativeModules?.TrackPlayerModule;
        if (hasTrackPlayer) {
          await setupWithTrackPlayer();
          return;
        }
      } catch (err) {
        console.warn('[MusicProvider] TrackPlayer failed, falling back to expo-av:', err);
        trackPlayerRef.current = null;
      }

      // Fallback: expo-av (works on iOS, Android, and web)
      try {
        await setupWithExpoAV();
      } catch (err) {
        console.warn('[MusicProvider] expo-av setup failed:', err);
        if (!cancelled) {
          setAudioReady(false);
          expoSoundRef.current = null;
        }
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  const value: MusicContextValue = {
    isPlaying,
    audioReady,
    togglePlayPause,
  };

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  return <MusicProviderInner>{children}</MusicProviderInner>;
}
