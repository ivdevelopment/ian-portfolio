import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "soft" | "ghost";
type Size = "sm" | "md" | "lg";
type IconKind = "arrow" | "external" | "none";

const base =
  "group/btn inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none " +
  "transition-[transform,background-color,box-shadow,filter] duration-300 ease-out-soft active:scale-[0.97] " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent-strong text-white shadow-accent hover:-translate-y-px hover:brightness-110",
  secondary: "glass text-ink hover:bg-glass-strong hover:border-line-strong",
  soft: "bg-accent-tint text-bg hover:-translate-y-px hover:brightness-105",
  ghost: "text-ink hover:text-accent",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-[0.95rem]",
  lg: "h-14 px-7 text-base",
};

type StyleProps = {
  variant?: Variant;
  size?: Size;
  icon?: IconKind;
  className?: string;
};

function buttonClasses({ variant = "primary", size = "md", className }: StyleProps) {
  return cn(base, variants[variant], sizes[size], className);
}

function Icon({ kind }: { kind: IconKind }) {
  if (kind === "none") return null;
  const Cmp = kind === "external" ? ArrowUpRight : ArrowRight;
  return (
    <Cmp
      aria-hidden
      className={cn(
        "size-4 transition-transform duration-300 ease-out-soft group-hover/btn:translate-x-0.5",
        kind === "external" && "group-hover/btn:-translate-y-0.5",
      )}
    />
  );
}

type ButtonLinkProps = StyleProps & {
  href: string;
  /** Opens in a new tab with safe rel attributes. */
  external?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children: React.ReactNode;
};

/** Link styled as a button. Internal hrefs use next/link. */
export function ButtonLink({
  href,
  external,
  onClick,
  icon,
  children,
  ...style
}: ButtonLinkProps) {
  const classes = buttonClasses(style);
  const iconKind = icon ?? (external ? "external" : "arrow");

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        onClick={onClick}
      >
        {children}
        <Icon kind={iconKind} />
      </a>
    );
  }

  return (
    <Link href={href} className={classes} onClick={onClick}>
      {children}
      <Icon kind={iconKind} />
    </Link>
  );
}

type ButtonProps = StyleProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    children: React.ReactNode;
  };

export function Button({
  variant,
  size,
  icon = "none",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {children}
      <Icon kind={icon} />
    </button>
  );
}
