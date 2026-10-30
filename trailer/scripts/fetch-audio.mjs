// Downloads the trailer's music and sound effects from Pixabay (their licence doesn't allow re-hosting
// the files as-is, so they aren't in the repo). Sources are the links in ASSETS.md.
//   node scripts/fetch-audio.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const md = fs.readFileSync(path.join(root, 'ASSETS.md'), 'utf8');
const jobs = [];
const score = /## Music[^\n]*\n[\s\S]*?\((https:\/\/cdn\.pixabay\.com[^)]+)\)/.exec(md);
if (score) jobs.push(['audio/score.mp3', score[1]]);
for (const m of md.matchAll(/^\| (\w+) \| \[[^\]]*\]\((https:\/\/cdn\.pixabay\.com[^)]+)\) \|/gm)) jobs.push([`audio/sfx/${m[1]}.mp3`, m[2]]);
for (const [rel, url] of jobs) {
  const out = path.join(root, 'public', rel);
  if (fs.existsSync(out)) { console.log('have', rel); continue; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) { console.log('FAILED', rel, res.status); continue; }
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('got', rel);
}
