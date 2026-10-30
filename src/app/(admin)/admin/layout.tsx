import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "@/app/globals.css";
import { MotionProvider } from "@/components/ui/motion-provider";

export const metadata: Metadata = {
  title: { absolute: "Admin" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0e1b",
  colorScheme: "dark",
};

/** The admin is English-only and has its own root layout (separate from the localized site). */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
