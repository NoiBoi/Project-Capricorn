import fs from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

function popup(approved: boolean) {
  const elements = new Map<string, any>();
  const state: Record<string, unknown> = { sites: [], semanticSites: [] };
  const chrome = {
    runtime: { id: 'a'.repeat(32), sendMessage: vi.fn(async () => ({})) },
    tabs: { query: async () => [{ id: 42, incognito: false, url: 'https://homework.example.org/problem' }] },
    permissions: { request: vi.fn(async () => approved) },
    storage: { local: { get: async () => structuredClone(state), set: async (value: unknown) => { Object.assign(state, value); } } },
    scripting: { unregisterContentScripts: vi.fn(async () => {}), registerContentScripts: vi.fn(async () => {}), executeScript: vi.fn(async () => {}) },
  };
  vm.runInNewContext(fs.readFileSync('extensions/chrome/popup.js','utf8'), { chrome, URL, document: { getElementById(id: string) { if (!elements.has(id)) elements.set(id, { value: '', textContent: '' }); return elements.get(id); } } });
  return { chrome, state, elements };
}
it('requests all HTTP/HTTPS grants in one user action and enables passive reading without per-site setup', async () => {
  const { chrome, state, elements } = popup(true);
  await elements.get('allowAll').onclick();
  expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://*/*','https://*/*'] });
  expect(state).toMatchObject({ sites: ['*'], semanticSites: ['*'] });
  expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: ['http://*/*','https://*/*'], js: ['observe.js'] })]);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'inspect', mode: 'semantic' });
});
it('does not enable wildcard collection when the user denies the Chrome grant', async () => {
  const { chrome, state, elements } = popup(false);
  await elements.get('allowAll').onclick();
  expect(state).toMatchObject({ sites: [], semanticSites: [] });
  expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
  expect(elements.get('status').textContent).toContain('not granted');
});
it('saves pairing and verifies it without requiring a page capture', async () => {
  const { chrome, state, elements } = popup(true);
  chrome.runtime.sendMessage.mockImplementation(async () => ({ status: 'Pairing verified.' }));
  elements.set('token',{value:'a'.repeat(64)});
  await elements.get('pair').onclick();
  expect(state.token).toBe('a'.repeat(64)); expect(elements.get('token').value).toBe('');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'checkPairing' });
  expect(elements.get('status').textContent).toBe('Pairing verified.');
});
