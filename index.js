/**
 * Explicit entry so Expo does not use AppEntry.js (which looks for ../../App).
 * Uses the same pattern as expo-router but keeps the app entry in this repo.
 */
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
