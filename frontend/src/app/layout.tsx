import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import { DemoBanner } from '@/components/ui/DemoBanner';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { themeInitScript } from '@/lib/theme-script';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'TOUCHLINE', template: '%s | TOUCHLINE' },
  description: 'Fixtures, results, standings, teams and players for departmental football competitions.',
};
export const viewport: Viewport = { themeColor: '#12301f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>
          <a className="skip-link" href="#content">Skip to content</a>
          <DemoBanner />
          <SiteHeader />
          <main id="content" className="page">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
