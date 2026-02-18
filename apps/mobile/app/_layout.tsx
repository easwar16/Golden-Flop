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
import { Stack } from 'expo-router';
import { LinkPreviewContextProvider } from 'expo-router/build/link/preview/LinkPreviewContext';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const musicOffImage = require('../assets/images/music-button-off.png');
const musicOnImage = require('../assets/images/music-button-on.png');

SplashScreen.preventAutoHideAsync();

import { GameProvider } from '@/contexts/game-context';
import { MusicProvider, useMusic } from '@/contexts/music-context';
import { WalletProvider } from '@/contexts/wallet-context';
import { useColorScheme } from '@/hooks/use-color-scheme';


function GlobalMusicButton() {
  const insets = useSafeAreaInsets();
  const music = useMusic();
  const isPlaying = music?.isPlaying ?? false;
  const audioReady = music?.audioReady ?? false;
  const togglePlayPause = music?.togglePlayPause ?? (() => {});

  return (
    <View
      pointerEvents="box-none"
      style={[styles.musicButtonWrap, { top: insets.top + 8 }]}
    >
      <Pressable
        onPress={togglePlayPause}
        style={({ pressed }) => [
          pressed && styles.musicButtonPressed,
          !audioReady && styles.musicButtonDisabled,
        ]}
        accessibilityLabel={audioReady ? (isPlaying ? 'Pause music' : 'Play music') : 'Music unavailable'}
        accessibilityRole="button"
      >
        <Image
          source={isPlaying && audioReady ? musicOnImage : musicOffImage}
          style={[styles.musicButtonImage, !audioReady && styles.musicButtonDisabled]}
        />
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
        <GameProvider>
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
        </GameProvider>
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
    right: 16,
    left: 0,
    zIndex: 9999,
    alignItems: 'flex-end',
    pointerEvents: 'box-none',
    ...(Platform.OS === 'android' ? { elevation: 9999 } : {}),
  },
  musicButtonImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  musicButtonPressed: {
    opacity: 0.85,
  },
  musicButtonDisabled: {
    opacity: 0.7,
  },
});
