/**
 * Social platforms reliably render PNG, JPEG and WebP. SVG and GIF previews
 * are ignored or broken on most of them, so those fall back to the generated card.
 */
export function isShareableRaster(src: string | undefined): src is string {
  if (!src) return false;
  const path = src.split("?")[0]?.toLowerCase() ?? "";
  return /\.(png|jpe?g|webp)$/.test(path);
}
