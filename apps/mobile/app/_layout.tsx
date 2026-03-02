// NativeWind/Tailwind – disabled temporarily to fix Metro TransformError; re-enable after app loads
// import '../global.css';

// Polyfills for @solana/web3.js (must be first)
import 'react-native-get-random-values';
import { Platform } from 'react-native';
import { setupURLPolyfill } from 'react-native-url-polyfill';
import { Buffer } from 'buffer';

// Only on native: web already has URL (with canParse); polyfill would break Metro/browser
if (Platform.OS !== 'web') {
  setupURLPolyfill();
}
global.Buffer = Buffer;

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useSegments, useRouter } from 'expo-router';
import { LinkPreviewContextProvider } from 'expo-router/build/link/preview/LinkPreviewContext';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Alert, Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import * as Linking from 'expo-linking';
import { validateInviteToken } from '@/services/InviteService';

const musicOffImage = require('../assets/images/sound-off.png');
const musicOnImage = require('../assets/images/sound-on.png');
const LOGO_VIDEO = require('../assets/videos/logo_loading_small.mp4');

SplashScreen.preventAutoHideAsync();

import { MusicProvider, useMusic } from '@/contexts/music-context';
import { TransitionProvider } from '@/contexts/transition-context';
import { SocketProvider } from '@/contexts/socket-provider';
import { WalletProvider } from '@/contexts/wallet-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js';
import { clusterApiUrl } from '@solana/web3.js';
import { APP_IDENTITY, CLUSTER } from '@/constants/solana';

// ─────────────────────────────────────────────────────────────────────────────
// Video splash overlay — plays once then fades out
// ─────────────────────────────────────────────────────────────────────────────

function VideoSplash({ onFinished }: { onFinished: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

  const fadeOut = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(() => onFinished());
  }, [opacity, onFinished]);

  const onStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded && status.didJustFinish) {
      fadeOut();
    }
  }, [fadeOut]);

  return (
    <Animated.View style={[styles.splash, { opacity }]} pointerEvents="none">
      <Video
        source={LOGO_VIDEO}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        isMuted
        onPlaybackStatusUpdate={onStatusUpdate}
      />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Music toggle button (home screen only)
// ─────────────────────────────────────────────────────────────────────────────

function GlobalMusicButton() {
  const insets = useSafeAreaInsets();
  const music = useMusic();
  const segments = useSegments();
  const isPlaying = music?.isPlaying ?? false;
  const togglePlayPause = music?.togglePlayPause ?? (() => {});

  const seg = segments as string[];
  const isHome = seg.includes('(tabs)') && (seg.includes('index') || seg.length === 1);
  if (!isHome) return null;

  return (
    <View style={[styles.musicButtonWrap, { bottom: insets.bottom }]}>
      <Pressable
        onPress={togglePlayPause}
        style={({ pressed }) => [styles.musicBtnPressable, pressed && styles.musicButtonPressed]}
        accessibilityLabel={isPlaying ? 'Pause music' : 'Play music'}
        accessibilityRole="button"
      >
        <Image source={musicOnImage}  style={[styles.musicButtonImage, !isPlaying && styles.hidden]} />
        <Image source={musicOffImage} style={[styles.musicButtonImage, styles.musicOffOverlay, isPlaying && styles.hidden]} />
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────────────────────────────────────

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [splashDone, setSplashDone] = useState(false);

  const handleSplashFinished = useCallback(() => {
    setSplashDone(true);
  }, []);

  const router = useRouter();

  // ── Deep link handler for invite URLs ─────────────────────────────────
  const handleInviteUrl = useCallback(async (url: string) => {
    try {
      let token: string | null = null;

      // goldenflop://invite?token=X
      if (url.includes('://invite')) {
        const parsed = Linking.parse(url);
        token = (parsed.queryParams?.token as string) ?? null;
      }
      // https://goldenflop.app/invite/X
      const httpsMatch = url.match(/goldenflop\.app\/invite\/([A-Za-z0-9]+)/);
      if (httpsMatch) {
        token = httpsMatch[1];
      }

      if (!token) return;

      const result = await validateInviteToken(token);
      if (result.valid && result.roomId) {
        router.push(`/table/${result.roomId}` as any);
      } else {
        Alert.alert('Invalid Invite', result.error ?? 'This invite link is invalid or expired.');
      }
    } catch (e) {
      Alert.alert('Invite Error', 'Could not process invite link. Please try again.');
    }
  }, [router]);

  useEffect(() => {
    // Handle URL that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) handleInviteUrl(url);
    });

    // Handle URLs while app is running
    const sub = Linking.addEventListener('url', (event) => {
      handleInviteUrl(event.url);
    });

    return () => sub.remove();
  }, [handleInviteUrl]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <MobileWalletProvider
        chain={CLUSTER}
        endpoint={clusterApiUrl('devnet')}
        identity={APP_IDENTITY}>
      <WalletProvider>
        <SocketProvider>
          <MusicProvider>
            <TransitionProvider>
            <LinkPreviewContextProvider>
              <View style={styles.root}>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="table/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
                </Stack>
                <GlobalMusicButton />
                {!splashDone && <VideoSplash onFinished={handleSplashFinished} />}
              </View>
              <StatusBar style="light" />
            </LinkPreviewContextProvider>
            </TransitionProvider>
          </MusicProvider>
        </SocketProvider>
      </WalletProvider>
      </MobileWalletProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 99999,
  },
  musicButtonWrap: {
    position: 'absolute',
    right: 80,
    width: 56,
    height: 56,
    zIndex: 9999,
    ...(Platform.OS === 'android' ? { elevation: 9999 } : {}),
  },
  musicBtnPressable: {
    width: 56,
    height: 56,
  },
  musicButtonImage: {
    width: 56,
    height: 56,
  },
  musicOffOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  hidden: {
    opacity: 0,
  },
  musicButtonPressed: {
    opacity: 0.75,
  },
});
