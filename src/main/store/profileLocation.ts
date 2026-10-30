import fs from 'node:fs';
import path from 'node:path';

/** AppData is redirected for descendants of the Microsoft Store Codex app.
 * A home-relative Documents path has the same physical meaning for Explorer,
 * Codex, startup shortcuts and app.relaunch(). Explicit test profiles stay isolated.
 */
export function profileDirectory(home: string, override?: string) {
  return override ? path.resolve(override) : path.join(home, 'Documents', 'Capri Buddy');
}

export function legacyProfiles(home: string, appData: string) {
  const paths = [path.join(appData, 'Capri Buddy')];
  const packages = path.join(home, 'AppData', 'Local', 'Packages');
  if (fs.existsSync(packages)) {
    for (const entry of fs.readdirSync(packages, {withFileTypes:true})) {
      if (entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name))
        paths.push(path.join(packages, entry.name, 'LocalCache', 'Roaming', 'Capri Buddy'));
    }
  }
  return [...new Set(paths)];
}

const dataFile = (name: string) => /\.(?:json|jsonl|bin)$/i.test(name) || name === 'Local State';

/** Adopt exactly one original profile, never combine chats or revive deleted data.
 * Finish the copy in a sibling directory before publishing it. An existing
 * profile, including an explicitly emptied one, always wins on later starts.
 */
export function initializeProfile(target: string, candidates: string[], now = Date.now()) {
  if (fs.existsSync(target) && fs.readdirSync(target).some(dataFile)) return null;
  const sources = candidates.filter(p => path.resolve(p) !== path.resolve(target) && fs.existsSync(p)).map(source => {
    const file = path.join(source, 'memory.json');
    let approved = 0;
    if (fs.existsSync(file)) {
      const memories: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (!Array.isArray(memories)) throw new Error(`Saved Capri memories need repair before migration: ${file}`);
      approved = memories.filter(m => m && m.status === 'approved' && !m.archived).length;
    }
    return {source, approved, files:fs.readdirSync(source, {withFileTypes:true}).filter(e => e.isFile() && dataFile(e.name)).map(e=>e.name)};
  }).filter(s => s.files.length).sort((a,b) => b.approved-a.approved);
  const original = sources[0];
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const stage = fs.mkdtempSync(target + '.migrating-');
  try {
    if (original) {
      for (const name of original.files) fs.copyFileSync(path.join(original.source,name), path.join(stage,name));
      const logs = path.join(original.source,'logs');
      if (fs.existsSync(logs)) fs.cpSync(logs,path.join(stage,'logs'),{recursive:true});
    }
    fs.writeFileSync(path.join(stage,'profile-source.json'), JSON.stringify({version:1,source:original?.source??null,approvedMemories:original?.approved??0,migratedAt:now},null,2));
    // A pre-created cache-only directory is not a saved profile. Keep its caches.
    if (fs.existsSync(target)) {
      for (const name of fs.readdirSync(stage)) fs.renameSync(path.join(stage,name),path.join(target,name));
      fs.rmdirSync(stage);
    } else fs.renameSync(stage,target);
    return original?.source??null;
  } catch (error) {
    // Keep a failed staging copy for recovery; never modify the source profile.
    throw new Error(`Could not safely initialize Capri's shared profile. Original data is unchanged. ${stage}`, {cause:error});
  }
}
