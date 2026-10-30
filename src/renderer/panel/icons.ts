// Custom angular icon set (24×24, square caps, miter joins) matching Capri's shard geometry.
// Built as DOM nodes (no innerHTML) so they work under the strict CSP.
const NS = 'http://www.w3.org/2000/svg';
type Shape = ['path', string] | ['poly', string] | ['circle', number, number, number, boolean?];

const ICONS: Record<string, Shape[]> = {
  // her almond eye: the brand mark
  eye: [['path', 'M2 12 Q12 2 22 12 Q12 22 2 12 Z'], ['circle', 12, 12, 3.2, true], ['path', 'M17 16.5 L19.5 20']],
  chat: [['poly', '3,4 21,4 21,16 12,16 7,20 7,16 3,16']],
  model: [['poly', '7,3 17,3 21,7 21,17 17,21 7,21 3,17 3,7'], ['path', 'M9 9h6v6H9z'], ['path', 'M12 3v3M12 18v3M3 12h3M18 12h3']],
  voice: [['path', 'M9 3h6v10l-3 3-3-3z'], ['path', 'M5 11v2l7 7 7-7v-2'], ['path', 'M12 20v2']],
  look: [['poly', '12,2 15,9 22,9 17,14 19,22 12,17 5,22 7,14 2,9 9,9']],
  move: [['poly', '4,4 10,4 4,10'], ['poly', '20,20 14,20 20,14'], ['path', 'M7 7l10 10'], ['path', 'M15 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z']],
  behavior: [['path', 'M2 12h4l3-7 4 14 3-7h6']],
  memory: [['poly', '4,6 20,6 20,18 4,18'], ['path', 'M8 6V3M12 6V3M16 6V3M8 21v-3M12 21v-3M16 21v-3'], ['path', 'M8 10h8v4H8z']],
  shield: [['poly', '12,2 20,5 20,12 12,22 4,12 4,5']],
  lock: [['path', 'M5 11h14v10H5z'], ['path', 'M8 11V7l4-4 4 4v4']],
  pulse: [['path', 'M2 13h5l2-5 3 10 2-5h8']],
  close: [['path', 'M5 5l14 14M19 5L5 19']],
  send: [['poly', '3,4 21,12 3,20 6,12']],
  stop: [['path', 'M7 7h10v10H7z']],
  mic: [['path', 'M9 3h6v9l-3 3-3-3z'], ['path', 'M5 11l7 7 7-7'], ['path', 'M12 18v3']],
  teleport: [['path', 'M4 20h16'], ['poly', '12,3 16,10 12,8 8,10'], ['path', 'M12 8v9'], ['path', 'M6 14l-2-2M18 14l2-2M8 6L6 4M16 6l2-2']],
  check: [['path', 'M4 12l5 5L20 6']],
  warn: [['poly', '12,3 22,20 2,20'], ['path', 'M12 9v5M12 16v2']],
  plus: [['path', 'M12 4v16M4 12h16']],
  trash: [['path', 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15']],
  folder: [['poly', '3,5 10,5 12,8 21,8 21,19 3,19']],
  refresh: [['path', 'M20 8A8 8 0 1 0 21 14'], ['poly', '20,3 20,8 15,8']],
};

export function icon(name: keyof typeof ICONS | string, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const sh of ICONS[name] ?? ICONS.eye) {
    let el: SVGElement;
    if (sh[0] === 'path') { el = document.createElementNS(NS, 'path'); el.setAttribute('d', sh[1]); }
    else if (sh[0] === 'poly') { el = document.createElementNS(NS, 'polygon'); el.setAttribute('points', sh[1]); }
    else { el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', String(sh[1])); el.setAttribute('cy', String(sh[2])); el.setAttribute('r', String(sh[3])); if (sh[4]) el.setAttribute('style', 'fill:currentColor;stroke:none'); }
    svg.append(el);
  }
  return svg;
}
