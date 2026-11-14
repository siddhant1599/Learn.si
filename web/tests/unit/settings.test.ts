import {it,expect} from 'vitest';
import {restoreSettings} from '@/core/chat/cache';
const fallback={depth:'pro' as const,model:'default'};

it('migrates settings saved under the legacy mode key to depth',()=>{
 expect(restoreSettings({mode:'ultra',model:'default'},fallback)).toEqual({depth:'ultra',model:'default'});
});
it('prefers depth over a stale mode key and rejects unknown values',()=>{
 expect(restoreSettings({depth:'flash',mode:'ultra',model:'m'},fallback)).toEqual({depth:'flash',model:'m'});
 expect(restoreSettings({depth:'turbo'},fallback)).toEqual(fallback);
 expect(restoreSettings(null,fallback)).toBe(fallback);
 expect(restoreSettings('pro',fallback)).toBe(fallback);
});
