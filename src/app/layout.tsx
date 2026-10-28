import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { siteConfig } from "@/config/site";
import { MotionProvider } from "@/components/ui/motion-provider";
import { getSiteSettings } from "@/lib/site-content";
import "./globals.css";

/** Defaults come from the CMS (/admin/settings); page-level metadata still overrides them. */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();

  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: s.seoDefaultTitle, template: s.seoTitleTemplate },
    description: s.seoDefaultDescription,
    applicationName: s.siteName,
    authors: [{ name: s.displayName }],
    openGraph: {
      type: "website",
      locale: siteConfig.locale,
      siteName: s.siteName,
      title: s.seoOgTitle || s.seoDefaultTitle,
      description: s.seoDefaultDescription,
      url: "/",
      // TODO: add a 1200x630 raster image (e.g. src/app/opengraph-image.png).
    },
    twitter: {
      card: "summary_large_image",
      title: s.seoOgTitle || s.seoDefaultTitle,
      description: s.seoDefaultDescription,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0e1b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
