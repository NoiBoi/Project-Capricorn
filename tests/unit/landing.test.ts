import { describe, expect, it } from 'vitest';
import { LandingRest } from '../../src/shared/landing';
import { SecondaryBehavior } from '../../src/shared/secondaryBehavior';
const support = { sit: true, lie: true, kind: 'taskbar' as const };
describe('fall recovery', () => {
  it('stands first, sits for a while, then sometimes lies, and returns to sitting', () => {
    const rest = new LandingRest(() => 0);rest.start(1000);
    expect(rest.phase(1000,support)).toBe('stand');
    expect(rest.phase(6999,support)).toBe('stand');
    expect(rest.phase(7000,support)).toBe('sit');
    expect(rest.phase(31999,support)).toBe('sit');
    expect(rest.phase(32000,support)).toBe('lie');
    expect(rest.phase(92000,support)).toBe('sit');
  });
  it('can keep sitting, never lies without room, and cancels when support is lost', () => {
    const rest = new LandingRest(() => .99);rest.start(0);
    expect(rest.phase(60000,support)).toBe('sit');
    const lying = new LandingRest(() => 0);lying.start(0);
    expect(lying.phase(60000,{...support,lie:false})).toBe('sit');
    expect(lying.phase(61000,{sit:false,lie:false,kind:'none'})).toBeUndefined();
    expect(lying.phase(62000,support)).toBeUndefined();
    expect(lying.holding(62000)).toBe(false);
  });
  it('prevents the ordinary lower-ledge rest from replacing landing recovery', () => {
    const behavior = new SecondaryBehavior();
    const base = { enabled:true,blocked:false,inverted:false,hovering:false,inspectingBelow:false,patting:false };
    for(const landing of ['stand','sit'] as const)expect(behavior.update(80,{...base,support:{...support,landing}}).pose).toBeNull();
    expect(behavior.update(.1,{...base,support:{...support,landing:'lie'}}).pose).toBe('recline');
  });
});
