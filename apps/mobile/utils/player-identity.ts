/**
 * Stable player identity across the app session AND across restarts.
 *
 * Uses expo-secure-store to persist the UUID so the server's reconnect
 * grace period works even after the app is killed and relaunched.
 *
 * Install: npx expo install expo-secure-store
 */

import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values'; // must be first for crypto.getRandomValues

const KEY_ID   = 'goldenflop_player_id';
const KEY_NAME = 'goldenflop_player_name';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── In-memory cache (stays valid for the lifetime of this JS runtime) ─────────

let _playerId: string | null = null;
let _playerName: string | null = null;

// ── Boot: load from secure storage once, synchronously during module init ─────
// SecureStore.getItem is async, so we call the async loader eagerly and cache
// the result. Components that need the ID before it resolves get a fallback UUID
// that will be replaced once the promise settles.

let _bootPromise: Promise<void> | null = null;

export async function loadIdentity(): Promise<void> {
  if (_bootPromise) return _bootPromise;
  _bootPromise = (async () => {
    try {
      const storedId = await SecureStore.getItemAsync(KEY_ID);
      if (storedId) {
        _playerId = storedId;
      } else {
        _playerId = generateUUID();
        await SecureStore.setItemAsync(KEY_ID, _playerId);
      }

      const storedName = await SecureStore.getItemAsync(KEY_NAME);
      if (storedName) {
        _playerName = storedName;
      } else {
        _playerName = `PLAYER_${_playerId!.slice(0, 4).toUpperCase()}`;
        await SecureStore.setItemAsync(KEY_NAME, _playerName);
      }
    } catch {
      // SecureStore unavailable (Expo Go without dev-build, web): fall back to
      // module-level singleton.  Reconnect won't survive process kills, but the
      // game will still work normally within a session.
      if (!_playerId) _playerId = generateUUID();
      if (!_playerName) _playerName = `PLAYER_${_playerId.slice(0, 4).toUpperCase()}`;
    }
  })();
  return _bootPromise;
}

export function getPlayerId(): string {
  if (!_playerId) _playerId = generateUUID(); // synchronous fallback
  return _playerId;
}

export function getPlayerName(): string {
  if (!_playerName) _playerName = `PLAYER_${getPlayerId().slice(0, 4).toUpperCase()}`;
  return _playerName;
}

export async function setPlayerName(name: string): Promise<void> {
  _playerName = name.trim().slice(0, 16).toUpperCase();
  try {
    await SecureStore.setItemAsync(KEY_NAME, _playerName);
  } catch { /* silent */ }
}
