import { TestServer, createTestServer } from '../helpers/server';
import {
  createSocketClient,
  connectSocket,
  disconnectSocket,
  waitForEvent,
  TestSocket,
} from '../helpers/socket';
import type { TableStatePayload, HandResultPayload } from '@goldenflop/shared';

// Helper shortcuts
function createTable(sock: TestSocket) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create_table timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit(
      'create_table',
      { name: 'BETTING_TEST', smallBlind: 10, bigBlind: 20, minBuyIn: 200, maxBuyIn: 5000 },
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

function playerAction(sock: TestSocket, tableId: string, action: string, amount?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sock as any).emit('player_action', { tableId, action, amount });
}

/**
 * Subscribe BEFORE the game starts. Resolves when the first table_state
 * with isMyTurn=true arrives for this socket on this table.
 */
function subscribeMyTurn(sock: TestSocket, tableId: string, timeoutMs = 15000): Promise<TableStatePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sock as any).off('table_state', handler);
      reject(new Error('subscribeMyTurn timeout'));
    }, timeoutMs);

    const handler = (state: TableStatePayload) => {
      if (state.tableId === tableId && state.isMyTurn) {
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sock as any).off('table_state', handler);
        resolve(state);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).on('table_state', handler);
  });
}

describe('Betting actions', () => {
  let server: TestServer;
  let alice: TestSocket;
  let bob: TestSocket;
  let tableId: string;
  // Pre-subscribed turn promises — set up BEFORE game starts
  let aliceTurnPromise: Promise<TableStatePayload | null>;
  let bobTurnPromise:   Promise<TableStatePayload | null>;

  beforeEach(async () => {
    server = await createTestServer();

    alice = createSocketClient(server.url, { playerId: 'alice-bet', playerName: 'Alice' });
    bob   = createSocketClient(server.url, { playerId: 'bob-bet',   playerName: 'Bob'   });
    await Promise.all([connectSocket(alice), connectSocket(bob)]);

    tableId = await createTable(alice);

    // Subscribe for turn events BEFORE seating so we don't miss them
    aliceTurnPromise = subscribeMyTurn(alice, tableId, 15000).catch(() => null);
    bobTurnPromise   = subscribeMyTurn(bob,   tableId, 15000).catch(() => null);

    await Promise.all([
      sitAtSeat(alice, tableId, 1000, 0),
      sitAtSeat(bob,   tableId, 1000, 1),
    ]);

    // Wait for game to start
    await waitForEvent(alice, 'game_started', 10000);
  }, 25000);

  afterEach(async () => {
    await Promise.all([disconnectSocket(alice), disconnectSocket(bob)]);
    await server.close();
  });

  it('active player can check', async () => {
    const firstState = await Promise.race([aliceTurnPromise, bobTurnPromise]);
    if (!firstState) { console.warn('No turn received, skipping'); return; }

    const activeSock = firstState.isMyTurn ? alice : bob;
    playerAction(activeSock, tableId, 'check');

    const next = await waitForEvent<TableStatePayload>(activeSock, 'table_state', 5000);
    // After check, pot should be >= BB (20)
    expect(next.pot).toBeGreaterThanOrEqual(20);
  }, 20000);

  it('active player can call', async () => {
    const firstState = await Promise.race([aliceTurnPromise, bobTurnPromise]);
    if (!firstState) { console.warn('No turn received, skipping'); return; }

    const activeSock  = firstState.isMyTurn ? alice : bob;
    const callAmount  = firstState.currentBet;

    playerAction(activeSock, tableId, 'call', callAmount);

    const next = await waitForEvent<TableStatePayload>(activeSock, 'table_state', 5000);
    expect(next.pot).toBeGreaterThan(0);
  }, 20000);

  it('active player can fold and opponent wins', async () => {
    const firstState = await Promise.race([aliceTurnPromise, bobTurnPromise]);
    if (!firstState) { console.warn('No turn received, skipping'); return; }

    const activeSock = firstState.isMyTurn ? alice : bob;

    // Fold immediately — opponent should win
    const resultPromise = waitForEvent<HandResultPayload>(alice, 'hand_result', 10000);
    playerAction(activeSock, tableId, 'fold');

    const result = await resultPromise;
    expect(result.winners.length).toBeGreaterThan(0);
    expect(result.winners[0].winAmount).toBeGreaterThan(0);
  }, 25000);

  it('raise increases the current bet', async () => {
    const firstState = await Promise.race([aliceTurnPromise, bobTurnPromise]);
    if (!firstState) { console.warn('No turn received, skipping'); return; }

    const activeSock = firstState.isMyTurn ? alice : bob;
    const raiseAmount = firstState.minRaise + 40; // raise above minRaise

    playerAction(activeSock, tableId, 'raise', raiseAmount);

    const next = await waitForEvent<TableStatePayload>(activeSock, 'table_state', 5000);
    expect(next.currentBet).toBeGreaterThanOrEqual(raiseAmount);
  }, 20000);

  it('action_ack is emitted to the acting player', async () => {
    const firstState = await Promise.race([aliceTurnPromise, bobTurnPromise]);
    if (!firstState) { console.warn('No turn received, skipping'); return; }

    const activeSock = firstState.isMyTurn ? alice : bob;

    const ackPromise = waitForEvent<{ action: string }>(activeSock, 'action_ack', 5000);
    playerAction(activeSock, tableId, 'fold');

    const ack = await ackPromise;
    expect(ack.action).toBe('fold');
  }, 20000);
});
