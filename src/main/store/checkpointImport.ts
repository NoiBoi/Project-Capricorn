import fs from 'node:fs';

/** Migration reads never repair, rename or overwrite the source file. */
export function readLegacyCheckpoint(file: string): unknown {
  let raw: string;
  try { raw=fs.readFileSync(file,'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try { return JSON.parse(raw.replace(/^\uFEFF/,'')); }
  catch { throw new Error(`Cannot import malformed checkpoint: ${file}. Existing data was preserved.`); }
}
