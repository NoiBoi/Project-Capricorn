import {clampToDisplays,displayFor,type Rect,type DisplayLike} from './displays';
import {SEAT_RATIO} from '../../shared/framing';
/** All inputs/outputs are DIPs. Never feed rounded OS window sizes back into the model size. */
export function physicalRestDestination(current:Rect,displays:DisplayLike[],home?:Rect|null) {
  if(home)return {...clampToDisplays({...home,width:current.width,height:current.height},displays),kind:'spot' as const};
  const area=displayFor(current,displays).workArea;
  return {...current,x:Math.round(Math.max(area.x,Math.min(current.x,area.x+area.width-current.width))),
    y:Math.round(area.y+area.height-current.height*SEAT_RATIO),kind:'spot' as const};
}
