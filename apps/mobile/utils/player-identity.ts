/**
 * Stable player identity – persisted via AsyncStorage so the same
 * playerId survives app reloads, enabling socket reconnection.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_ID = '@goldenflop/playerId';
const STORAGE_KEY_NAME = '@goldenflop/playerName';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _playerId: string = generateUUID();
let _playerName: string = `PLAYER_${_playerId.slice(0, 4).toUpperCase()}`;

export async function loadIdentity(): Promise<void> {
  try {
    const [savedId, savedName] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ID),
      AsyncStorage.getItem(STORAGE_KEY_NAME),
    ]);
    if (savedId) {
      _playerId = savedId;
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_ID, _playerId);
    }
    if (savedName) {
      _playerName = savedName;
    } else {
      _playerName = `PLAYER_${_playerId.slice(0, 4).toUpperCase()}`;
      await AsyncStorage.setItem(STORAGE_KEY_NAME, _playerName);
    }
  } catch {
    // Fallback to in-memory values if storage fails
  }
}

export function getPlayerId(): string {
  return _playerId;
}

export function getPlayerName(): string {
  return _playerName;
}

export async function setPlayerName(name: string): Promise<void> {
  _playerName = name.trim().slice(0, 16).toUpperCase();
  try {
    await AsyncStorage.setItem(STORAGE_KEY_NAME, _playerName);
  } catch {
    // Silently fail — in-memory value is still updated
  }
}
