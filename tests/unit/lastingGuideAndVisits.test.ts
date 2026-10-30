import { describe,expect,it } from 'vitest';
import { CAPRI_DIALOGUE_GUIDE } from '../../src/shared/dialogueGuide';
import { CAPRI_DIALOGUE_REGISTER } from '../../src/shared/capriVoice';
import { buildSystemPrompt } from '../../src/main/ai/persona';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { DesktopVisits,PhysicalCueGate,WindowWatch,besideCursor } from '../../src/shared/desktopVisits';
import { ExplorationDirector } from '../../src/shared/explorationDirector';
import { lowerWindowRest } from '../../src/main/desktop/exposure';
import { MusicChanges,parsePlayingTrack,parseBrowserVideo } from '../../src/main/spotifyContext';
import { DIALOGUE_BEATS,DialogueDirector } from '../../src/shared/dialogue';
import { worldContext } from '../../src/shared/worldContext';
describe('lasting dialogue guide and situated movement',()=>{
  it('uses the cumulative runtime guide in live chat and ambient voice without injecting example replies',()=>{
    expect(CAPRI_DIALOGUE_REGISTER).toContain(CAPRI_DIALOGUE_GUIDE);
    const prompt=buildSystemPrompt(DEFAULT_SETTINGS,[],new Date(),{compact:true,examples:false,userText:'What about this song?'});
    for(const rule of ['NIGHT CITY VOICE','KNOWLEDGE IS NOT LIVE SENSING','SELF AND VALUES','LASTING PERSONALITY','SITUATED MOMENTS'])expect(prompt).toContain(rule);
    expect(prompt).not.toContain('Damn inconvenient thing to want');
    expect(worldContext('I Really Want to Stay at Your House')).toContain('David/Lucy');
    expect(worldContext('Capri source code')).toContain('Do not claim self-modification');
  });
  it('queues new windows once, settles briefly, yields to blocking and forgets closed targets',()=>{
    const visits=new DesktopVisits(0,()=>0);visits.opened('a',1000);
    expect(visits.window(2000,false)).toBeNull();expect(visits.window(4000,true)).toBeNull();expect(visits.window(4000,false)).toBe('a');
    visits.opened('a',5000);expect(visits.window(30000,false)).toBeNull();
    visits.closed(new Set());visits.opened('a',31000);expect(visits.window(34000,false)).toBe('a');
    visits.opened('b',35000);visits.closed(new Set(['a']));expect(visits.window(50000,false)).toBeNull();
  });
  it('allows occasional cursor visits without a generated phrase, yields to focus, and bounds follow position',()=>{
    const visits=new DesktopVisits(0,()=>0);expect(visits.cursor(89999,false)).toBe(false);expect(visits.cursor(90000,true)).toBe(false);expect(visits.cursor(90000,false)).toBe(true);expect(visits.cursor(90001,false)).toBe(false);
    const area={x:1000,y:0,width:1000,height:800},pet={width:200,height:300};
    const p=besideCursor({x:1950,y:780},pet,area);expect(p.x).toBeLessThan(1950);expect(p.y+pet.height).toBeLessThanOrEqual(800);expect(p.x).toBeGreaterThanOrEqual(1000);
  });
  it('new openings can interrupt an ordinary outing rest while ordinary revisits cannot',()=>{
    const d=new ExplorationDirector(()=>.9),now=1000000,pick=d.choose([{key:'old'}],now)!;d.complete(pick.key,now);
    expect(d.choose([{key:'new'}],now+2000)).toBeNull();expect(d.choose([{key:'new'}],now+2000,{newlyOpened:true})?.key).toBe('new');
  });
  it('interested windows can receive both a survey and direct settling or lounging',()=>{
    const seen=new Set<string>();
    for(const rand of [0,.4,.9]){const d=new ExplorationDirector(()=>rand);const pick=d.choose([{key:'subject',interest:12}],1000000)!;seen.add(pick.manner);}
    expect(seen.has('inspect')||seen.has('survey')).toBe(true);expect(seen.has('settle')).toBe(true);expect(seen.has('lounge')).toBe(true);
  });
  it('chooses only a supported exposed lower ledge and revalidates covers',()=>{
    const pet={x:0,y:0,width:200,height:300},window={x:100,y:100,width:800,height:550},area={x:0,y:0,width:1600,height:900};
    expect(lowerWindowRest(pet,window,[],area,{x:1400,y:800})?.bounds.y).toBeGreaterThan(100);
    expect(lowerWindowRest(pet,window,[window],area,{x:1400,y:800})).toBeNull();
    expect(lowerWindowRest(pet,{...window,width:100},[],area,{x:1400,y:800})).toBeNull();
  });
  it('time/battery cues are one-off developments and in-window shifts need a changed cause',()=>{
    const gate=new PhysicalCueGate();expect(gate.taskbar('late:today',true)).toBe(false);expect(gate.taskbar('late:today',false)).toBe(true);expect(gate.taskbar('late:today',false)).toBe(false);expect(gate.taskbar('low-battery',false)).toBe(true);
    expect(gate.shift('view:1',100000,false)).toBe(true);expect(gate.shift('view:1',150000,false)).toBe(false);expect(gate.shift('view:2',150000,true)).toBe(false);expect(gate.shift('view:2',150000,false)).toBe(true);
  });
  it('reacts to actual stable track changes and drops skipped or stopped songs without repeating tracks',()=>{
    const track=(title:string)=>parsePlayingTrack(JSON.stringify({title,artist:'Artist',source:'Spotify.exe',playing:true}))!;
    const m=new MusicChanges();m.observe(track('a'),1000);expect(m.take(4000,false)).toBeNull();m.observe(track('b'),4500);expect(m.take(9000,true)).toBeNull();expect(m.take(9000,false)?.title).toBe('b');
    m.observe(null,20000);expect(m.take(60000,false)).toBeNull();m.observe(track('b'),61000);expect(m.take(66000,false)).toBeNull();m.observe(track('c'),67000);expect(m.take(72000,false)?.title).toBe('c');
  });
  it('visits a settled new YouTube subject once and samples perched content without demanding repeated speech',()=>{
    const watch=new WindowWatch(),now=1000000;
    expect(watch.videoVisit('video1',now,false)).toBe(false);expect(watch.videoVisit('video1',now+7000,true)).toBe(false);expect(watch.videoVisit('video1',now+7000,false)).toBe(true);expect(watch.videoVisit('video1',now+100000,false)).toBe(false);
    expect(watch.inspect('perch',now,false)).toBe(false);expect(watch.inspect('perch',now+50000,false,now+40000)).toBe(false);expect(watch.inspect('perch',now+140000,false,now+40000)).toBe(true);expect(watch.inspect('perch',now+141000,false,now+40000)).toBe(false);
    expect(watch.videoVisit('video2',now+150000,false)).toBe(false);expect(watch.videoVisit('video2',now+157000,false)).toBe(true);
  });
  it('has a broad authored bank with specific same-window reactions and no unsupported title slots',()=>{
    for(const event of ['pat','poke','pickup','putdown'] as const){const lines=DIALOGUE_BEATS.filter(b=>b.event===event).flatMap(b=>b.starts);expect(lines.length).toBeGreaterThanOrEqual(20);}
    const d=new DialogueDirector(()=>.4);expect(d.choose({event:'move_aside'},{required:true})).toMatch(/corner|screen|window|pixels|seat|scoot|area|over here|bit|frame/);
  });
  it('accepts creator metadata only from a matching browser video and never guesses it from a title',()=>{
    const raw=JSON.stringify({source:'chrome.exe',title:'Building a tiny engine',artist:'Known Maker',playing:true});
    expect(parseBrowserVideo(raw,'Building a tiny engine - YouTube - Google Chrome')?.channel).toBe('Known Maker');
    expect(parseBrowserVideo(raw,'A different video - YouTube')).toBeNull();
    expect(parseBrowserVideo(raw.replace('Known Maker',''),'Building a tiny engine - YouTube')).toBeNull();
    expect(parseBrowserVideo(raw.replace('chrome.exe','Spotify.exe'),'Building a tiny engine - YouTube')).toBeNull();
  });
});
