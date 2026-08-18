"use client";

import { Check, Plus, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button, Chip, ChipList, Input, Select, Textarea } from "@/components/ui";
import { chipValues, displayKind, enumLabel } from "@/lib/knowledge/display";
import { FIELD_ENUM_OPTIONS } from "@/lib/knowledge/records";
import { newId, type BrandColor, type FieldMeta, type Sourced } from "@/lib/schema";

/**
 * The eight editors of docs/EDIT-UX.md §4, chosen by field kind rather than by
 * field name — which is what stops the review page from growing a component per
 * field as the schema grows.
 *
 * Every editor holds its own value while open and commits once, so typing never
 * touches the draft reducer. That is the "local-then-commit" rule from §3, and
 * it is what keeps a keystroke from re-rendering thirty person cards.
 */

export type FieldEditorProps = {
  meta: FieldMeta;
  field: Sourced<unknown>;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
};

export function FieldEditor({ meta, field, onCommit, onCancel }: FieldEditorProps) {
  switch (displayKind(meta)) {
    case "prose":
      return <ProseEditor meta={meta} field={field} onCommit={onCommit} onCancel={onCancel} />;
    case "chips":
      return <ChipsEditor meta={meta} field={field} onCommit={onCommit} onCancel={onCancel} />;
    case "color":
      return <ColorEditor field={field} onCommit={onCommit} onCancel={onCancel} />;
    case "composite":
      return <CompositeEditor meta={meta} field={field} onCommit={onCommit} onCancel={onCancel} />;
    default:
      return <ScalarEditor meta={meta} field={field} onCommit={onCommit} onCancel={onCancel} />;
  }
}

/* ------------------------------------------------------------------ shared */

function EditorActions({
  onCommit,
  onCancel,
  hint,
}: {
  onCommit: () => void;
  onCancel: () => void;
  hint?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" onClick={onCommit} iconLeft={<Check className="size-4" aria-hidden="true" />}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {hint ? <span className="text-xs text-ink-subtle">{hint}</span> : null}
    </div>
  );
}

/* ---------------------------------------------- text · number · link · enum */

function ScalarEditor({ meta, field, onCommit, onCancel }: FieldEditorProps) {
  const options = FIELD_ENUM_OPTIONS[meta.path];
  const [value, setValue] = useState(
    field.value === null || field.value === undefined ? "" : String(field.value),
  );

  function commit() {
    if (meta.kind === "number") {
      const parsed = Number(value.trim());
      onCommit(value.trim() === "" || Number.isNaN(parsed) ? null : parsed);
      return;
    }
    onCommit(value);
  }

  if (options) {
    return (
      <div>
        <Select
          label={meta.label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">Not set</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {enumLabel(option)}
            </option>
          ))}
        </Select>
        <EditorActions onCommit={commit} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div>
      <Input
        autoFocus
        label={meta.label}
        value={value}
        inputMode={meta.kind === "number" ? "numeric" : undefined}
        placeholder={meta.example}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => keys(event, commit, onCancel)}
      />
      <EditorActions onCommit={commit} onCancel={onCancel} hint="Enter to save, Esc to cancel" />
    </div>
  );
}

function ProseEditor({ meta, field, onCommit, onCancel }: FieldEditorProps) {
  const [value, setValue] = useState(typeof field.value === "string" ? field.value : "");

  return (
    <div>
      <Textarea
        autoFocus
        label={meta.label}
        value={value}
        rows={Math.min(12, Math.max(3, Math.ceil(value.length / 80) + 1))}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onCommit(value);
        }}
      />
      <EditorActions
        onCommit={() => onCommit(value)}
        onCancel={onCancel}
        hint="Ctrl+Enter to save"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ chips */

function ChipsEditor({ meta, field, onCommit, onCancel }: FieldEditorProps) {
  const [values, setValues] = useState<string[]>(chipValues(meta.path, field.value));
  const [entry, setEntry] = useState("");

  /**
   * Pasting splits on commas. The reference profiles carry thirteen suppliers
   * and nine CTAs — nobody is typing those one at a time (docs/EDIT-UX.md §4).
   */
  function addFrom(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !values.includes(part));
    if (parts.length > 0) setValues([...values, ...parts]);
    setEntry("");
  }

  return (
    <div>
      {values.length > 0 ? (
        <ChipList className="mb-2">
          {values.map((value, index) => (
            <Chip
              key={`${value}-${index}`}
              label={value}
              onRemove={() => setValues(values.filter((_, position) => position !== index))}
            >
              {value}
            </Chip>
          ))}
        </ChipList>
      ) : null}

      <Input
        autoFocus
        label={`Add to ${meta.label.toLowerCase()}`}
        value={entry}
        placeholder="Type and press Enter — or paste a comma-separated list"
        onChange={(event) => setEntry(event.target.value)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (pasted.includes(",") || pasted.includes("\n")) {
            event.preventDefault();
            addFrom(pasted);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addFrom(entry);
          }
          if (event.key === "Escape") onCancel();
        }}
      />

      <EditorActions
        onCommit={() => onCommit(entry.trim() ? [...values, entry.trim()] : values)}
        onCancel={onCancel}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- colors */

const COLOR_ROLES = [
  "background",
  "surface",
  "text",
  "primary",
  "secondary",
  "accent",
  "border",
  "unknown",
] as const;

function ColorEditor({
  field,
  onCommit,
  onCancel,
}: Omit<FieldEditorProps, "meta">) {
  const [colors, setColors] = useState<BrandColor[]>(
    Array.isArray(field.value) ? (field.value as BrandColor[]) : [],
  );

  function update(index: number, patch: Partial<BrandColor>) {
    setColors(colors.map((color, position) => (position === index ? { ...color, ...patch } : color)));
  }

  return (
    <div className="flex flex-col gap-2">
      {colors.map((color, index) => (
        <div key={color.id} className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className="size-8 shrink-0 rounded border border-border-strong"
            style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : "transparent" }}
          />
          <input
            aria-label="Colour value"
            value={color.hex}
            onChange={(event) => update(index, { hex: event.target.value.toLowerCase() })}
            className="w-28 rounded-lg border border-border bg-surface-sunken px-2 py-1.5 font-mono text-sm text-ink"
          />
          <select
            aria-label="What this colour is used for"
            value={color.role}
            onChange={(event) => update(index, { role: event.target.value as BrandColor["role"] })}
            className="rounded-lg border border-border bg-surface-sunken px-2 py-1.5 text-sm text-ink"
          >
            {COLOR_ROLES.map((role) => (
              <option key={role} value={role}>
                {enumLabel(role)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${color.hex}`}
            onClick={() => setColors(colors.filter((_, position) => position !== index))}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}

      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        iconLeft={<Plus className="size-4" aria-hidden="true" />}
        onClick={() =>
          setColors([
            ...colors,
            {
              id: newId(),
              method: "user-edited",
              confidence: 1,
              sourceUrls: [],
              hex: "#000000",
              role: "primary",
              frequency: 0,
            },
          ])
        }
      >
        Add a colour
      </Button>

      <EditorActions
        // Anything that isn't a canonical hex is dropped rather than saved and
        // shown as a broken swatch — the schema requires `#rrggbb`.
        onCommit={() => onCommit(colors.filter((color) => /^#[0-9a-f]{6}$/.test(color.hex)))}
        onCancel={onCancel}
      />
    </div>
  );
}

/* -------------------------------------------------------------- composite */

/**
 * Structured scalars. Only the parts a person can sensibly correct are editable:
 * an address as the single line they read, and the writing-style description.
 * The measured parts of `writingStyle` — formality, reader address, term lists —
 * come from text metrics, and hand-editing a measurement is how you get a voice
 * guide that contradicts the site it describes.
 */
function CompositeEditor({ meta, field, onCommit, onCancel }: FieldEditorProps) {
  const current = (field.value ?? {}) as Record<string, unknown>;
  const key = meta.path === "branding.writingStyle" ? "description" : "formatted";
  const [value, setValue] = useState(
    typeof current[key] === "string" ? (current[key] as string) : "",
  );

  const Control = key === "description" ? Textarea : Input;

  return (
    <div>
      <Control
        autoFocus
        label={key === "description" ? "How the writing reads" : "Address"}
        value={value}
        onChange={(event: { target: { value: string } }) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <EditorActions
        onCommit={() =>
          onCommit(
            value.trim().length === 0 && Object.keys(current).length === 0
              ? null
              : { ...defaultsFor(meta.path), ...current, [key]: value.trim() },
          )
        }
        onCancel={onCancel}
      />
    </div>
  );
}

/** Sub-fields the schema requires, for a composite the scrape never filled. */
function defaultsFor(path: string): Record<string, unknown> {
  if (path === "branding.writingStyle") {
    return {
      description: "",
      tone: [],
      formality: "neutral",
      readerAddress: "mixed",
      preferredTerms: [],
      avoidTerms: [],
      ctaStyle: null,
    };
  }
  return {
    formatted: "",
    street: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
  };
}

function keys(
  event: KeyboardEvent,
  commit: () => void,
  cancel: () => void,
): void {
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
  }
  if (event.key === "Escape") cancel();
}
