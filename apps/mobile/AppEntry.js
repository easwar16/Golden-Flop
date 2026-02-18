// @expo/metro-runtime MUST be first for Fast Refresh on web
import '@expo/metro-runtime';

import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

// Do NOT require react-native-track-player here — native module can be null at startup
// and causes "CAPABILITY_PLAY of null". Playback service is registered in music-context
// when the module is first loaded.

renderRootComponent(App);
