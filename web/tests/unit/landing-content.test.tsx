import { it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HowItWorks, TrustSection, ClosingCta } from '@/components/landing/product-sections';
import { Footer } from '@/components/landing/footer';
import { privacySummary } from '@/content/privacy';
import { docs } from '@/content/docs';
import { site } from '@/config/site';
vi.mock('next/image', () => ({ default: ({ sizes, ...props }: any) => <img {...props} /> }));

it('shows three steps for each mode with sized, honestly labeled product screenshots', () => {
 render(<HowItWorks />);
 for (const mode of ['Ask', 'Master']) expect(within(screen.getByRole('list', { name: `${mode} steps` })).getAllByRole('listitem')).toHaveLength(3);
 for (const img of screen.getAllByRole('img')) {
  expect(img).toHaveAttribute('width', '1440');
  expect(img).toHaveAttribute('height', '1000');
 }
 expect(screen.getAllByText(/fictional Archive Handbook/)).toHaveLength(2);
});

it('keeps privacy wording identical to the documentation', () => {
 render(<TrustSection />);
 const paragraphs = docs.find(p => p.slug === 'evidence')!.sections.find(s => s.id === 'at-a-glance')!.paragraphs;
 expect(paragraphs).toEqual(privacySummary.map(p => p.text));
 for (const text of paragraphs) expect(screen.getByText(text)).toBeVisible();
 expect(screen.getByRole('link')).toHaveAttribute('href', '/docs/evidence');
});

it('keeps the closing action on the chooser and preserves footer quote, source and license links', () => {
 render(<><ClosingCta /><Footer /></>);
 expect(screen.getByRole('link', { name: 'Open your workspace' })).toHaveAttribute('href', '/workspace');
 const footer = within(screen.getByRole('navigation', { name: 'Footer' }));
 expect(footer.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/workspace');
 expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
 expect(footer.getByRole('link', { name: 'Repository' })).toHaveAttribute('href', site.repositoryUrl);
 expect(footer.getByRole('link', { name: 'Frontend MIT license' })).toHaveAttribute('href', `${site.repositoryUrl}/blob/main/web/LICENSE`);
 expect(screen.getByText(`"${site.footer.quote}"`)).toBeVisible();
});
