import { TestServer, createTestServer } from '../helpers/server';
import { createSocketClient, connectSocket, disconnectSocket, waitForEvent } from '../helpers/socket';

describe('Socket connection & authentication', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('connects successfully with valid playerId and playerName', async () => {
    const sock = createSocketClient(server.url, {
      playerId: 'player-connect-1',
      playerName: 'Alice',
    });
    await expect(connectSocket(sock)).resolves.toBeUndefined();
    expect(sock.connected).toBe(true);
    await disconnectSocket(sock);
  });

  it('disconnects sockets missing playerId', async () => {
    const { io: ioc } = await import('socket.io-client');
    const sock = ioc(server.url, {
      transports: ['websocket'],
      auth: { playerName: 'NoId' },
      autoConnect: false,
    });

    const disconnectPromise = new Promise<void>((resolve) => {
      sock.once('disconnect', () => resolve());
    });
    sock.connect();
    // Server will disconnect the socket
    await expect(disconnectPromise).resolves.toBeUndefined();
    sock.disconnect();
  });

  it('disconnects sockets missing playerName', async () => {
    const { io: ioc } = await import('socket.io-client');
    const sock = ioc(server.url, {
      transports: ['websocket'],
      auth: { playerId: 'some-id' },
      autoConnect: false,
    });

    const disconnectPromise = new Promise<void>((resolve) => {
      sock.once('disconnect', () => resolve());
    });
    sock.connect();
    await expect(disconnectPromise).resolves.toBeUndefined();
    sock.disconnect();
  });

  it('multiple sockets can connect simultaneously', async () => {
    const sockets = Array.from({ length: 4 }, (_, i) =>
      createSocketClient(server.url, { playerId: `p-multi-${i}`, playerName: `Player${i}` }),
    );

    await Promise.all(sockets.map(connectSocket));
    expect(sockets.every((s) => s.connected)).toBe(true);

    await Promise.all(sockets.map(disconnectSocket));
  });

  it('receives tables_list on request_tables (legacy)', async () => {
    const sock = createSocketClient(server.url, { playerId: 'p-legacy', playerName: 'Legacy' });
    await connectSocket(sock);

    const tablesPromise = waitForEvent(sock, 'tables_list');
    sock.emit('request_tables');
    await expect(tablesPromise).resolves.toBeInstanceOf(Array);

    await disconnectSocket(sock);
  });

  it('receives tables_list on get_tables', async () => {
    const sock = createSocketClient(server.url, { playerId: 'p-get', playerName: 'GetUser' });
    await connectSocket(sock);

    const tablesPromise = waitForEvent(sock, 'tables_list');
    sock.emit('get_tables');
    await expect(tablesPromise).resolves.toBeInstanceOf(Array);

    await disconnectSocket(sock);
  });
});
