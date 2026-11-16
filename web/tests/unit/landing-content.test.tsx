import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/landing/footer';
import { site } from '@/config/site';
vi.mock('next/image', () => ({ default: ({ sizes, ...props }: any) => <img {...props} /> }));

it('footer shows only the quote and copyright: no name, description or links', () => {
 render(<Footer />);
 expect(screen.queryByRole('navigation', { name: 'Footer' })).not.toBeInTheDocument();
 expect(screen.queryAllByRole('link')).toHaveLength(0);
 expect(screen.queryByText(site.name, { exact: true })).not.toBeInTheDocument();
 expect(screen.queryByText(site.description)).not.toBeInTheDocument();
 expect(screen.getByText(`"${site.footer.quote}"`)).toBeVisible();
});
