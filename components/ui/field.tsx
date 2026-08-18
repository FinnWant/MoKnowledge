"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";

const CONTROL = cn(
  "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2",
  "text-sm text-ink placeholder:text-ink-subtle",
  "transition-colors hover:border-border-strong",
  // `focus:border-link` only. Tailwind's focus outline-reset utility must never
  // be added here: it compiles to a `:focus` rule at specificity (0,2,0), which
  // beats the `:focus-visible` ring in globals.css at (0,1,0) and silently
  // removes the keyboard focus indicator from every input, select and textarea
  // in the app. A 1px border colour shift is not a substitute (WCAG 2.4.7).
  // Because the global rule is `:focus-visible`, a mouse click still gets only
  // the border and the ring stays keyboard-only. Guarded by
  // tests/ui/focus-visible.test.ts. (Naming the class here would be enough for
  // Tailwind's scanner to emit the dead rule into the bundle.)
  "focus:border-link",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-danger",
);

type FieldFrameProps = {
  label?: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
};

/**
 * Label + hint + error wrapper. Every control goes through it so the
 * label/description/error wiring is done once rather than per field — the a11y
 * requirement in docs/EDIT-UX.md §10 is easy to satisfy accidentally and easy to
 * forget one at a time.
 */
function FieldFrame({ label, hint, error, children }: FieldFrameProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-sm font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label?: string; hint?: string; error?: string };

export function Input({
  label,
  hint,
  error,
  className,
  ...props
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, className)}
        />
      )}
    </FieldFrame>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  ...props
}: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, "min-h-24 resize-y leading-relaxed", className)}
        />
      )}
    </FieldFrame>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, "appearance-none pr-8", className)}
        >
          {children}
        </select>
      )}
    </FieldFrame>
  );
}
