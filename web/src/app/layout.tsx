import "@/styles/globals.css";

import { type Metadata, type Viewport } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { site } from "@/config/site";

// Absolute URLs for share cards; override for a deployed host.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3001";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: site.name,
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.name,
    description: site.description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description: site.description,
  },
};

// Hex approximations of the oklch --background tokens; theme-color needs sRGB.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f3" },
    { media: "(prefers-color-scheme: dark)", color: "#262625" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
