/**
 * Room – owns a single poker table's runtime state.
 *
 * Responsibilities:
 *  - Seat management (join / leave / reconnect)
 *  - Hand lifecycle (start → blinds → deal → action → advance → showdown)
 *  - Turn timer with auto-fold on timeout
 *  - Filtered state broadcasting (each player sees their own cards only)
 *  - Emitting typed socket events
 */

import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@goldenflop/shared';
import type {
  TableConfig,
  TableInfo,
  TableStatePayload,
  SeatView,
  HandResultPayload,
} from '@goldenflop/shared';
import type { HandState, EnginePlayer } from '../engine/types';
import {
  createHand,
  postBlinds,
  dealHoleCards,
  processAction,
  advancePhase,
  resolveShowdown,
  autoFold,
  calcMinRaise,
  activePlayer,
  applyRake,
} from '../engine/GameEngine';
import { savePlayers } from '../redis/TableStore';
import { recordHandResult } from '../services/game.service';
import { getRoom as getRoomConfig } from '../services/room.service';
import { processRakeTransfer } from '../solana/PayoutService';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const HAND_START_DELAY_MS = 5_000;   // pause after hand result before next deal
const SHOWDOWN_REVEAL_MS = 5_000;    // time to show cards before distributing
const RESERVATION_TIMEOUT_MS = 30_000; // auto-expire seat reservations after 30 seconds

// ─────────────────────────────────────────────────────────────────────────────
// Seated player record (separate from EnginePlayer – Room concerns)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  socketId: string;
  name: string;
  avatarSeed: string;
  chips: number;
  seatIndex: number;
  isConnected: boolean;
  /** Database user ID — null for guests. */
  userId?: string | null;
  /** Base58 wallet address — set when player joins via vault deposit. */
  walletAddress?: string | null;
  /** Whether this player joined via on-chain vault deposit (vs internal balance). */
  isVaultPlayer?: boolean;
}

export interface SeatReservation {
  playerId: string;
  playerName: string;
  avatarSeed: string;
  reservedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room
// ─────────────────────────────────────────────────────────────────────────────

export class Room {
  readonly id: string;
  readonly config: TableConfig;
  readonly name: string;
  readonly creatorId: string;

  /**
   * Persistent rooms (predefined tables) are never deleted from RoomManager
   * even when all players have left. Dynamic rooms created by players are not
   * persistent and are cleaned up when empty.
   */
  readonly isPersistent: boolean;

  /** seatIndex (0–maxPlayers-1) → RoomPlayer | null */
  private seats: Map<number, RoomPlayer> = new Map();
  /** socketId → seatIndex */
  private socketToSeat: Map<string, number> = new Map();
  /** seatIndex → SeatReservation (pre-wallet-tx locks) */
  private reservations: Map<number, SeatReservation> = new Map();

  private handState: HandState | null = null;
  private dealerSeatIndex = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimeoutAt: number | null = null;

  // ── Countdown state ───────────────────────────────────────────────────────
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private countdownSecondsRemaining = 0;
  private static readonly COUNTDOWN_SECONDS = 3;

  private io: IO;

  constructor(
    io: IO,
    id: string,
    name: string,
    creatorId: string,
    config: TableConfig,
    isPersistent = false,
  ) {
    this.io = io;
    this.id = id;
    this.name = name;
    this.creatorId = creatorId;
    this.config = config;
    this.isPersistent = isPersistent;
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get playerCount(): number {
    return this.seats.size;
  }

  get phase(): import('@goldenflop/shared').GamePhase {
    if (this.countdownTimer !== null) return 'countdown';
    return this.handState?.phase ?? 'waiting';
  }

  toTableInfo(): TableInfo {
    return {
      id: this.id,
      name: this.name,
      creator: this.creatorId,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      playerCount: this.playerCount,
      maxPlayers: this.config.maxPlayers,
      phase: this.phase,
      tokenMint: this.config.tokenMint,
      isPremium: this.config.isPremium,
      isPersistent: this.isPersistent,
      occupiedSeats: [...this.seats.keys()],
      reservedSeats: [...this.reservations.keys()],
    };
  }

  /**
   * Get a seated player by their player ID.
   * Useful for external services (SocketHandler) to inspect player state.
   */
  getPlayerById(playerId: string): RoomPlayer | undefined {
    return [...this.seats.values()].find(p => p.id === playerId);
  }

  /**
   * Get a seated player by their socket ID.
   */
  getPlayerBySocketId(socketId: string): RoomPlayer | undefined {
    const seatIndex = this.socketToSeat.get(socketId);
    if (seatIndex === undefined) return undefined;
    return this.seats.get(seatIndex);
  }

  // ─── Seat reservations (pre-wallet-tx lock) ─────────────────────────────

  /**
   * Reserve a seat for a player before they initiate a wallet transaction.
   * Returns null on success or an error string.
   */
  reserveSeat(playerId: string, playerName: string, avatarSeed: string, seatIndex: number): string | null {
    if (seatIndex < 0 || seatIndex >= this.config.maxPlayers) {
      return `Invalid seat index ${seatIndex}`;
    }
    if (this.seats.has(seatIndex)) {
      return 'Seat is already occupied';
    }

    // Check if reserved by another player
    const existing = this.reservations.get(seatIndex);
    if (existing && existing.playerId !== playerId) {
      return 'Seat is reserved by another player';
    }

    // Release any other reservation this player holds (only one at a time)
    for (const [idx, res] of this.reservations) {
      if (res.playerId === playerId && idx !== seatIndex) {
        clearTimeout(res.timeoutHandle);
        this.reservations.delete(idx);
        this.io.to(this.id).emit('seat_released', { tableId: this.id, seatIndex: idx });
      }
    }

    // If same player re-reserves same seat, refresh the timeout
    if (existing && existing.playerId === playerId) {
      clearTimeout(existing.timeoutHandle);
    }

    const timeoutHandle = setTimeout(() => {
      this.releaseReservation(seatIndex, playerId);
    }, RESERVATION_TIMEOUT_MS);

    this.reservations.set(seatIndex, {
      playerId,
      playerName,
      avatarSeed,
      reservedAt: Date.now(),
      timeoutHandle,
    });

    this.io.to(this.id).emit('seat_reserved', {
      tableId: this.id,
      seatIndex,
      playerId,
      playerName,
      avatarSeed,
    });

    return null;
  }

  /**
   * Release a seat reservation. If playerId is provided, only release if the
   * reservation belongs to that player.
   */
  releaseReservation(seatIndex: number, playerId?: string): void {
    const res = this.reservations.get(seatIndex);
    if (!res) return;
    if (playerId && res.playerId !== playerId) return;

    const heldMs = Date.now() - res.reservedAt;
    console.log(`[reservation] released seat ${seatIndex} for ${res.playerName} after ${heldMs}ms (caller: ${playerId ?? 'timeout'})`);

    clearTimeout(res.timeoutHandle);
    this.reservations.delete(seatIndex);
    this.io.to(this.id).emit('seat_released', { tableId: this.id, seatIndex });
  }

  /** Release all reservations for a given player (e.g. on disconnect or seat taken). */
  releaseAllReservationsFor(playerId: string): void {
    for (const [seatIndex, res] of this.reservations) {
      if (res.playerId === playerId) {
        const heldMs = Date.now() - res.reservedAt;
        console.log(`[reservation] releaseAll seat ${seatIndex} for ${res.playerName} after ${heldMs}ms (player: ${playerId})`);
        clearTimeout(res.timeoutHandle);
        this.reservations.delete(seatIndex);
        this.io.to(this.id).emit('seat_released', { tableId: this.id, seatIndex });
      }
    }
  }

  // ─── Join / Leave / Reconnect ─────────────────────────────────────────────

  /**
   * Sit a player at the table.
   *
   * @param preferredSeat  Optional 0-based seat index. If omitted or taken,
   *                       the first available seat is used.
   * @returns null on success, or an error string.
   */
  join(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    playerId: string,
    playerName: string,
    avatarSeed: string,
    buyIn: number,
    preferredSeat?: number,
    opts?: { userId?: string | null; walletAddress?: string | null; isVaultPlayer?: boolean },
  ): string | null {
    if (this.seats.size >= this.config.maxPlayers) return 'Table is full';
    if (buyIn < this.config.minBuyIn) return `Minimum buy-in is ${this.config.minBuyIn}`;
    if (buyIn > this.config.maxBuyIn) return `Maximum buy-in is ${this.config.maxBuyIn}`;

    // Prevent double-seating the same player
    for (const p of this.seats.values()) {
      if (p.id === playerId) return 'Already seated at this table';
    }

    // Validate preferred seat if specified
    if (preferredSeat !== undefined) {
      if (preferredSeat < 0 || preferredSeat >= this.config.maxPlayers) {
        return `Invalid seat index ${preferredSeat}`;
      }
      if (this.seats.has(preferredSeat)) {
        return `Seat ${preferredSeat} is already taken`;
      }
      // Block if reserved by another player
      const reservation = this.reservations.get(preferredSeat);
      if (reservation && reservation.playerId !== playerId) {
        return `Seat ${preferredSeat} is reserved by another player`;
      }
    }

    // Assign seat
    let seatIndex: number;
    if (preferredSeat !== undefined) {
      seatIndex = preferredSeat;
    } else {
      const takenSeats = new Set(this.seats.keys());
      seatIndex = -1;
      for (let i = 0; i < this.config.maxPlayers; i++) {
        if (!takenSeats.has(i)) { seatIndex = i; break; }
      }
      if (seatIndex === -1) return 'No available seat';
    }

    const player: RoomPlayer = {
      id: playerId,
      socketId: socket.id,
      name: playerName,
      avatarSeed,
      chips: buyIn,
      seatIndex,
      isConnected: true,
      userId: opts?.userId ?? null,
      walletAddress: opts?.walletAddress ?? null,
      isVaultPlayer: opts?.isVaultPlayer ?? false,
    };

    this.seats.set(seatIndex, player);
    this.socketToSeat.set(socket.id, seatIndex);
    socket.join(this.id);

    // Clear reservation now that the player is seated
    this.releaseAllReservationsFor(playerId);

    // Persist seat state to Redis
    void this.persistSeats();

    // Broadcast join event to others
    this.io.to(this.id).emit('player_joined', {
      tableId: this.id,
      playerId,
      playerName,
      seatIndex,
      chips: buyIn,
    });

    // Broadcast updated state to all seated players + observers in the room
    this.broadcastState();

    // Start countdown when second player joins (if no hand running + not already counting)
    if (this.seats.size >= 2 && !this.handState && !this.countdownTimer) {
      this.startCountdown();
    }

    return null;
  }

  /**
   * Restore a previously-seated player from Redis (no socket yet).
   * Called by TableRegistry on server startup. The player's socket is set to
   * empty string; once they reconnect the normal reconnect() path updates it.
   */
  restorePlayer(player: RoomPlayer): void {
    this.seats.set(player.seatIndex, player);
    // Don't add to socketToSeat — socket is stale after a restart
  }

  leave(socketId: string): void {
    const seatIndex = this.socketToSeat.get(socketId);
    if (seatIndex === undefined) return;

    const player = this.seats.get(seatIndex);
    if (!player) return;

    this.seats.delete(seatIndex);
    this.socketToSeat.delete(socketId);

    // Persist updated seat list to Redis
    void this.persistSeats();

    this.io.to(this.id).emit('player_left', {
      tableId: this.id,
      playerId: player.id,
      seatIndex,
    });


    // If it's the leaving player's turn, auto-fold them
    if (this.handState) {
      const ap = activePlayer(this.handState);
      if (ap?.id === player.id) {
        this.handleAutoFold(player.id);
        return;
      }
    }

    // Cancel countdown if not enough players remain
    if (this.seats.size < 2 && this.countdownTimer) {
      this.clearCountdown();
    }

    if (this.seats.size < 2 && this.handState) {
      this.cancelHand();
      return;
    }

    this.broadcastState();
  }

  reconnect(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, playerId: string): boolean {
    for (const [seatIndex, player] of this.seats) {
      if (player.id === playerId) {
        // Update socket reference
        const oldSocketId = player.socketId;
        player.socketId = socket.id;
        player.isConnected = true;
        this.socketToSeat.delete(oldSocketId);
        this.socketToSeat.set(socket.id, seatIndex);
        socket.join(this.id);

        // Update EnginePlayer if hand is running
        if (this.handState) {
          const ep = this.handState.players.find(p => p.id === playerId);
          if (ep) ep.isConnected = true;
        }

        socket.emit('reconnect_state', this.buildStateFor(playerId));
        return true;
      }
    }
    return false;
  }

  // ─── Player action (from socket) ──────────────────────────────────────────

  handleAction(socketId: string, action: import('@goldenflop/shared').PlayerAction, amount?: number): void {
    if (!this.handState) return;

    const seatIndex = this.socketToSeat.get(socketId);
    if (seatIndex === undefined) return;

    const player = this.seats.get(seatIndex);
    if (!player) return;

    // Silently ignore actions from players who can't act (folded, all-in, or not their turn)
    const ap = activePlayer(this.handState);
    if (!ap || ap.id !== player.id) return;
    const ep = this.handState.players.find(p => p.id === player.id);
    if (!ep || ep.isFolded || ep.isAllIn) return;

    let result;
    try {
      result = processAction(this.handState, player.id, action, amount);
    } catch (e: unknown) {
      const socket = this.io.sockets.sockets.get(socketId);
      socket?.emit('error', { code: 'INVALID_ACTION', message: (e as Error).message });
      return;
    }

    this.clearTurnTimer();
    this.handState = result.state;

    // Echo ack to acting player
    const socket = this.io.sockets.sockets.get(socketId);
    socket?.emit('action_ack', {
      tableId: this.id,
      playerId: player.id,
      action,
      amount: result.amount,
    });

    if (result.handComplete) {
      this.finishHand();
    } else if (result.roundComplete) {
      this.handState = advancePhase(this.handState);
      this.afterAdvance();
    } else {
      this.broadcastState();
      this.startTurnTimer();
    }
  }

  /**
   * Called after every advancePhase.
   * If all remaining players are all-in (no one can voluntarily act) we fast-forward
   * through the remaining streets automatically with a short broadcast pause between each.
   */
  private afterAdvance(): void {
    if (!this.handState) return;

    if (this.handState.phase === 'showdown') {
      this.finishHand();
      return;
    }

    const canAct = this.handState.players.filter(p => !p.isFolded && !p.isAllIn);
    if (canAct.length === 0) {
      // All-in runout: show the current street then advance automatically
      this.broadcastState();
      setTimeout(() => {
        if (!this.handState) return;
        this.handState = advancePhase(this.handState);
        this.afterAdvance();
      }, 1_500);
    } else {
      this.broadcastState();
      this.startTurnTimer();
    }
  }

  // ─── Countdown ────────────────────────────────────────────────────────────

  private startCountdown(): void {
    if (this.countdownTimer || this.handState) return;
    if (this.seats.size < 2) return;

    this.countdownSecondsRemaining = Room.COUNTDOWN_SECONDS;
    this.broadcastState(); // immediately show 'countdown' phase

    this.countdownTimer = setInterval(() => {
      this.countdownSecondsRemaining--;

      if (this.countdownSecondsRemaining <= 0) {
        this.clearCountdown();
        this.startHand();
      } else {
        this.broadcastState(); // tick: clients see updated secondsRemaining
      }
    }, 1_000);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownSecondsRemaining = 0;
    // Broadcast so clients see the phase revert to 'waiting' if cancelled
    this.broadcastState();
  }

  // ─── Hand lifecycle ───────────────────────────────────────────────────────

  private startHand(): void {
    const seated = [...this.seats.values()];
    if (seated.length < 2) return;

    // Rotate dealer button
    const seatIndices = seated.map(p => p.seatIndex).sort((a, b) => a - b);
    const currentDealerPos = seatIndices.indexOf(this.dealerSeatIndex);
    this.dealerSeatIndex = seatIndices[(currentDealerPos + 1) % seatIndices.length];

    const seed = uuid();
    const seatInputs = seated.map(p => ({
      id: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      chips: p.chips,
    }));

    let state = createHand(seatInputs, this.config, this.dealerSeatIndex, seed);
    state = postBlinds(state);
    state = dealHoleCards(state);

    this.handState = state;

    this.io.to(this.id).emit('game_started', {
      tableId: this.id,
      handId: state.handId,
    });

    this.broadcastState();
    this.startTurnTimer();
  }

  private async finishHand(): Promise<void> {
    if (!this.handState) return;

    // Capture state before the async sleep — players leaving during the delay
    // would null out this.handState, causing a crash in resolveShowdown.
    const handState = this.handState;

    // Brief pause so clients can display the final action
    await sleep(SHOWDOWN_REVEAL_MS);

    // Guard: hand may have been cancelled (e.g. all players left) during the sleep
    if (!this.handState) return;

    const result = resolveShowdown(handState);
    result.tableId = this.id;

    // ── Rake calculation ────────────────────────────────────────────────────
    let rakeAmount = 0;
    const roomConfig = await getRoomConfig(this.id).catch(() => null);
    const rakePercentage = roomConfig?.rakePercentage ?? 0;
    const rakeCap = Number(roomConfig?.rakeCap ?? 0);
    const totalPot = handState.pot;

    if (rakePercentage > 0 && result.allPlayers.some(p => p.winAmount > 0)) {
      const { rakeAmount: rake } = applyRake(totalPot, rakePercentage, rakeCap);
      rakeAmount = rake;

      // Deduct rake proportionally from winners
      if (rakeAmount > 0) {
        const winners = result.allPlayers.filter(p => p.winAmount > 0);
        const totalWinnings = winners.reduce((sum, w) => sum + w.winAmount, 0);
        let rakeRemaining = rakeAmount;

        for (const winner of winners) {
          const share = Math.floor(rakeAmount * (winner.winAmount / totalWinnings));
          const deduction = Math.min(share, winner.winAmount, rakeRemaining);
          winner.winAmount -= deduction;
          rakeRemaining -= deduction;
        }
        // Distribute remainder from first winner
        if (rakeRemaining > 0 && winners.length > 0) {
          const deduction = Math.min(rakeRemaining, winners[0].winAmount);
          winners[0].winAmount -= deduction;
        }

        // Transfer rake on-chain to treasury (fire-and-forget)
        const winnerSeatForRake = [...this.seats.values()].find(
          (p: RoomPlayer) => winners.some(w => w.playerId === p.id),
        );
        if (winnerSeatForRake?.userId) {
          void processRakeTransfer(this.id, BigInt(rakeAmount), winnerSeatForRake.userId);
        }
      }
    }

    // Apply chip changes back to seats
    const playerResults = [];
    for (const r of result.allPlayers) {
      const seat = [...this.seats.values()].find(p => p.id === r.playerId);
      if (seat) {
        const ep = handState.players.find(p => p.id === r.playerId);
        if (ep) {
          const startChips = ep.chips + ep.totalContributed;
          seat.chips = ep.chips + r.winAmount;
          playerResults.push({
            playerId: r.playerId,
            name: r.name,
            seatIndex: r.seatIndex,
            startChips,
            endChips: seat.chips,
            winAmount: r.winAmount,
          });
        }
      }
    }

    this.io.to(this.id).emit('hand_result', result);

    // ── Persist game result to PostgreSQL (fire-and-forget) ─────────────────
    const firstWinner = result.allPlayers.find(p => p.winAmount > 0);
    if (firstWinner) {
      // Use the DB userId (not the socket playerId) for the FK; null for guests
      const winnerSeat = [...this.seats.values()].find((p: RoomPlayer) => p.id === firstWinner.playerId);
      void recordHandResult({
        handId:     handState.handId,
        tableId:    this.id,
        roomId:     this.id,  // For predefined tables, room ID = table ID
        winnerId:   winnerSeat?.userId ?? null,
        potSize:    totalPot,
        rakeAmount,
        players:    playerResults,
      });
    }

    this.handState = null;
    this.broadcastState();

    // Remove busted players (0 chips) and notify them
    for (const [seatIndex, player] of this.seats) {
      if (player.chips <= 0) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('player_kicked', { tableId: this.id, reason: 'Your balance reached 0.' });
          socket.leave(this.id);
        }
        this.socketToSeat.delete(player.socketId);
        this.seats.delete(seatIndex);
        this.io.to(this.id).emit('player_left', {
          tableId: this.id,
          playerId: player.id,
          seatIndex,
        });
        this.addSeatCooldown(seatIndex, player);
      }
    }

    // Persist updated chip counts to Redis
    void this.persistSeats();

    // Start next hand after delay if enough players remain
    if (this.seats.size >= 2) {
      setTimeout(() => this.startHand(), HAND_START_DELAY_MS);
    }
  }

  private cancelHand(): void {
    this.clearTurnTimer();
    // Refund chips to remaining players
    if (this.handState) {
      for (const ep of this.handState.players) {
        const seat = [...this.seats.values()].find(p => p.id === ep.id);
        if (seat) seat.chips = ep.chips + ep.totalContributed;
      }
    }
    this.handState = null;
    this.broadcastState();
    void this.persistSeats();
  }

  // ─── Redis persistence ────────────────────────────────────────────────────

  /** Serialize current seats to Redis. Fire-and-forget. */
  private async persistSeats(): Promise<void> {
    const players = [...this.seats.values()].map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      seatIndex: p.seatIndex,
    }));
    await savePlayers(this.id, players);
  }

  // ─── Turn timer ───────────────────────────────────────────────────────────

  private startTurnTimer(): void {
    this.clearTurnTimer();
    if (!this.handState) return;

    const ap = activePlayer(this.handState);
    if (!ap) return;

    const timeoutMs = this.config.turnTimeoutMs;
    this.turnTimeoutAt = Date.now() + timeoutMs;

    // Notify the active player
    const seat = [...this.seats.values()].find(p => p.id === ap.id);
    if (seat) {
      const socket = this.io.sockets.sockets.get(seat.socketId);
      socket?.emit('turn_start', {
        tableId: this.id,
        playerId: ap.id,
        seatIndex: ap.seatIndex,
        timeoutAt: this.turnTimeoutAt,
        minRaise: calcMinRaise(this.handState),
        maxRaise: ap.chips,
        callAmount: Math.min(
          this.handState.currentBet - ap.currentBet,
          ap.chips,
        ),
      });
    }

    this.broadcastState();

    this.turnTimer = setTimeout(() => {
      this.handleAutoFold(ap.id);
    }, timeoutMs);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnTimeoutAt = null;
  }

  private handleAutoFold(playerId: string): void {
    if (!this.handState) return;
    // Guard: only fold if this player is still the active player
    const ap = activePlayer(this.handState);
    if (!ap || ap.id !== playerId) return;
    // Guard: player may have already folded or gone all-in (race with disconnect/leave)
    const ep = this.handState.players.find(p => p.id === playerId);
    if (!ep || ep.isFolded || ep.isAllIn) return;
    const result = autoFold(this.handState, playerId);
    this.handState = result.state;

    if (result.handComplete) {
      this.finishHand();
    } else if (result.roundComplete) {
      this.handState = advancePhase(this.handState);
      this.afterAdvance();
    } else {
      this.broadcastState();
      this.startTurnTimer();
    }
  }

  // ─── State broadcasting ───────────────────────────────────────────────────

  /** Broadcast individualised state to every connected player and public state to observers. */
  broadcastState(): void {
    const seatedSocketIds = new Set<string>();

    for (const player of this.seats.values()) {
      if (!player.isConnected) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        this.emitStateTo(socket);
        seatedSocketIds.add(player.socketId);
      }
    }

    // Send public state (no hole cards) to observer sockets in the room
    const publicState = this.buildStateFor(null);
    const roomSockets = this.io.sockets.adapter.rooms.get(this.id);
    console.log(`[broadcastState] room=${this.id} roomSockets=${roomSockets?.size ?? 0} seated=${seatedSocketIds.size}`);
    if (roomSockets) {
      for (const socketId of roomSockets) {
        if (!seatedSocketIds.has(socketId)) {
          const socket = this.io.sockets.sockets.get(socketId);
          console.log(`[broadcastState] sending to observer ${socketId} found=${!!socket}`);
          socket?.emit('table_state', publicState);
        }
      }
    }
  }

  private emitStateTo(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
    const seatIndex = this.socketToSeat.get(socket.id);
    const player = seatIndex !== undefined ? this.seats.get(seatIndex) : undefined;
    socket.emit('table_state', this.buildStateFor(player?.id ?? null));
  }

  /** Build a filtered TableStatePayload for a specific recipient (public if null). */
  public buildStateFor(recipientId: string | null): TableStatePayload {
    const hs = this.handState;
    const ap = hs ? activePlayer(hs) : null;
    const recipientSeat = recipientId
      ? [...this.seats.values()].find(p => p.id === recipientId)
      : undefined;

    // Build per-seat views
    const seats: (SeatView | null)[] = Array.from(
      { length: this.config.maxPlayers },
      (_, i) => {
        const roomPlayer = this.seats.get(i);
        if (!roomPlayer) return null;

        const ep = hs?.players.find(p => p.id === roomPlayer.id);
        const isRecipient = roomPlayer.id === recipientId;
        const isShowdown = hs?.phase === 'showdown';

        let holeCards: (import('@goldenflop/shared').CardValue | null)[] = [null, null];
        if (ep?.holeCards) {
          if (isRecipient || isShowdown) {
            holeCards = ep.holeCards;
          }
          // else: opponent cards stay hidden
        }

        return {
          seatIndex: i,
          playerId: roomPlayer.id,
          name: roomPlayer.name,
          avatarSeed: roomPlayer.avatarSeed,
          chips: ep ? ep.chips : roomPlayer.chips,
          isDealer: hs ? hs.players[hs.dealerIndex]?.id === roomPlayer.id : false,
          isSmallBlind: hs ? hs.players[hs.smallBlindIndex]?.id === roomPlayer.id : false,
          isBigBlind: hs ? hs.players[hs.bigBlindIndex]?.id === roomPlayer.id : false,
          isFolded: ep?.isFolded ?? false,
          isAllIn: ep?.isAllIn ?? false,
          isConnected: roomPlayer.isConnected,
          currentBet: ep?.currentBet ?? 0,
          holeCards,
        };
      }
    );

    // Community cards padded to 5
    const community: (import('@goldenflop/shared').CardValue | null)[] = Array.from(
      { length: 5 },
      (_, i) => hs?.communityCards[i] ?? null,
    );

    const recipientEp = recipientId && hs
      ? hs.players.find(p => p.id === recipientId)
      : null;

    // Dealer / blind seat indices (in terms of seatIndex, not player array index)
    const dealerSeatIdx = hs ? (hs.players[hs.dealerIndex]?.seatIndex ?? 0) : 0;
    const sbSeatIdx = hs ? (hs.players[hs.smallBlindIndex]?.seatIndex ?? 0) : 0;
    const bbSeatIdx = hs ? (hs.players[hs.bigBlindIndex]?.seatIndex ?? 0) : 0;

    const minRaise = hs ? calcMinRaise(hs) : this.config.bigBlind;
    const maxRaise = recipientEp?.chips ?? 0;

    // Build reserved seats info
    const reservedSeats = [...this.reservations.entries()].map(([idx, res]) => ({
      seatIndex: idx,
      playerId: res.playerId,
      playerName: res.playerName,
      avatarSeed: res.avatarSeed,
    }));

    return {
      tableId: this.id,
      phase: this.countdownTimer !== null ? 'countdown' : (hs?.phase ?? 'waiting'),
      countdownSeconds: this.countdownSecondsRemaining,
      seats,
      communityCards: community,
      pot: hs?.pot ?? 0,
      sidePots: hs?.sidePots ?? [],
      currentBet: hs?.currentBet ?? 0,
      reservedSeats,
      minRaise,
      maxRaise,
      activePlayerSeatIndex: ap?.seatIndex ?? null,
      dealerSeatIndex: dealerSeatIdx,
      smallBlindSeatIndex: sbSeatIdx,
      bigBlindSeatIndex: bbSeatIdx,
      turnTimeoutAt: ap?.id === recipientId ? this.turnTimeoutAt : null,
      mySeatIndex: recipientSeat?.seatIndex ?? null,
      myHand: recipientEp?.holeCards ?? [null, null],
      isMyTurn: ap?.id === recipientId,
      myChips: recipientEp?.chips ?? recipientSeat?.chips ?? 0,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
