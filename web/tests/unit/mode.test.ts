import {it,expect} from 'vitest';
import {LAST_MODE_KEY,MODES,modeFromPathname,modeHome,readLastMode,writeLastMode} from '@/core/workspace/mode';

it('derives the mode from each route family and nothing else',()=>{
 expect(modeFromPathname('/workspace/chats/new')).toBe('ask');
 expect(modeFromPathname('/workspace/chats')).toBe('ask');
 expect(modeFromPathname('/workspace/chats/abc123')).toBe('ask');
 expect(modeFromPathname('/workspace/courses')).toBe('master');
 expect(modeFromPathname('/workspace/courses/c1/lessons/l1')).toBe('master');
 expect(modeFromPathname('/workspace/progress')).toBe('master');
 expect(modeFromPathname('/workspace')).toBeNull();
 expect(modeFromPathname('/docs')).toBeNull();
 expect(modeFromPathname(null)).toBeNull();
});

it('uses the approved copy and homes',()=>{
 expect(MODES.map(m=>[m.label,m.tagline,m.number])).toEqual([
  ['Ask','Get answers. Understand anything.','Mode 01'],
  ['Master','Learn deeply. Build mastery.','Mode 02'],
 ]);
 expect(modeHome('ask')).toBe('/workspace/chats/new');
 expect(modeHome('master')).toBe('/workspace/courses');
});

it('remembers the last mode only as a hint and ignores junk',()=>{
 expect(readLastMode(localStorage)).toBeNull();
 writeLastMode(localStorage,'master');
 expect(localStorage.getItem(LAST_MODE_KEY)).toBe('master');
 expect(readLastMode(localStorage)).toBe('master');
 localStorage.setItem(LAST_MODE_KEY,'ultra');
 expect(readLastMode(localStorage)).toBeNull();
 const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}} as unknown as Storage;
 expect(readLastMode(broken)).toBeNull();
 expect(()=>writeLastMode(broken,'ask')).not.toThrow();
});
