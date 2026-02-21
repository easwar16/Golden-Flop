/**
 * useSocketStore – tracks WebSocket connection state only.
 *
 * UI components read this to show connecting/reconnecting spinners.
 * No game logic lives here.
 */

import { create } from 'zustand';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface SocketState {
  status: ConnectionStatus;
  error: string | null;
  latencyMs: number | null;

  // Internal setters – called only by SocketService
  setStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  setLatency: (ms: number) => void;
}

export const useSocketStore = create<SocketState>()((set) => ({
  status: 'idle',
  error: null,
  latencyMs: null,

  setStatus: (status) => set({ status, error: status === 'connected' ? null : undefined }),
  setError: (error) => set({ error }),
  setLatency: (latencyMs) => set({ latencyMs }),
}));
