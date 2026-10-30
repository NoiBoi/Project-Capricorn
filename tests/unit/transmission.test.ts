import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PORTRAITS, transmissionFace, transmissionStatus } from '../../src/shared/transmission';

describe('transmission presentation', () => {
  it('keeps real failures distinct from loading and completed replies', () => {
    expect(transmissionStatus('error', true, 40).kind).toBe('error');
    expect(transmissionStatus('thinking', false, 14).label).toBe('Thinking');
    expect(transmissionStatus('thinking', true, 15).label).toBe('Still working');
    expect(transmissionStatus('idle', true, 99).label).toBe('Reply');
    expect(transmissionFace('error', 'Beautiful?')).toBe('wide');
    expect(transmissionFace('thinking', 'Preem')).toBe('aside');
    expect(transmissionFace('idle', 'Preem.')).toBe('smug');
    expect(transmissionFace('idle', 'Ready?')).toBe('look');
  });
  it('ships each referenced portrait with separate artwork provenance', () => {
    const root = path.resolve(__dirname, '../../assets/capri/mochiiwuff');
    for (const asset of Object.values(PORTRAITS)) {
      const bytes = fs.readFileSync(path.join(root, asset));
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(20);
    }
    expect(fs.readFileSync(path.join(root, 'SOURCES.md'), 'utf8')).toContain('16985d14');
  });
});
