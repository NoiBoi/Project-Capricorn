import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { LifeContext } from '../../src/main/life/context';
import { ChromeBridge } from '../../src/main/life/chrome';
import { disconnectedChrome } from '../../src/shared/lifeContext';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-read-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const life = new LifeContext(dir);
  cleanup.push(() => life.flush());
  life.configure({ ...disconnectedChrome(), sites: ['*'], permissions: {
    collect: true, live: true, proactive: true, content: true, retain: true, learn: false,
  } });
  const reservation = http.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const bridge = new ChromeBridge(life, () => ({ token: 'b'.repeat(64), extensionId: 'a'.repeat(32) }), port);
  cleanup.push(() => bridge.stop());
  bridge.setRawSink(async () => true);
  await bridge.start();
  const headers = { origin: 'chrome-extension://' + 'a'.repeat(32), authorization: 'Bearer ' + 'b'.repeat(64) };
  const command = () => fetch(`http://127.0.0.1:${port}/v1/read-request`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  const page = (id: string, url = 'http://127.0.0.1:8765/fixture') => fetch(`http://127.0.0.1:${port}/v1/page`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({
      readRequestId: id, recordId: 'fixture', revision: Date.now(), occurredAt: Date.now(), url,
      title: 'Calibration', headings: [], mode: 'semantic', sections: [{ kind: 'paragraph', level: 0, path: '', text: 'Setpoint 350 kPa' }],
      incognito: false, focused: true, visible: true,
    }),
  });
  return { bridge, life, command, page, port, headers };
}

it('requests fresh text through authenticated extension delivery and correlates the accepted reply', async () => {
  const { bridge, command, page } = await fixture();
  const reading = bridge.requestPage(AbortSignal.timeout(3000));
  expect(await bridge.requestPage(AbortSignal.timeout(1000))).toEqual({ status: 'busy' });
  const response = await command();
  expect(response.status).toBe(200);
  const request = await response.json();
  expect(request).toMatchObject({ mode: 'semantic', id: expect.any(String) });
  expect(bridge.isRequestedRead(request.id)).toBe(true);
  expect(bridge.isRequestedRead('unrelated')).toBe(false);
  expect((await page(request.id)).status).toBe(202);
  expect(await reading).toEqual({ status: 'accepted' });
  expect(bridge.preflight().deliveringRecently).toBe(true);
});

it('rejects unauthorized readers, cancels pending requests, and rejects a revoked source reply', async () => {
  const { bridge, life, command, page, port, headers } = await fixture();
  expect((await fetch(`http://127.0.0.1:${port}/v1/read-request`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', authorization: 'Bearer bad' }, body: '{}',
  })).status).toBe(401);
  const controller = new AbortController();
  const cancelled = bridge.requestPage(controller.signal);
  controller.abort();
  expect(await cancelled).toEqual({ status: 'cancelled' });
  const reading = bridge.requestPage(AbortSignal.timeout(3000));
  const request = await (await command()).json();
  life.configure({ ...life.source('chrome')!, paused: true });
  expect((await page(request.id)).status).toBe(204);
  expect(await reading).toEqual({ status: 'disallowed-or-paused' });
  expect(await bridge.requestPage(AbortSignal.timeout(1000))).toEqual({ status: 'unavailable-or-disallowed' });
});

it('rejects sensitive pages even with wildcard website access', async () => {
  const { bridge, command, page } = await fixture();
  const reading = bridge.requestPage(AbortSignal.timeout(3000));
  const request = await (await command()).json();
  expect((await page(request.id, 'https://example.org/login')).status).toBe(204);
  expect(await reading).toEqual({ status: 'disallowed-or-paused' });
});

it('accepts a fresh passive delivery while a requested read is waiting for Chrome focus', async () => {
  const { bridge, page } = await fixture();
  const reading = bridge.requestPage(AbortSignal.timeout(3000));
  expect((await page('00000000-0000-4000-8000-000000000000')).status).toBe(202);
  expect(await reading).toEqual({ status: 'accepted' });
});
