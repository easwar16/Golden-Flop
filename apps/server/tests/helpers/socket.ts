import { io as ioc, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@goldenflop/shared';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface CreateSocketOptions {
  playerId: string;
  playerName: string;
}

export function createSocketClient(url: string, opts: CreateSocketOptions): TestSocket {
  return ioc(url, {
    transports: ['websocket'],
    auth: {
      playerId: opts.playerId,
      playerName: opts.playerName,
    },
    autoConnect: false,
  }) as unknown as TestSocket;
}

export function connectSocket(socket: TestSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    socket.connect();
  });
}

export function disconnectSocket(socket: TestSocket): Promise<void> {
  return new Promise((resolve) => {
    if (!socket.connected) { resolve(); return; }
    socket.once('disconnect', () => resolve());
    socket.disconnect();
  });
}

export function waitForEvent<T = unknown>(
  socket: TestSocket,
  event: string,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for event: ${event}`)),
      timeout,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
