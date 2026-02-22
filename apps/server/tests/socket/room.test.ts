import { TestServer, createTestServer } from '../helpers/server';
import {
  createSocketClient,
  connectSocket,
  disconnectSocket,
  waitForEvent,
  TestSocket,
} from '../helpers/socket';
import type { TableInfo, TableStatePayload } from '@goldenflop/shared';

// Helper: create a table via socket
async function createTable(
  sock: TestSocket,
  overrides: Partial<{
    name: string;
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
  }> = {},
): Promise<string> {
  const payload = {
    name: overrides.name ?? 'TEST_TABLE',
    smallBlind: overrides.smallBlind ?? 10,
    bigBlind: overrides.bigBlind ?? 20,
    minBuyIn: overrides.minBuyIn ?? 200,
    maxBuyIn: overrides.maxBuyIn ?? 2000,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create_table ack timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit('create_table', payload, (tableId: string) => {
      clearTimeout(timer);
      resolve(tableId);
    });
  });
}

// Helper: join via sit_at_seat
function sitAtSeat(
  sock: TestSocket,
  tableId: string,
  buyIn: number,
  seatIndex?: number,
): Promise<{ seatIndex?: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sit_at_seat ack timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit(
      'sit_at_seat',
      { tableId, buyIn, seatIndex },
      (result: { seatIndex?: number; error?: string }) => {
        clearTimeout(timer);
        resolve(result);
      },
    );
  });
}

describe('Room – join / leave / seat management', () => {
  let server: TestServer;

  beforeEach(async () => {
    // Fresh server per test to isolate state
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('create_table returns a valid tableId', async () => {
    const sock = createSocketClient(server.url, { playerId: 'creator-1', playerName: 'Alice' });
    await connectSocket(sock);

    const tableId = await createTable(sock);
    expect(typeof tableId).toBe('string');
    expect(tableId.length).toBeGreaterThan(0);

    await disconnectSocket(sock);
  });

  it('create_table rejects empty name', async () => {
    const sock = createSocketClient(server.url, { playerId: 'c-bad', playerName: 'Bad' });
    await connectSocket(sock);

    const tableId = await createTable(sock, { name: '' });
    expect(tableId).toBe('');

    await disconnectSocket(sock);
  });

  it('create_table rejects invalid blind structure (bigBlind <= smallBlind)', async () => {
    const sock = createSocketClient(server.url, { playerId: 'c-blinds', playerName: 'Blinds' });
    await connectSocket(sock);

    const tableId = await createTable(sock, { smallBlind: 20, bigBlind: 10 });
    expect(tableId).toBe('');

    await disconnectSocket(sock);
  });

  it('sit_at_seat places player in chosen seat and returns seatIndex', async () => {
    const creator = createSocketClient(server.url, { playerId: 'c-seat', playerName: 'Creator' });
    await connectSocket(creator);

    const tableId = await createTable(creator);
    const result = await sitAtSeat(creator, tableId, 500, 2);

    expect(result.error).toBeUndefined();
    expect(result.seatIndex).toBe(2);

    await disconnectSocket(creator);
  });

  it('sit_at_seat rejects buyIn below minBuyIn', async () => {
    const sock = createSocketClient(server.url, { playerId: 'c-low', playerName: 'Low' });
    await connectSocket(sock);

    const tableId = await createTable(sock, { minBuyIn: 200 });
    const result = await sitAtSeat(sock, tableId, 50);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/minimum/i);

    await disconnectSocket(sock);
  });

  it('sit_at_seat rejects buyIn above maxBuyIn', async () => {
    const sock = createSocketClient(server.url, { playerId: 'c-high', playerName: 'High' });
    await connectSocket(sock);

    const tableId = await createTable(sock, { maxBuyIn: 2000 });
    const result = await sitAtSeat(sock, tableId, 9999);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/maximum/i);

    await disconnectSocket(sock);
  });

  it('two players can join different seats', async () => {
    const alice = createSocketClient(server.url, { playerId: 'alice', playerName: 'Alice' });
    const bob = createSocketClient(server.url, { playerId: 'bob', playerName: 'Bob' });
    await Promise.all([connectSocket(alice), connectSocket(bob)]);

    const tableId = await createTable(alice);

    const r1 = await sitAtSeat(alice, tableId, 500, 0);
    const r2 = await sitAtSeat(bob, tableId, 500, 1);

    expect(r1.error).toBeUndefined();
    expect(r2.error).toBeUndefined();
    expect(r1.seatIndex).toBe(0);
    expect(r2.seatIndex).toBe(1);

    const room = server.roomManager.getRoom(tableId);
    expect(room?.playerCount).toBe(2);

    await Promise.all([disconnectSocket(alice), disconnectSocket(bob)]);
  });

  it('player receives table_state after joining', async () => {
    const alice = createSocketClient(server.url, { playerId: 'alice-state', playerName: 'Alice' });
    await connectSocket(alice);

    const tableId = await createTable(alice);

    const statePromise = waitForEvent<TableStatePayload>(alice, 'table_state');
    await sitAtSeat(alice, tableId, 500, 0);
    const state = await statePromise;

    expect(state.tableId).toBe(tableId);
    expect(state.mySeatIndex).toBe(0);
    expect(state.myChips).toBe(500);

    await disconnectSocket(alice);
  });

  it('leave_table removes player from room', async () => {
    const alice = createSocketClient(server.url, { playerId: 'alice-leave', playerName: 'Alice' });
    await connectSocket(alice);

    const tableId = await createTable(alice);
    await sitAtSeat(alice, tableId, 500, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (alice as any).emit('leave_table', { tableId });

    // Give server a tick to process
    await new Promise((r) => setTimeout(r, 100));

    const room = server.roomManager.getRoom(tableId);
    expect(room?.playerCount).toBe(0);

    await disconnectSocket(alice);
  });

  it('tables_list updates when a room is created', async () => {
    const alice = createSocketClient(server.url, { playerId: 'alice-lobby', playerName: 'Alice' });
    await connectSocket(alice);

    // Listen for tables_list update
    const updatePromise = waitForEvent<TableInfo[]>(alice, 'tables_list');
    await createTable(alice, { name: 'LOBBY_UPDATE_TABLE' });
    const tables = await updatePromise;

    expect(tables.some((t) => t.name === 'LOBBY_UPDATE_TABLE')).toBe(true);

    await disconnectSocket(alice);
  });
});
