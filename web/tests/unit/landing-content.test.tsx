import { it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Footer } from '@/components/landing/footer';
import { site } from '@/config/site';
vi.mock('next/image', () => ({ default: ({ sizes, ...props }: any) => <img {...props} /> }));

it('preserves footer quote, workspace, source and license links', () => {
 render(<Footer />);
 const footer = within(screen.getByRole('navigation', { name: 'Footer' }));
 expect(footer.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/workspace');
 expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
 expect(footer.getByRole('link', { name: 'Repository' })).toHaveAttribute('href', site.repositoryUrl);
 expect(footer.getByRole('link', { name: 'Frontend MIT license' })).toHaveAttribute('href', `${site.repositoryUrl}/blob/main/web/LICENSE`);
 expect(screen.getByText(`"${site.footer.quote}"`)).toBeVisible();
});
