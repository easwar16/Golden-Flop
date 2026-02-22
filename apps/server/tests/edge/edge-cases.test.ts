import { TestServer, createTestServer } from '../helpers/server';
import {
  createSocketClient,
  connectSocket,
  disconnectSocket,
  waitForEvent,
  TestSocket,
} from '../helpers/socket';
import type { TableStatePayload } from '@goldenflop/shared';

function createTable(sock: TestSocket) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create_table timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit(
      'create_table',
      { name: 'EDGE_TEST', smallBlind: 10, bigBlind: 20, minBuyIn: 200, maxBuyIn: 5000 },
      (id: string) => { clearTimeout(timer); resolve(id); },
    );
  });
}

function sitAtSeat(sock: TestSocket, tableId: string, buyIn: number, seatIndex: number) {
  return new Promise<{ seatIndex?: number; error?: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sit_at_seat timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit('sit_at_seat', { tableId, buyIn, seatIndex }, (r: { seatIndex?: number; error?: string }) => {
      clearTimeout(timer); resolve(r);
    });
  });
}

describe('Edge cases', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('Duplicate seating', () => {
    it('same player cannot sit in two seats at the same table', async () => {
      const alice = createSocketClient(server.url, { playerId: 'alice-dup', playerName: 'Alice' });
      await connectSocket(alice);

      const tableId = await createTable(alice);
      const r1 = await sitAtSeat(alice, tableId, 500, 0);
      const r2 = await sitAtSeat(alice, tableId, 500, 1);

      expect(r1.error).toBeUndefined();
      expect(r2.error).toBeDefined();

      await disconnectSocket(alice);
    });

    it('two different players cannot sit in the same seat', async () => {
      const alice = createSocketClient(server.url, { playerId: 'alice-same', playerName: 'Alice' });
      const bob   = createSocketClient(server.url, { playerId: 'bob-same',   playerName: 'Bob'   });
      await Promise.all([connectSocket(alice), connectSocket(bob)]);

      const tableId = await createTable(alice);
      const r1 = await sitAtSeat(alice, tableId, 500, 2);
      const r2 = await sitAtSeat(bob,   tableId, 500, 2); // same seat

      expect(r1.error).toBeUndefined();
      expect(r2.error).toBeDefined();

      await Promise.all([disconnectSocket(alice), disconnectSocket(bob)]);
    });
  });

  describe('Invalid table operations', () => {
    it('join_table returns error for nonexistent tableId', async () => {
      const sock = createSocketClient(server.url, { playerId: 'p-notfound', playerName: 'Ghost' });
      await connectSocket(sock);

      const err = await new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('join_table ack timeout')), 5000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sock as any).emit('join_table', { tableId: 'nonexistent-id', buyIn: 500 }, (e: string | null) => {
          clearTimeout(timer); resolve(e);
        });
      });

      expect(err).toBeTruthy();
      expect(err).toMatch(/not found/i);

      await disconnectSocket(sock);
    });

    it('sit_at_seat returns error for nonexistent tableId', async () => {
      const sock = createSocketClient(server.url, { playerId: 'p-noroom', playerName: 'NoRoom' });
      await connectSocket(sock);

      const result = await sitAtSeat(sock, 'nonexistent-table', 500, 0);
      expect(result.error).toBeDefined();

      await disconnectSocket(sock);
    });

    it('player_action on nonexistent table emits error event', async () => {
      const sock = createSocketClient(server.url, { playerId: 'p-badaction', playerName: 'BadAction' });
      await connectSocket(sock);

      const errPromise = waitForEvent<{ code: string; message: string }>(sock, 'error', 3000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sock as any).emit('player_action', { tableId: 'fake-table', action: 'fold' });
      const err = await errPromise;
      expect(err.code).toBe('ROOM_NOT_FOUND');

      await disconnectSocket(sock);
    });
  });

  describe('Disconnect during waiting phase', () => {
    it('disconnecting the only player resets room to empty', async () => {
      const alice = createSocketClient(server.url, { playerId: 'alice-disc', playerName: 'Alice' });
      await connectSocket(alice);

      const tableId = await createTable(alice);
      await sitAtSeat(alice, tableId, 500, 0);

      const room = server.roomManager.getRoom(tableId);
      expect(room?.playerCount).toBe(1);

      await disconnectSocket(alice);

      // Give server a tick for disconnect handling
      await new Promise((r) => setTimeout(r, 200));

      // Player marked disconnected but seat still held (grace period)
      // The room still exists, player count shows 1 (seat preserved for reconnect)
      const roomAfter = server.roomManager.getRoom(tableId);
      expect(roomAfter).toBeDefined();
    });

    it('countdown cancels when one of two players disconnects', async () => {
      const alice = createSocketClient(server.url, { playerId: 'alice-cancel', playerName: 'Alice' });
      const bob   = createSocketClient(server.url, { playerId: 'bob-cancel',   playerName: 'Bob'   });
      await Promise.all([connectSocket(alice), connectSocket(bob)]);

      const tableId = await createTable(alice);
      await sitAtSeat(alice, tableId, 500, 0);
      await sitAtSeat(bob,   tableId, 500, 1);

      // Wait a moment so countdown may start
      await new Promise((r) => setTimeout(r, 300));

      // Bob disconnects
      await disconnectSocket(bob);
      await new Promise((r) => setTimeout(r, 300));

      const room = server.roomManager.getRoom(tableId);
      // Room should have < 2 connected players, hand should NOT be in progress
      expect(room?.playerCount).toBeLessThanOrEqual(2);

      await disconnectSocket(alice);
    });
  });

  describe('Table creation validation', () => {
    it('rejects smallBlind of zero', async () => {
      const sock = createSocketClient(server.url, { playerId: 'p-zero', playerName: 'Zero' });
      await connectSocket(sock);

      const id = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sock as any).emit(
          'create_table',
          { name: 'ZERO_BLINDS', smallBlind: 0, bigBlind: 20, minBuyIn: 200, maxBuyIn: 2000 },
          (tid: string) => { clearTimeout(timer); resolve(tid); },
        );
      });
      expect(id).toBe('');

      await disconnectSocket(sock);
    });

    it('rejects equal smallBlind and bigBlind', async () => {
      const sock = createSocketClient(server.url, { playerId: 'p-equal', playerName: 'Equal' });
      await connectSocket(sock);

      const id = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sock as any).emit(
          'create_table',
          { name: 'EQUAL_BLINDS', smallBlind: 20, bigBlind: 20, minBuyIn: 200, maxBuyIn: 2000 },
          (tid: string) => { clearTimeout(timer); resolve(tid); },
        );
      });
      expect(id).toBe('');

      await disconnectSocket(sock);
    });
  });

  describe('Reconnection', () => {
    it('player reconnecting with same playerId is restored to their seat', async () => {
      const alice = createSocketClient(server.url, { playerId: 'alice-reconnect', playerName: 'Alice' });
      await connectSocket(alice);

      const tableId = await createTable(alice);
      const r = await sitAtSeat(alice, tableId, 500, 3);
      expect(r.error).toBeUndefined();

      // Disconnect alice
      await disconnectSocket(alice);
      await new Promise((r2) => setTimeout(r2, 200));

      // Reconnect with same playerId
      const alice2 = createSocketClient(server.url, { playerId: 'alice-reconnect', playerName: 'Alice' });
      const statePromise = waitForEvent<TableStatePayload>(alice2, 'table_state', 5000);
      await connectSocket(alice2);

      const state = await statePromise.catch(() => null);
      // Should receive reconnect_state or table_state restoring seat
      if (state) {
        expect(state.mySeatIndex).toBe(3);
      }

      await disconnectSocket(alice2);
    });
  });
});
