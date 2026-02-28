/**
 * SocketService – singleton Socket.io client.
 *
 * Rules:
 *  - Only this file touches the socket.
 *  - All server events are translated into Zustand store updates here.
 *  - Components never import `socket` directly; they call SocketService methods.
 *  - Actions are fire-and-forget; the server's `table_state` broadcast is the
 *    canonical response (no optimistic updates needed).
 */

import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../stores/useGameStore';
import { useLobbyStore } from '../stores/useLobbyStore';
import { useSocketStore } from '../stores/useSocketStore';

// ─── Server address ───────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_SERVER_URL in .env.local (gitignored).
// Physical device: use your machine's LAN IP, e.g. http://192.168.x.x:4000
// Simulator/emulator: http://localhost:4000
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

// ─── Types (mirrors @goldenflop/shared events) ────────────────────────────────

type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

interface CreateTablePayload {
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers?: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

class SocketServiceClass {
  private socket: Socket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * @param playerId    local UUID (game identity)
   * @param playerName  display name
   * @param avatarSeed  seed string for deterministic avatar generation
   * @param jwtToken    optional JWT from AuthContext — enables balance checks
   */
  connect(playerId: string, playerName: string, avatarSeed?: string | null, jwtToken?: string | null): void {
    if (this.socket?.connected) return;

    useSocketStore.getState().setStatus('connecting');

    this.socket = io(SERVER_URL, {
      transports: ['websocket'],  // React Native: no polling
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      // token is optional: present = authenticated player with balance checks
      //                    absent  = guest/practice mode
      auth: {
        playerId,
        playerName,
        ...(avatarSeed ? { avatarSeed } : {}),
        ...(jwtToken ? { token: jwtToken } : {}),
      },
    });

    this.bindEvents();
  }

  disconnect(): void {
    this.clearPing();
    this.socket?.disconnect();
    this.socket = null;
    useSocketStore.getState().setStatus('disconnected');
    useGameStore.getState().reset();
  }

  // ── Room actions ───────────────────────────────────────────────────────

  async createTable(payload: CreateTablePayload): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.socket) { resolve(null); return; }
      this.socket.emit('create_table', payload, (tableId: string) => {
        resolve(tableId || null);
      });
    });
  }

  async joinTable(tableId: string, buyIn: number, playerName: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.socket) { resolve('Not connected'); return; }
      useGameStore.getState().setIsJoining(true);
      this.socket.emit(
        'join_table',
        { tableId, buyIn, playerName },
        (err: string | null) => {
          if (err) {
            useGameStore.getState().setIsJoining(false);
          }
          resolve(err);
        }
      );
    });
  }

  async sitAtSeat(tableId: string, buyIn: number, seatIndex?: number, avatarSeed?: string, playerName?: string): Promise<{ seatIndex: number } | { error: string }> {
    return new Promise((resolve) => {
      if (!this.socket) { resolve({ error: 'Not connected' }); return; }
      useGameStore.getState().setIsJoining(true);
      this.socket.emit(
        'sit_at_seat',
        { tableId, buyIn, seatIndex, avatarSeed, playerName },
        (res: { seatIndex: number } | { error: string }) => {
          if ('error' in res) {
            useGameStore.getState().setIsJoining(false);
          }
          resolve(res);
        }
      );
    });
  }

  watchTable(tableId: string): void {
    this.socket?.emit('watch_table', { tableId });
  }

  leaveTable(tableId: string): void {
    this.socket?.emit('leave_table', { tableId });
    useGameStore.getState().reset();
  }

  requestTables(): void {
    this.socket?.emit('request_tables');
  }

  // ── Game actions ───────────────────────────────────────────────────────

  sendAction(tableId: string, action: PlayerAction, amount?: number): void {
    if (!this.socket) return;
    this.socket.emit('player_action', { tableId, action, amount });
  }

  // ── Event wiring ───────────────────────────────────────────────────────

  private bindEvents(): void {
    const s = this.socket!;

    s.on('connect', () => {
      console.log('[socket] connected');
      useSocketStore.getState().setStatus('connected');
      this.startPing();
      // Refresh lobby on every (re)connect
      s.emit('request_tables');
    });

    s.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
      this.clearPing();
      // 'io server disconnect' = intentional; others = network drop
      const isIntentional = reason === 'io server disconnect';
      useSocketStore.getState().setStatus(isIntentional ? 'disconnected' : 'reconnecting');
    });

    s.on('connect_error', (err) => {
      console.warn('[socket] connect error:', err.message);
      useSocketStore.getState().setError(err.message);
      useSocketStore.getState().setStatus('reconnecting');
    });

    // ── Game events ──────────────────────────────────────────────────────

    s.on('table_state', (payload) => {
      useGameStore.getState().applyTableState(payload);
    });

    s.on('reconnect_state', (payload) => {
      useGameStore.getState().applyTableState(payload);
    });

    s.on('hand_result', (payload) => {
      useGameStore.getState().applyHandResult(payload);
    });

    // ── Lobby events ─────────────────────────────────────────────────────

    s.on('tables_list', (tables) => {
      useLobbyStore.getState().setTables(tables);
    });

    // When any player joins, re-request table state so observers see the updated seats
    s.on('player_joined', (payload: { tableId: string }) => {
      s.emit('watch_table', { tableId: payload.tableId });
    });

    // ── Diagnostics ──────────────────────────────────────────────────────

    s.on('error', (payload: { code: string; message: string }) => {
      console.error('[socket] server error:', payload.code, payload.message);
      useSocketStore.getState().setError(payload.message);
    });
  }

  // ── Latency ping ───────────────────────────────────────────────────────

  private startPing(): void {
    this.clearPing();
    this.pingInterval = setInterval(() => {
      if (!this.socket?.connected) return;
      const t0 = Date.now();
      this.socket.volatile.emit('ping', () => {
        useSocketStore.getState().setLatency(Date.now() - t0);
      });
    }, 5_000);
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ── Utils ──────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const SocketService = new SocketServiceClass();
