import {it,expect,vi} from 'vitest';
vi.mock('@/components/theme-provider',()=>({ThemeProvider:({children}:any)=>children}));
import {metadata,viewport} from '@/app/layout';
import {metadata as landing} from '@/app/page';
import {site} from '@/config/site';

it('root metadata carries share-card and theme data',()=>{
 expect(metadata.metadataBase).toBeInstanceOf(URL);
 expect(metadata.title).toBe(site.name);
 const og=metadata.openGraph as Record<string,unknown>;
 expect(og.siteName).toBe(site.name);
 expect(og.description).toBe(site.description);
 expect((metadata.twitter as Record<string,unknown>).card).toBe('summary_large_image');
 const colors=viewport.themeColor as {media:string;color:string}[];
 expect(colors.map(c=>c.media).sort()).toEqual(['(prefers-color-scheme: dark)','(prefers-color-scheme: light)']);
 for(const c of colors)expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
});

it('landing page declares its canonical',()=>{
 expect(landing.alternates?.canonical).toBe('/');
});
