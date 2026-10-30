import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';

const dirs: string[] = [];
export function tmpDir(prefix = 'capri-test-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;
/** Local HTTP server for provider tests (no network). */
export async function mockServer(handler: Handler) {
  const requests: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { requests.push({ url: req.url!, headers: req.headers, body }); handler(req, res, body); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export const fakeCipher = (available = true) => ({
  available: () => available,
  encrypt: (s: string) => Buffer.from(`ENC:${Buffer.from(s).toString('base64')}`),
  decrypt: (b: Buffer) => { const s = b.toString(); if (!s.startsWith('ENC:')) throw new Error('bad'); return Buffer.from(s.slice(4), 'base64').toString(); },
});
