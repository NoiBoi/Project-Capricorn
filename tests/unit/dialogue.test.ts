import { describe, expect, it } from 'vitest';
import { DialogueDirector, WaitingDialogue, cleanGeneratedDialogue, recitesWindowTitle, similarDialogue } from '../../src/shared/dialogue';
import { ActivityContext, appKind, dialogueSurface } from '../../src/shared/dialogueContext';
import { WeatherContext } from '../../src/main/dialogueContext';

const random = () => { let s = 48271; return () => ((s = s * 16807 % 2147483647) - 1) / 2147483646; };
describe('procedural character dialogue', () => {
  it('paces delivered spontaneous speech independently of observations and keeps near-duplicate lines out', () => {
    let now=1000000; const d=new DialogueDirector(()=>.5,()=>now);
    expect(d.proactiveWaitSeconds()).toBe(0);
    for(let i=0;i<4;i++) { d.remember('Distinct spoken aside '+i,{event:'notice'}); expect(d.proactiveWaitSeconds()).toBeGreaterThan(0); now+=35000; }
    expect(d.proactiveWaitSeconds()).toBe(160);
    expect(d.acceptGenerated('Distinct spoken aside 3',{event:'notice'},'plain')).toBe('');
    now=1300000; expect(d.proactiveWaitSeconds()).toBe(0);
  });
  it('has long mixed-event variety without repeated setups or title receipts', () => {
    let now = 1000000;
    const d = new DialogueDirector(random(), () => now), lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      now += 90000;
      const line = d.choose({ event: (['roam', 'perch', 'pickup', 'pat', 'poke'] as const)[i % 5] }, { required: true });
      expect(line.length).toBeGreaterThan(0);
      expect(lines.slice(-6).some(previous => similarDialogue(line, previous))).toBe(false);
      expect(line).not.toMatch(/magnificent|choom|neon|better angle|new view|front.row/i);
      lines.push(line);
    }
    expect(new Set(lines).size).toBe(40);
  });
  it('can remain quiet and enforces a global gap between optional reactions', () => {
    let now = 1000000; const d = new DialogueDirector(() => .5, () => now);
    expect(d.choose({ event: 'roam' })).not.toBe('');
    now += 1000; expect(d.choose({ event: 'perch' })).toBe('');
    expect(d.choose({ event: 'pat' }, { required: true })).not.toBe('');
    expect(new DialogueDirector(() => 0).choose({ event: 'notice' })).toBe('');
  });
  it('remembers wording across restarts, bounds storage, and ignores corrupt/future history', () => {
    let now = 1000000; const first = new DialogueDirector(() => .5, () => now);
    const line = first.choose({ event: 'pickup' }, { required: true });
    const second = new DialogueDirector(() => .5, () => now); second.restore(first.snapshot());
    expect(second.choose({ event: 'pickup' }, { required: true })).not.toBe(line);
    second.restore({ version: 1, history: [null, { text: 'fake', at: now + 1 }] });
    expect(second.snapshot().history).toHaveLength(0);
    for (let i = 0; i < 200; i++) { now++; second.remember(`line ${i}`, { event: 'pat' }); }
    expect(second.snapshot().history).toHaveLength(128);
  });
  it('does not forget delivered wording overnight but expires it after a month', () => {
    let now = 1000000; const d = new DialogueDirector(() => .5, () => now);
    d.remember('A very particular joke.', { event: 'pat' });
    const saved = d.snapshot(); now += 3 * 86400000;
    const restored = new DialogueDirector(() => .5, () => now); restored.restore(saved);
    expect(restored.acceptGenerated('A very particular joke.', { event: 'pat' }, 'delight')).toBe('');
    now += 31 * 86400000;
    expect(restored.acceptGenerated('A very particular joke.', { event: 'pat' }, 'delight')).not.toBe('');
  });
  it('only allows the inverted joke when actually inverted and objections when repeatedly handled', () => {
    for (const event of ['perch', 'pickup'] as const) {
      const d = new DialogueDirector(random());
      const lines = Array.from({ length: 20 }, () => d.choose({ event }, { required: true })).join(' ');
      expect(lines).not.toMatch(/upside down|counts\. I checked|Again\? Pick|Make up your mind/);
    }
  });
  it('uses clock, power and observed activity occasionally, with a long topic cooldown', () => {
    let now = 1000000; const rng = random(); const d = new DialogueDirector(rng, () => now);
    const local = { hour: 2, weekday: 'Tuesday', weekend: false, battery: { percent: 12, charging: false }, activity: { kind: 'notes' as const, minutes: 23, switches: 1, returning: false } };
    for (let i = 0; i < 35; i++) { now += 90000; d.choose({ event: 'roam', local }, { required: true }); }
    const contextual = d.snapshot().history.filter(h => h.beat.startsWith('context.'));
    expect(contextual.length).toBeGreaterThan(0); expect(contextual.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < contextual.length; i++) expect(contextual[i].at - contextual[i - 1].at).toBeGreaterThanOrEqual(12 * 60000);
    expect(contextual.map(h => h.text).join(' ')).not.toMatch(/finished|productive|completed|playing/);
  });
  it('never uses unknown power, false music playback, or stale weather as facts', () => {
    const d = new DialogueDirector(random(), () => 10000000);
    for (let i = 0; i < 30; i++) d.choose({ event: 'greeting', local: { hour: 14, weekday: 'Tuesday', weekend: false,
      openKinds: ['music'], weather: { condition: 'rain', celsius: 10, observedAt: 0 } } }, { required: true });
    const lines = d.snapshot().history.map(h => h.text).join(' ');
    expect(lines).not.toMatch(/battery|rain|playing music|listening to/);
  });
  it('rejects title recitals, action markup, filler and near duplicate model output without retries', () => {
    expect(recitesWindowTitle('A seat for Homework notes.', ['Homework notes'])).toBe(true);
    expect(recitesWindowTitle('I see SolidWorks.', ['SolidWorks'])).toBe(true);
    expect(recitesWindowTitle('Ooh, that shape looks awkward.', ['Homework notes - Google Chrome'])).toBe(false);
    expect(recitesWindowTitle('Ooh, let me poke around. Just looking.', ['Homework notes', ''])).toBe(false);
    expect(cleanGeneratedDialogue('This one keeps pulling you back.')).toBe('');
    for (const raw of ['<quiet/>', '<action>{}</action>Hi', '*laughs* Hi', 'Capri: Hello', 'My magnificent new vantage point.', 'word '.repeat(60)]) expect(cleanGeneratedDialogue(raw)).toBe('');
    const d = new DialogueDirector();
    d.remember('Wait. Let me get closer.', { event: 'roam' });
    expect(d.acceptGenerated('Wait, let me get closer!', { event: 'notice' }, 'curiosity')).toBe('');
    expect(d.acceptGenerated('Ooh, that little joint bends backwards.', { event: 'notice' }, 'curiosity')).not.toBe('');
  });
  it('keeps loading wording stable within a phase and separate from actual replies', () => {
    let calls = 0; const wait = new WaitingDialogue(() => { calls++; return .5; });
    const early = wait.text('thinking', 10, 2);
    expect(wait.text('thinking', 10, 8)).toBe(early); expect(calls).toBe(2);
    expect(wait.text('thinking', 10, 16)).not.toBe(early);
    expect(wait.text('thinking', 10, 40)).toBe(wait.text('thinking', 10, 16));
    expect(wait.text('idle', 10, 40)).toBe('');
  });
});
describe('lightweight observed context', () => {
  it('tracks active time and real returns, forgetting idle gaps instead of claiming work', () => {
    const a = new ActivityContext(), notes = { title: 'PRIVATE FILE TITLE', process: 'notepad.exe' };
    for (let t = 1000; t <= 121000; t += 1000) a.observe(notes, t);
    expect(a.snapshot(121000)).toMatchObject({ kind: 'notes', minutes: 2 });
    expect(JSON.stringify(a.snapshot(121000))).not.toContain('PRIVATE');
    a.observe(null, 122000); expect(a.snapshot(122000)).toBeUndefined();
    a.observe(notes, 180000); a.observe(notes, 184000); expect(a.snapshot(184000)).toMatchObject({ minutes: 0, returning: true });
    expect(a.snapshot(200000)).toBeUndefined();
    expect(appKind({ title: 'Spotify', process: 'spotify.exe' })).toBe('music');
  });
  it('recognizes website identity without treating mentions in another video as that app', () => {
    expect(dialogueSurface({ title: 'Discord tutorial - YouTube - Google Chrome', process: 'chrome.exe' })).toBe('youtube');
    expect(dialogueSurface({ title: 'A private channel | Discord', process: 'chrome.exe' })).toBe('discord');
    expect(dialogueSurface({ title: 'ChatGPT', process: 'chrome.exe' })).toBe('chatgpt');
    expect(dialogueSurface({ title: 'Some artist', process: 'Spotify.exe' })).toBe('spotify');
    expect(dialogueSurface({ title: 'Article about Spotify', process: 'chrome.exe' })).toBe('browser');
  });
  it('offers varied platform-specific exploration with no invented private messages or playback', () => {
    for (const surface of ['youtube', 'discord', 'chatgpt', 'spotify', 'browser'] as const) {
      const d = new DialogueDirector(random());
      const lines = Array.from({ length: 18 }, (_, i) => d.choose({ event: i % 2 ? 'perch' : 'roam', surface }, { required: true })).filter(Boolean);
      expect(new Set(lines).size).toBe(lines.length); expect(lines.length).toBeGreaterThan(12);
      expect(d.snapshot().history.some(h => h.beat.startsWith(`surface.${surface}`))).toBe(true);
      expect(lines.join(' ')).not.toMatch(/you're (?:watching|listening|playing)|you sent|your friend says|keeps pulling you back/i);
    }
  });
  it('does zero network work without a configured city and deduplicates/caches enabled weather', async () => {
    let calls = 0, now = 10000000;
    const fetcher = (async (url: string) => { calls++; return { ok: true, json: async () => url.includes('geocoding') ? { results: [{ latitude: 40, longitude: -86 }] } : { current: { temperature_2m: 8, weather_code: 61, time: now / 1000 } } }; }) as typeof fetch;
    const w = new WeatherContext(fetcher, () => now);
    await w.refresh(''); expect(calls).toBe(0);
    await Promise.all([w.refresh('Test City, IN'), w.refresh('Test City, IN')]); expect(calls).toBe(2);
    expect(w.snapshot('Test City, IN')?.condition).toBe('rain');
    await w.refresh('Test City, IN'); expect(calls).toBe(2);
    expect(w.snapshot('')).toBeUndefined();
    now += 1800001; await w.refresh('Test City, IN'); expect(calls).toBe(3);
    now += 3600001; expect(w.snapshot('Test City, IN')).toBeUndefined();
  });
  it('skips ambiguous city names and backs off after errors', async () => {
    let calls = 0;
    const w = new WeatherContext((async () => { calls++; throw Error('offline'); }) as typeof fetch);
    await w.refresh('City'); await w.refresh('City'); expect(calls).toBe(1);
    const ambiguous = new WeatherContext((async () => new Response(JSON.stringify({ results: [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }] }))) as typeof fetch);
    await ambiguous.refresh('Springfield'); expect(ambiguous.snapshot('Springfield')).toBeUndefined();
  });
});

