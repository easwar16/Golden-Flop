/**
 * Stable player identity – pure in-memory, no native modules required.
 * ID persists within the JS runtime session.
 */

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _playerId: string = generateUUID();
let _playerName: string = `PLAYER_${_playerId.slice(0, 4).toUpperCase()}`;

export async function loadIdentity(): Promise<void> {
  // Nothing to load — identity is generated once at module init
}

export function getPlayerId(): string {
  return _playerId;
}

export function getPlayerName(): string {
  return _playerName;
}

export async function setPlayerName(name: string): Promise<void> {
  _playerName = name.trim().slice(0, 16).toUpperCase();
}
