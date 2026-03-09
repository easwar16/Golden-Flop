/**
 * BotManager – spawns and removes bot players for practice tables.
 *
 * Lifecycle:
 *  1. Human joins a practice room → scheduleBot() called after 2s delay
 *  2. If no second human arrived, bot is added to the room via Room.addBot()
 *  3. Bot participates in hands; Room calls scheduleBotAction() on bot's turn
 *  4. When a real player joins → bot is removed after the current hand
 *  5. When the human leaves → bot is cleaned up
 */

import type { Room } from '../room/Room';
import { createBotIdentity, type BotIdentity } from './BotPlayer';

const BOT_SPAWN_DELAY_MS = 2_000;

/** roomId → spawn timer */
const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** roomId → active BotIdentity */
const activeBots = new Map<string, BotIdentity>();

/**
 * Called when a human player joins a practice room.
 * Schedules a bot spawn after BOT_SPAWN_DELAY_MS if no second human joins.
 */
export function scheduleBot(room: Room): void {
  // Only for practice tables
  if (!room.config.isPractice) return;

  // Cancel any pending spawn
  cancelScheduledBot(room.id);

  // Don't spawn if already 2+ real (non-bot) players
  if (getRealPlayerCount(room) >= 2) return;

  // Don't spawn if bot already active
  if (activeBots.has(room.id)) return;

  const timer = setTimeout(() => {
    spawnTimers.delete(room.id);
    spawnBotIfNeeded(room);
  }, BOT_SPAWN_DELAY_MS);

  spawnTimers.set(room.id, timer);
}

/**
 * Cancel a pending bot spawn (e.g. a second human joined in time).
 */
export function cancelScheduledBot(roomId: string): void {
  const timer = spawnTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    spawnTimers.delete(roomId);
  }
}

/**
 * Actually spawn the bot into the room if conditions are still met.
 */
function spawnBotIfNeeded(room: Room): void {
  // Re-check: still only 1 real player and no bot
  if (getRealPlayerCount(room) !== 1) return;
  if (activeBots.has(room.id)) return;

  const bot = createBotIdentity();
  const buyIn = room.config.maxBuyIn;

  const error = room.addBot(bot.id, bot.name, bot.avatarSeed, buyIn, bot.socketId);
  if (error) {
    console.error(`[BotManager] Failed to spawn bot in room ${room.id}: ${error}`);
    return;
  }

  activeBots.set(room.id, bot);
  console.log(`[BotManager] Bot "${bot.name}" spawned in room ${room.id}`);
}

/**
 * Remove the bot from a practice room.
 * Called when a second human joins or when the room empties.
 */
export function removeBot(room: Room): void {
  cancelScheduledBot(room.id);

  const bot = activeBots.get(room.id);
  if (!bot) return;

  room.removeBot(bot.socketId);
  activeBots.delete(room.id);
  console.log(`[BotManager] Bot "${bot.name}" removed from room ${room.id}`);
}

/**
 * Check if a given player ID belongs to an active bot.
 */
export function isBot(roomId: string, playerId: string): boolean {
  const bot = activeBots.get(roomId);
  return bot?.id === playerId;
}

/**
 * Check if a given socket ID belongs to a bot.
 */
export function isBotSocket(roomId: string, socketId: string): boolean {
  const bot = activeBots.get(roomId);
  return bot?.socketId === socketId;
}

/**
 * Get the bot identity for a room (if active).
 */
export function getBot(roomId: string): BotIdentity | undefined {
  return activeBots.get(roomId);
}

/**
 * Called when a human leaves a practice room.
 * If no real players remain, remove the bot.
 * If exactly 1 real player remains, re-schedule bot spawn for next hand.
 */
export function onHumanLeft(room: Room): void {
  if (!room.config.isPractice) return;

  const realCount = getRealPlayerCount(room);
  if (realCount === 0) {
    removeBot(room);
  }
}

/**
 * Called after a hand finishes in a practice room.
 * If a second real player joined during the hand, remove the bot.
 * If the human is still alone, keep the bot for the next hand.
 */
export function onHandFinished(room: Room): void {
  if (!room.config.isPractice) return;

  const realCount = getRealPlayerCount(room);
  const hasBot = activeBots.has(room.id);

  // Second human joined → remove bot after hand
  if (realCount >= 2 && hasBot) {
    removeBot(room);
    return;
  }

  // Human alone, no bot → schedule one
  if (realCount === 1 && !hasBot) {
    scheduleBot(room);
  }
}

function getRealPlayerCount(room: Room): number {
  return room.playerCount - (activeBots.has(room.id) ? 1 : 0);
}
