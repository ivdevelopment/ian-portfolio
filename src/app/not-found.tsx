import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main id="main" className="container-page page-top flex min-h-[70dvh] flex-col items-start justify-center pb-24">
        <p className="text-sm tracking-[0.18em] text-muted uppercase">404</p>
        <h1 className="text-display mt-4">This page doesn&apos;t exist.</h1>
        <p className="mt-5 max-w-md text-lg text-muted">
          The link may be broken or the page may have moved.
        </p>
        <div className="mt-8 flex gap-3">
          <ButtonLink href="/" size="lg">
            Back to home
          </ButtonLink>
          <ButtonLink href="/work" variant="secondary" size="lg" icon="none">
            View my work
          </ButtonLink>
        </div>
      </main>
      <Footer />
    </>
  );
}
