import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The PDF embeds the same typeface as the website (Geist), loaded from the `geist` package already installed for the site.
 * Subsets are embedded, so a quote stays a few tens of kilobytes. Each path is spelled out literally (the bundler can then see
 * exactly which files are needed instead of tracing the whole project), and `outputFileTracingIncludes` in next.config.ts
 * ships them with the serverless function.
 */
export type PdfFontBytes = { regular: Uint8Array; medium: Uint8Array; semibold: Uint8Array };

let cached: Promise<PdfFontBytes> | undefined;

export function loadPdfFonts(): Promise<PdfFontBytes> {
  cached ??= (async () => {
    const [regular, medium, semibold] = await Promise.all([
      readFile(path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf")),
      readFile(path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf")),
      readFile(path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf")),
    ]);
    return { regular, medium, semibold };
  })().catch((error) => {
    cached = undefined; // a failed read must not be remembered
    throw error;
  });
  return cached;
}
