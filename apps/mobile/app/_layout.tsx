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
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

SplashScreen.preventAutoHideAsync();

import { GameProvider } from '@/contexts/game-context';
import { WalletProvider } from '@/contexts/wallet-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <WalletProvider>
        <GameProvider>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="table/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="light" />
        </GameProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
