/**
 * SoundService – plays short sound effects using expo-audio.
 *
 * Preloads sounds once, then replays on demand.
 */

import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

const CHIP_TOSS_SRC = require('../assets/sounds/chip-toss.mp3');
const CARD_SHUFFLE_SRC = require('../assets/sounds/card-shuffle.mp3');
const WIN_COINS_SRC = require('../assets/sounds/win-coins.mp3');

let chipPlayer: AudioPlayer | null = null;
let shufflePlayer: AudioPlayer | null = null;
let winPlayer: AudioPlayer | null = null;

function getChipPlayer(): AudioPlayer {
  if (!chipPlayer) {
    chipPlayer = createAudioPlayer(CHIP_TOSS_SRC);
    chipPlayer.volume = 0.5;
  }
  return chipPlayer;
}

function getShufflePlayer(): AudioPlayer {
  if (!shufflePlayer) {
    shufflePlayer = createAudioPlayer(CARD_SHUFFLE_SRC);
    shufflePlayer.volume = 0.6;
  }
  return shufflePlayer;
}

export function playChipToss(): void {
  try {
    const player = getChipPlayer();
    player.seekTo(0);
    player.play();
  } catch (err) {
    console.warn('[SoundService] chip-toss error:', err);
  }
}

function getWinPlayer(): AudioPlayer {
  if (!winPlayer) {
    winPlayer = createAudioPlayer(WIN_COINS_SRC);
    winPlayer.volume = 0.6;
  }
  return winPlayer;
}

export function playWinCoins(): void {
  try {
    const player = getWinPlayer();
    player.seekTo(0);
    player.play();
  } catch (err) {
    console.warn('[SoundService] win-coins error:', err);
  }
}

export function playCardShuffle(): void {
  try {
    const player = getShufflePlayer();
    player.seekTo(0);
    player.play();
  } catch (err) {
    console.warn('[SoundService] card-shuffle error:', err);
  }
}
