/** Explicit, reviewable scope. Never grants computer control or connects an account. */
export const CAPABILITY_BOOST = {
  'dialogue.localContext': true,
  'dialogue.spotifyBanter': true,
  'dialogue.contextPings': true,
  'character.personality': true,
  'character.speechBubbles': true,
  'behavior.smallActivities': true,
  'behavior.cursorVisits': true,
  'behavior.newWindowVisits': true,
  'behavior.explore': true,
  'behavior.idleRemarks': true,
  'behavior.proactiveVoice': true,
  'teleport.auto': true,
  'voice.interactionLines': true,
  'voice.micPermission': true,
  'memory.enabled': true,
  'memory.autoLearn': true,
  'memory.interactionProfile': true,
  'privacy.saveHistory': true,
  'actions.policies.read_screen': 'allow',
} as const;

export function valueAt(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], object);
}
export function putAt(object: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.'); let parent = object;
  for (const key of keys.slice(0, -1)) parent = (parent[key] ??= {}) as Record<string, unknown>;
  parent[keys.at(-1)!] = value;
}
