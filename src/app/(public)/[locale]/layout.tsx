import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { GeistSans } from "geist/font/sans";
import "@/app/globals.css";
import { siteConfig } from "@/config/site";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { SiteAnalytics } from "@/components/layout/site-analytics";
import { MotionProvider } from "@/components/ui/motion-provider";
import { NavigationProgress } from "@/components/ui/navigation-progress";
import { htmlLang, isLocale, locales, ogLocale } from "@/i18n/config";
import { ogImageFor } from "@/lib/page-metadata";
import { LocaleProvider } from "@/i18n/context";
import { getDictionary } from "@/i18n/dictionaries";
import { getSiteSettings } from "@/lib/site-content";

/** Both languages are prerendered. Dutch is served without a prefix (the proxy rewrites it to /nl). */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/** Defaults come from the CMS (/admin/settings); page-level metadata still overrides them. */
export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const s = await getSiteSettings(locale);

  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: s.seoDefaultTitle, template: s.seoTitleTemplate },
    description: s.seoDefaultDescription,
    applicationName: s.siteName,
    authors: [{ name: s.displayName }],
    openGraph: {
      type: "website",
      locale: ogLocale[locale],
      siteName: s.siteName,
      title: s.seoOgTitle || s.seoDefaultTitle,
      description: s.seoDefaultDescription,
      images: ogImageFor(locale),
    },
    twitter: {
      card: "summary_large_image",
      title: s.seoOgTitle || s.seoDefaultTitle,
      description: s.seoDefaultDescription,
      images: ogImageFor(locale),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0e1b",
  colorScheme: "dark",
};

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <html lang={htmlLang[locale]} className={GeistSans.variable}>
      <body className="min-h-dvh">
        <NavigationProgress />
        <MotionProvider>
          <LocaleProvider locale={locale} dict={dict}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-accent-strong focus:px-4 focus:py-2 focus:text-white"
            >
              {dict.common.skipToContent}
            </a>
            <Navbar />
            <main id="main">{children}</main>
            <Footer />
            {/* The /_vercel/* scripts only exist on Vercel deployments. */}
            {process.env.VERCEL ? <SiteAnalytics /> : null}
          </LocaleProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
