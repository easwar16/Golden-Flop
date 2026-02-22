import request from 'supertest';
import { TestServer, createTestServer } from '../helpers/server';
import { createSocketClient, connectSocket, disconnectSocket, waitForEvent } from '../helpers/socket';
import type { TableInfo } from '@goldenflop/shared';

describe('Lobby / Tables REST-like behaviour', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /health is accessible (smoke test)', async () => {
    const res = await request(server.app).get('/health');
    expect(res.status).toBe(200);
  });

  it('getLobby() returns an empty array before any rooms are created', () => {
    const lobby = server.roomManager.getLobby();
    expect(lobby).toBeInstanceOf(Array);
    expect(lobby.length).toBe(0);
  });

  it('getLobby() returns one room after createRoom()', () => {
    server.roomManager.createRoom(
      {
        name: 'TEST_TABLE',
        smallBlind: 10,
        bigBlind: 20,
        minBuyIn: 200,
        maxBuyIn: 2000,
      },
      'creator-1',
    );
    const lobby = server.roomManager.getLobby();
    expect(lobby.length).toBe(1);
    expect(lobby[0].name).toBe('TEST_TABLE');
  });

  it('tables_list socket event contains correct shape', async () => {
    const sock = createSocketClient(server.url, { playerId: 'p-lobby', playerName: 'LobbyUser' });
    await connectSocket(sock);

    const tablesPromise = waitForEvent<TableInfo[]>(sock, 'tables_list');
    sock.emit('get_tables');
    const tables = await tablesPromise;

    expect(Array.isArray(tables)).toBe(true);
    if (tables.length > 0) {
      const t = tables[0];
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('smallBlind');
      expect(t).toHaveProperty('bigBlind');
      expect(t).toHaveProperty('playerCount');
      expect(t).toHaveProperty('maxPlayers');
      expect(t).toHaveProperty('phase');
    }

    await disconnectSocket(sock);
  });
});
