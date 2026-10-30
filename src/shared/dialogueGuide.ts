import source from '../../docs/DIALOGUE_GUIDE.md?raw';
const start = '<!-- runtime:start -->', end = '<!-- runtime:end -->';
const from = source.indexOf(start), to = source.indexOf(end);
if (from < 0 || to <= from) throw new Error('Dialogue guide runtime section is missing.');
export const CAPRI_DIALOGUE_GUIDE = source.slice(from + start.length, to).trim();
