import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google';
import './globals.css';

const headingFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-heading',
});

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'Change Risk Copilot',
  description:
    'A small, production-minded AI app that assesses proposed software and infrastructure changes.',
};

export const viewport: Viewport = {
  themeColor: '#071116',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
