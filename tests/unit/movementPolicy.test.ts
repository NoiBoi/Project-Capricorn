import {describe,it,expect} from 'vitest';
import {Company,companyControl} from '../../src/shared/company';
import {clearVideo,videoWindow,resolveWindow} from '../../src/main/desktop/movementPolicy';
import {tourPlan} from '../../src/main/desktop/spatial';

describe('requested stays and window boundaries',()=>{
  it.each(['stay here for 5 minutes','sit here for 5 mins','stay here for five minutes','Capri, could you please stay here for 5 minutes?'])('parses timed request %s',text=>expect(companyControl(text)).toEqual({kind:'stay',minutes:5}));
  it('holds, dozes, wakes, warns once, then releases on the actual deadline',()=>{
    const c=new Company(),start=1000;c.apply({kind:'stay',minutes:5},start);
    expect(c.stayState(start+10000).phase).toBe('awake');
    expect(c.stayState(start+120000).phase).toBe('sleep');
    expect(c.stayState(start+240000)).toMatchObject({phase:'awake',reminderDue:true,remaining:60000});
    c.markReminded();expect(c.stayState(start+250000).reminderDue).toBe(false);
    expect(c.blocked(start+299999)).toBe(true);expect(c.blocked(start+300000)).toBe(false);
    expect(c.stayState(start+300000).phase).toBeNull();
    c.apply({kind:'stay',minutes:1},start);expect(c.stayState(start+48000).reminderDue).toBe(true);
    c.apply({kind:'release'},start+49000);expect(c.stayState(start+49000).phase).toBeNull();
  });
  it('does not turn short stays into immediate naps or warn for indefinite stays',()=>{
    const c=new Company();c.apply({kind:'stay',minutes:1},1000);expect(c.stayState(40000).phase).toBe('awake');
    c.apply({kind:'stay'},1000);expect(c.stayState(200000)).toMatchObject({phase:'sleep',reminderDue:false});
  });
  it('parses named avoidance, release and direct self movement',()=>{
    expect(companyControl('avoid the YouTube window for 10 minutes')).toEqual({kind:'avoid',target:'the youtube window',minutes:10});
    expect(companyControl('stop avoiding this window')).toEqual({kind:'allow_window',target:'this window'});
    expect(companyControl('fly to the Chrome window')).toEqual({kind:'move_window',target:'the chrome',motion:'glide'});
    expect(companyControl('teleport to the Spotify window')).toEqual({kind:'move_window',target:'the spotify',motion:'teleport'});
    const c=new Company();c.avoid('7',1,0);expect(c.avoiding('7',59999)).toBe(true);expect(c.avoiding('7',60000)).toBe(false);
    c.avoid('8');c.pruneWindows(new Set());expect(c.avoiding('8')).toBe(false);
  });
  it('resolves only unique matching windows and the real current target',()=>{
    const windows=[{handle:1n,title:'Lesson - YouTube',process:'chrome.exe'},{handle:2n,title:'Notes',process:'chrome.exe'}];
    expect(resolveWindow('the YouTube window',windows)?.handle).toBe(1n);
    expect(resolveWindow('Chrome',windows)).toBeNull();
    expect(resolveWindow('this window',windows,2n)?.handle).toBe(2n);
    expect(resolveWindow('this window',windows,3n)).toBeNull();
  });
});
describe('video edge routes',()=>{
  it('protects video services and local players without marking every browser window',()=>{
    expect(videoWindow({title:'A lesson - YouTube',process:'chrome.exe'})).toBe(true);
    expect(videoWindow({title:'movie.mp4',process:'vlc.exe'})).toBe(true);
    expect(videoWindow({title:'Notes',process:'chrome.exe'})).toBe(false);
  });
  it('keeps every planned viewing point and perch clear of the central viewing area',()=>{
    const win={x:0,y:0,width:1600,height:950},pet={x:0,y:0,width:150,height:240},area={x:0,y:0,width:1920,height:1040};
    for(let i=0;i<30;i++){
      const plan=tourPlan(pet,win,[],area,{x:800,y:500},Math.random,true);
      expect(plan).not.toBeNull();
      for(const p of [...plan!.points,plan!.perch.bounds])expect(clearVideo(p,win)).toBe(true);
    }
  });
});
