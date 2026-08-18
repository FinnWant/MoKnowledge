"use client";

import { MoreVertical } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Renders in the danger colour and sits below a divider. */
  destructive?: boolean;
  disabled?: boolean;
};

export type MenuProps = {
  items: MenuItem[];
  /** Names the trigger: "Actions for Bee Cave Drilling". */
  label: string;
  align?: "left" | "right";
  className?: string;
};

/**
 * The `⋮` row menu, on cards and table rows.
 *
 * Hand-rolled rather than a headless-UI dependency, and kept to what a menu
 * genuinely needs to be usable without a mouse: arrow keys move, Escape closes
 * and returns focus to the trigger, a click outside dismisses. Anything more
 * (typeahead, submenus) would be scaffolding for six items that fit on a screen.
 */
export function Menu({ items, label, align = "right", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    // Capture, so a click that also triggers something else still closes this.
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + items.length) % items.length);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(items.length - 1);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setActive(0);
          setOpen((current) => !current);
        }}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg",
          "text-ink-subtle transition-colors hover:bg-surface-raised hover:text-ink",
          open && "bg-surface-raised text-ink",
        )}
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-1 min-w-48 overflow-hidden rounded-lg border border-border",
            "bg-surface-raised py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              tabIndex={index === active ? 0 : -1}
              onFocus={() => setActive(index)}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                item.destructive
                  ? "text-danger hover:bg-danger-soft"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
                item.destructive && "mt-1 border-t border-border",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
