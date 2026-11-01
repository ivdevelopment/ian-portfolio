import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "@/app/globals.css";
import { NavigationProgress } from "@/components/ui/navigation-progress";
import { AppPathsProvider } from "@/lib/crm/paths-context";

/**
 * Root layout of the CRM host. A private business tool: no public metadata, no analytics, no SEO, noindex everywhere
 * (authentication is the real protection; this is defence in depth, together with the X-Robots-Tag header and robots.txt).
 */
export const metadata: Metadata = {
  title: { default: "CRM — Ian Verlinden", template: "%s — CRM" },
  description: "Private business workspace.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "same-origin",
};

export const viewport: Viewport = {
  themeColor: "#0a0e1b",
  colorScheme: "dark",
};

export default function CrmRootLayout({ children }: LayoutProps<"/crm">) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh">
        <NavigationProgress />
        <AppPathsProvider kind="crm">{children}</AppPathsProvider>
      </body>
    </html>
  );
}
