import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  // White on #2663eb measures 5.2:1 — the brand blue is only safe as a fill.
  primary:
    "bg-primary text-white hover:bg-primary-hover disabled:hover:bg-primary",
  secondary:
    "bg-surface-raised text-ink border border-border hover:border-border-strong hover:bg-surface",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-raised",
  danger:
    "bg-danger-soft text-danger border border-danger/30 hover:border-danger/60",
  link: "text-link underline underline-offset-4 hover:text-ink px-0",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

/**
 * The button's visual classes, without the button.
 *
 * `Button` renders a real `<button>`, which is correct — it is what screen
 * readers and keyboards expect for an action. A navigation that merely looks
 * like a button must still be an `<a>`, so it needs the classes without the
 * element. Exported rather than duplicated at each call site so the two cannot
 * drift apart.
 */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-medium",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and disables the button; keeps the label for stable width. */
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  iconLeft,
  iconRight,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        iconLeft
      )}
      {children}
      {iconRight}
    </button>
  );
}
