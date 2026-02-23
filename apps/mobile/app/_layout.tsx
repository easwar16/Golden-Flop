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
import { Stack, useSegments } from 'expo-router';
import { LinkPreviewContextProvider } from 'expo-router/build/link/preview/LinkPreviewContext';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const musicOffImage = require('../assets/images/sound-off.png');
const musicOnImage = require('../assets/images/sound-on.png');

SplashScreen.preventAutoHideAsync();

import { MusicProvider, useMusic } from '@/contexts/music-context';
import { SocketProvider } from '@/contexts/socket-provider';
import { WalletProvider } from '@/contexts/wallet-context';
import { useColorScheme } from '@/hooks/use-color-scheme';


function GlobalMusicButton() {
  const insets = useSafeAreaInsets();
  const music = useMusic();
  const segments = useSegments();
  const isPlaying = music?.isPlaying ?? false;
  const audioReady = music?.audioReady ?? false;
  const togglePlayPause = music?.togglePlayPause ?? (() => {});

  // Only show on the home screen (index tab)
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
        {/* Both images always mounted so they're decoded and ready instantly */}
        <Image source={musicOnImage}  style={[styles.musicButtonImage, !isPlaying && styles.hidden]} />
        <Image source={musicOffImage} style={[styles.musicButtonImage, styles.musicOffOverlay, isPlaying && styles.hidden]} />
      </Pressable>
    </View>
  );
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <WalletProvider>
        <SocketProvider>
          <MusicProvider>
            <LinkPreviewContextProvider>
              <View style={styles.root}>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="table/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
                </Stack>
                <GlobalMusicButton />
              </View>
              <StatusBar style="light" />
            </LinkPreviewContextProvider>
          </MusicProvider>
        </SocketProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  musicButtonWrap: {
    position: 'absolute',
    right: 80, // sits left of settings button (right:16 + 56wide + 8gap)
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
  musicButtonDisabled: {
    opacity: 0.7,
  },
});
