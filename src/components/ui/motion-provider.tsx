"use client";

import { MotionConfig } from "motion/react";

/** Honours the visitor's `prefers-reduced-motion` setting for every animation. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
