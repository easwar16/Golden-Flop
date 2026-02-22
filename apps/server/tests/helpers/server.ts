import { AddressInfo } from 'net';
import { createApp, AppInstance } from '../../src/app';

export interface TestServer extends AppInstance {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function createTestServer(): Promise<TestServer> {
  const instance = await createApp({
    skipBootstrap: true,
    skipRedis: true,
  });

  await new Promise<void>((resolve) => {
    instance.httpServer.listen(0, resolve);
  });

  const { port } = instance.httpServer.address() as AddressInfo;
  const url = `http://localhost:${port}`;

  return {
    ...instance,
    port,
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        instance.io.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
