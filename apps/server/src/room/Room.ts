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
} from '../engine/GameEngine';
import { savePlayers } from '../redis/TableStore';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const HAND_START_DELAY_MS = 3_000;   // pause after hand result before next deal
const SHOWDOWN_REVEAL_MS = 2_000;    // time to show cards before distributing

// ─────────────────────────────────────────────────────────────────────────────
// Seated player record (separate from EnginePlayer – Room concerns)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  socketId: string;
  name: string;
  chips: number;
  seatIndex: number;
  isConnected: boolean;
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

  private handState: HandState | null = null;
  private dealerSeatIndex = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimeoutAt: number | null = null;

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

  get phase() {
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
    };
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
    buyIn: number,
    preferredSeat?: number,
  ): string | null {
    if (this.seats.size >= this.config.maxPlayers) return 'Table is full';
    if (buyIn < this.config.minBuyIn) return `Minimum buy-in is ${this.config.minBuyIn}`;
    if (buyIn > this.config.maxBuyIn) return `Maximum buy-in is ${this.config.maxBuyIn}`;

    // Validate preferred seat if specified
    if (preferredSeat !== undefined) {
      if (preferredSeat < 0 || preferredSeat >= this.config.maxPlayers) {
        return `Invalid seat index ${preferredSeat}`;
      }
      if (this.seats.has(preferredSeat)) {
        return `Seat ${preferredSeat} is already taken`;
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
      chips: buyIn,
      seatIndex,
      isConnected: true,
    };

    this.seats.set(seatIndex, player);
    this.socketToSeat.set(socket.id, seatIndex);
    socket.join(this.id);

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

    // Send current state to the new player
    this.emitStateTo(socket);

    // Start a hand if we now have enough players and none is running
    if (this.seats.size >= 2 && !this.handState) {
      setTimeout(() => this.startHand(), 1_000);
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

    this.broadcastState();

    if (this.seats.size < 2 && this.handState) {
      this.cancelHand();
    }
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

    // Brief pause so clients can display the final action
    await sleep(SHOWDOWN_REVEAL_MS);

    const result = resolveShowdown(this.handState);
    result.tableId = this.id;

    // Apply chip changes back to seats
    for (const r of result.allPlayers) {
      const seat = [...this.seats.values()].find(p => p.id === r.playerId);
      if (seat) {
        const ep = this.handState.players.find(p => p.id === r.playerId);
        if (ep) seat.chips = ep.chips + r.winAmount;
      }
    }

    this.io.to(this.id).emit('hand_result', result);

    this.handState = null;
    this.broadcastState();

    // Remove busted players (0 chips)
    for (const [seatIndex, player] of this.seats) {
      if (player.chips <= 0) this.seats.delete(seatIndex);
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

  /** Broadcast individualised state to every connected player. */
  broadcastState(): void {
    for (const player of this.seats.values()) {
      if (!player.isConnected) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) this.emitStateTo(socket);
    }
  }

  private emitStateTo(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
    const seatIndex = this.socketToSeat.get(socket.id);
    const player = seatIndex !== undefined ? this.seats.get(seatIndex) : undefined;
    socket.emit('table_state', this.buildStateFor(player?.id ?? null));
  }

  /** Build a filtered TableStatePayload for a specific recipient. */
  buildStateFor(recipientId: string | null): TableStatePayload {
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

    return {
      tableId: this.id,
      phase: hs?.phase ?? 'waiting',
      seats,
      communityCards: community,
      pot: hs?.pot ?? 0,
      sidePots: hs?.sidePots ?? [],
      currentBet: hs?.currentBet ?? 0,
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
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
