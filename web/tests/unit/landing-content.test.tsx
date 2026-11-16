import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/landing/footer';
import { site } from '@/config/site';
vi.mock('next/image', () => ({ default: ({ sizes, ...props }: any) => <img {...props} /> }));

it('footer keeps the name, description and quote, and has no link row', () => {
 render(<Footer />);
 expect(screen.queryByRole('navigation', { name: 'Footer' })).not.toBeInTheDocument();
 expect(screen.queryAllByRole('link')).toHaveLength(0);
 expect(screen.getByText(site.name)).toBeVisible();
 expect(screen.getByText(site.description)).toBeVisible();
 expect(screen.getByText(`"${site.footer.quote}"`)).toBeVisible();
});
