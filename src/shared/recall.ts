/** Local hybrid ranking: lexical evidence + small concept vocabulary + explicit app identity.
 * Concept hints aid retrieval only. They never become remembered facts or an embedding claim. */
const STOP = new Set('the and for you your was were are this that with from have had what when where about again earlier remember recall said told thing one which some there those would could should please just still really'.split(' '));
const GROUPS = [
  ['color', 'colour', 'hue', 'palette', 'swatch', 'pigment', 'tint'],
  ['music', 'song', 'track', 'tune', 'melody', 'soundtrack', 'rhythm', 'beat'],
  ['graph', 'node', 'wire', 'wiring', 'noodle', 'spaghetti', 'connection', 'patch'],
  ['blender', 'mesh', 'render', 'viewport', 'modelling', 'modeling', 'geometry'],
  ['code', 'coding', 'program', 'programming', 'compiler', 'debug', 'debugging'],
  ['ceramic', 'pottery', 'clay', 'glaze', 'kiln'],
  ['exam', 'midterm', 'test', 'study', 'studying', 'finals'],
  ['job', 'internship', 'intern', 'resume', 'recruiter', 'interview'],
  ['pat', 'pet', 'headpat', 'affection', 'petting'],
];
const stem = (w: string) => w.length <= 4 ? w : /(?:ch|sh|ss|x|z)es$/.test(w) ? w.replace(/es$/, '') : w.replace(/(?:ing|ed)$/, '').replace(/s$/, '');
export function recallTerms(text: string) {
  return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w)).map(stem));
}
const concepts = (text: string) => {
  const words = recallTerms(text);
  return new Set(GROUPS.flatMap((group, i) => group.some(w => words.has(stem(w))) ? [i] : []));
};
export function localRelevance(query: string, text: string, hints: string[] = []) {
  const q = recallTerms(query), t = recallTerms(text), c = concepts(query), d = concepts(text + ' ' + hints.join(' '));
  const exact = [...q].filter(w => t.has(w)).length;
  const concept = [...c].filter(w => d.has(w)).length;
  const hinted = [...q].filter(w => recallTerms(hints.join(' ')).has(w)).length;
  return { score: exact * 3 + concept * 1.5 + Math.min(2, hinted), exact, concept };
}
export const applicationKey = (process: string) => process.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
