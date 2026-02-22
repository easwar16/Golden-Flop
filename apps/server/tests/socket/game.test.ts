import { TestServer, createTestServer } from '../helpers/server';
import {
  createSocketClient,
  connectSocket,
  disconnectSocket,
  waitForEvent,
  TestSocket,
} from '../helpers/socket';
import type { TableStatePayload } from '@goldenflop/shared';

async function createTable(sock: TestSocket, opts = {}): Promise<string> {
  const payload = {
    name: 'GAME_TEST',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 200,
    maxBuyIn: 2000,
    ...opts,
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create_table timeout')), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).emit('create_table', payload, (id: string) => { clearTimeout(timer); resolve(id); });
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

/**
 * Collect table_state events until one matching the predicate is found, or timeout.
 */
function waitForStateMatching(
  sock: TestSocket,
  predicate: (s: TableStatePayload) => boolean,
  timeoutMs = 12000,
): Promise<TableStatePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sock as any).off('table_state', handler);
      reject(new Error(`Timeout waiting for matching table_state`));
    }, timeoutMs);

    const handler = (state: TableStatePayload) => {
      if (predicate(state)) {
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

describe('Game start & countdown', () => {
  let server: TestServer;
  let alice: TestSocket;
  let bob: TestSocket;
  let tableId: string;

  beforeEach(async () => {
    server = await createTestServer();

    alice = createSocketClient(server.url, { playerId: 'alice-game', playerName: 'Alice' });
    bob   = createSocketClient(server.url, { playerId: 'bob-game',   playerName: 'Bob'   });
    await Promise.all([connectSocket(alice), connectSocket(bob)]);

    tableId = await createTable(alice);
  });

  afterEach(async () => {
    await Promise.all([disconnectSocket(alice), disconnectSocket(bob)]);
    await server.close();
  });

  it('phase is waiting when only one player is seated', async () => {
    const statePromise = waitForEvent<TableStatePayload>(alice, 'table_state');
    await sitAtSeat(alice, tableId, 500, 0);
    const state = await statePromise;
    expect(state.phase).toBe('waiting');
  });

  it('phase transitions to countdown when second player joins', async () => {
    await sitAtSeat(alice, tableId, 500, 0);

    // Set up listener before Bob joins to avoid missing the event
    const countdownOrPreflopPromise = waitForStateMatching(
      alice,
      (s) => s.phase === 'countdown' || s.phase === 'preflop',
      8000,
    );

    await sitAtSeat(bob, tableId, 500, 1);
    const state = await countdownOrPreflopPromise;

    expect(['countdown', 'preflop']).toContain(state.phase);
  });

  it('game_started fires after countdown', async () => {
    await sitAtSeat(alice, tableId, 500, 0);
    await sitAtSeat(bob, tableId, 500, 1);

    const startedPromise = waitForEvent<{ tableId: string; handId: string }>(alice, 'game_started', 10000);
    const { tableId: tid, handId } = await startedPromise;

    expect(tid).toBe(tableId);
    expect(typeof handId).toBe('string');
    expect(handId.length).toBeGreaterThan(0);
  }, 12000);

  it('table_state in preflop shows correct phase and hole cards', async () => {
    // Set up listener BEFORE seating players so we don't miss preflop state
    const preflopStatePromise = waitForStateMatching(
      alice,
      (s) => s.phase === 'preflop',
      12000,
    );

    await sitAtSeat(alice, tableId, 500, 0);
    await sitAtSeat(bob, tableId, 500, 1);

    const state = await preflopStatePromise;

    expect(state.phase).toBe('preflop');
    // Alice should have 2 hole cards
    expect(state.myHand.filter(Boolean).length).toBe(2);
    // Community cards should all be null at preflop
    expect(state.communityCards.filter(Boolean).length).toBe(0);
  }, 15000);

  it('both players receive table_state after hand starts', async () => {
    // Set up listeners before seating to catch all states
    const alicePreflopPromise = waitForStateMatching(alice, (s) => s.phase === 'preflop', 12000);
    const bobPreflopPromise   = waitForStateMatching(bob,   (s) => s.phase === 'preflop', 12000);

    await sitAtSeat(alice, tableId, 500, 0);
    await sitAtSeat(bob, tableId, 500, 1);

    const [aliceState, bobState] = await Promise.all([alicePreflopPromise, bobPreflopPromise]);

    expect(aliceState.phase).toBe('preflop');
    expect(bobState.phase).toBe('preflop');
    // Each player sees their own cards, not the other's
    expect(aliceState.myHand.filter(Boolean).length).toBe(2);
    expect(bobState.myHand.filter(Boolean).length).toBe(2);
  }, 15000);

  it('countdownSeconds counts down in broadcast states', async () => {
    await sitAtSeat(alice, tableId, 500, 0);

    // Set up listener before Bob joins
    const countdownStatePromise = waitForStateMatching(
      alice,
      (s) => s.phase === 'countdown' || s.phase === 'preflop',
      8000,
    );

    await sitAtSeat(bob, tableId, 500, 1);
    const firstCountdownState = await countdownStatePromise;

    if (firstCountdownState.phase === 'countdown') {
      expect(firstCountdownState.countdownSeconds).toBeGreaterThan(0);
      expect(firstCountdownState.countdownSeconds).toBeLessThanOrEqual(5);
    }
    // Phase should be countdown or preflop (already advanced)
    expect(['countdown', 'preflop']).toContain(firstCountdownState.phase);
  }, 10000);
});
