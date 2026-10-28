"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  /** Seconds. Use small steps (0.06–0.12) to stagger siblings. */
  delay?: number;
  /** Starting offset in px. */
  y?: number;
  as?: "div" | "section" | "li" | "article" | "header" | "p";
};

const MotionTags = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
  article: motion.article,
  header: motion.header,
  p: motion.p,
} as const;

/** Subtle fade + rise the first time an element scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  as = "div",
}: RevealProps) {
  const Tag = MotionTags[as];
  return (
    <Tag
      className={cn(className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </Tag>
  );
}
