export interface SearchItem { page: string; label: string; detail: string; terms?: string; section?: string; control?: string; value?: string }

/** Shared ranking keeps both search boxes predictable; all query words must match. */
export function suggestions(items: SearchItem[], query: string): SearchItem[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, 6);
  return items.map((item, order) => {
    const label = item.label.toLowerCase(), haystack = `${label} ${item.detail} ${item.terms ?? ''}`.toLowerCase();
    return { item, order, score: words.every(word => haystack.includes(word)) ? words.reduce((score, word) => score + (label.startsWith(word) ? 5 : label.includes(word) ? 3 : 1), 0) : 0 };
  }).filter(hit => hit.score).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 8).map(hit => hit.item);
}

export function searchBox(items: SearchItem[], label: string, choose: (item: SearchItem) => void): HTMLElement {
  const host = document.createElement('div'); host.className = 'search-host';
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = label;
  input.setAttribute('aria-label', label); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div'); list.className = 'search-suggestions'; list.id = 'search-suggestions'; list.setAttribute('role', 'listbox'); list.hidden = true; input.setAttribute('aria-controls', list.id);
  let active = -1, matches: SearchItem[] = [];
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const select = (item: SearchItem) => { close(); input.value = ''; choose(item); };
  const mark = () => { [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === active))); if (active >= 0) input.setAttribute('aria-activedescendant', `suggestion-${active}`); };
  const render = () => {
    matches = suggestions(items, input.value); active = -1; list.replaceChildren();
    matches.forEach((item, i) => {
      const option = document.createElement('div'); option.id = `suggestion-${i}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      const title = document.createElement('strong'); title.textContent = item.label;
      const detail = document.createElement('small'); detail.textContent = item.detail; option.append(title, detail);
      option.addEventListener('mousedown', e => e.preventDefault()); option.addEventListener('click', () => select(item)); list.append(option);
    });
    if (!matches.length) { const empty = document.createElement('p'); empty.textContent = 'No matches. Try “voice”, “quiet”, “window” or “memory”.'; list.append(empty); }
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('input', render); input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) render(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length); mark(); }
    if (e.key === 'Enter' && !list.hidden && matches.length) { e.preventDefault(); select(matches[Math.max(0, active)]); }
  });
  host.append(input, list); return host;
}
