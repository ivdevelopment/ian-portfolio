import { notFound } from "next/navigation";

/** Any unknown public URL resolves here so it gets the localized 404 page (with a real 404 status). */
export function generateStaticParams() {
  return [{ rest: ["_"] }];
}

export default function CatchAll() {
  notFound();
}
