"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { Badge, Button, Card, Chip, ChipList, Input, Select, Textarea } from "@/components/ui";
import { ProvenanceBadge } from "../provenance-badge";
import { enumLabel, presentRecords } from "@/lib/knowledge/display";
import { provenanceOf } from "@/lib/knowledge/draft";
import {
  addLabel,
  blankRecord,
  isBlankRecord,
  recordFields,
  type RecordFieldSpec,
} from "@/lib/knowledge/records";
import { useDraftDispatch } from "@/context/knowledge-draft";

/**
 * The hard case from docs/EDIT-UX.md §4: a list of records, editable in place.
 *
 * Collapsed rows show identity only — thirty people expanded at once is the
 * interface the brief rules out. Reordering is buttons rather than drag: a drag
 * handle is a usability trap on a phone, and the keyboard path has to exist
 * anyway.
 */

export function RecordListField({
  path,
  records,
}: {
  path: string;
  /** The raw records from the draft, not the presented ones. */
  records: Array<Record<string, unknown>>;
}) {
  const dispatch = useDraftDispatch();
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = recordFields(path);

  function addRecord() {
    const record = blankRecord(path);
    dispatch({ type: "ADD_ITEM", path, record });
    // A new record is empty by definition, so it opens straight into edit mode
    // rather than adding a blank row somebody has to find and click.
    setOpenId(record.id);
  }

  return (
    <div className="flex flex-col gap-2">
      {records.map((record, index) => (
        <RecordRow
          key={String(record.id ?? index)}
          path={path}
          record={record}
          index={index}
          total={records.length}
          fields={fields}
          open={openId === record.id}
          onToggle={() =>
            setOpenId(openId === record.id ? null : (record.id as string))
          }
        />
      ))}

      {fields.length > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          iconLeft={<Plus className="size-4" aria-hidden="true" />}
          onClick={addRecord}
        >
          {addLabel(path)}
        </Button>
      ) : null}
    </div>
  );
}

type RowProps = {
  path: string;
  record: Record<string, unknown>;
  index: number;
  total: number;
  fields: readonly RecordFieldSpec[];
  open: boolean;
  onToggle: () => void;
};

/**
 * Memoized on its own record. Bee Cave's draft holds thirty people, and without
 * this every keystroke anywhere on the page re-renders all of them
 * (docs/EDIT-UX.md §3).
 */
const RecordRow = memo(function RecordRow({
  path,
  record,
  index,
  total,
  fields,
  open,
  onToggle,
}: RowProps) {
  const dispatch = useDraftDispatch();
  const presented = presentRecords(path, [record])[0];
  const provenance = provenanceOf(record);
  const id = String(record.id ?? index);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-2 p-2 pl-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">
              {presented?.title || <span className="text-ink-subtle">Untitled</span>}
            </span>
            {presented?.subtitle ? (
              <span className="text-xs text-ink-subtle">{presented.subtitle}</span>
            ) : null}
            {presented?.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </span>
        </button>

        {provenance ? <ProvenanceBadge method={provenance.method} /> : null}

        <div className="flex shrink-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${presented?.title ?? "item"} up`}
            disabled={index === 0}
            onClick={() => dispatch({ type: "REORDER", path, from: index, to: index - 1 })}
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${presented?.title ?? "item"} down`}
            disabled={index === total - 1}
            onClick={() => dispatch({ type: "REORDER", path, from: index, to: index + 1 })}
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${presented?.title ?? "item"}`}
            onClick={() => dispatch({ type: "REMOVE_ITEM", path, id })}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {open ? (
        <RecordForm
          path={path}
          record={record}
          fields={fields}
          onDone={onToggle}
        />
      ) : null}
    </Card>
  );
});

/**
 * The expanded card. Local state for every sub-field, committed as one patch —
 * so a half-typed name never lands in the draft and never re-renders the list.
 */
function RecordForm({
  path,
  record,
  fields,
  onDone,
}: {
  path: string;
  record: Record<string, unknown>;
  fields: readonly RecordFieldSpec[];
  onDone: () => void;
}) {
  const dispatch = useDraftDispatch();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, record[field.key] ?? null])),
  );

  function set(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const patch: Record<string, unknown> = {};
    for (const field of fields) {
      patch[field.key] = normalize(field, values[field.key]);
    }

    // An added record that was never filled in is a mis-click, not data.
    if (isBlankRecord(path, { ...record, ...patch })) {
      dispatch({ type: "REMOVE_ITEM", path, id: String(record.id) });
    } else {
      dispatch({ type: "UPDATE_ITEM", path, id: String(record.id), patch });
    }
    onDone();
  }

  return (
    <div className="border-t border-border bg-surface-sunken/40 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.key}
            className={field.kind === "prose" ? "sm:col-span-2" : undefined}
          >
            <SubField
              field={field}
              value={values[field.key]}
              onChange={(value) => set(field.key, value)}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={save}>
          Done
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SubField({
  field,
  value,
  onChange,
}: {
  field: RecordFieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === "enum") {
    return (
      <Select
        label={field.label}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Not set</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {enumLabel(option)}
          </option>
        ))}
      </Select>
    );
  }

  if (field.kind === "prose") {
    return (
      <Textarea
        label={field.label}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.kind === "chips") {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-muted">{field.label}</span>
        {items.length > 0 ? (
          <ChipList>
            {items.map((item, index) => (
              <Chip
                key={`${item}-${index}`}
                label={item}
                onRemove={() => onChange(items.filter((_, position) => position !== index))}
              >
                {item}
              </Chip>
            ))}
          </ChipList>
        ) : null}
        <Input
          placeholder="Type and press Enter"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const entry = event.currentTarget.value.trim();
            if (!entry) return;
            onChange([...items, ...entry.split(",").map((part) => part.trim()).filter(Boolean)]);
            event.currentTarget.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <Input
      label={field.label}
      placeholder={field.placeholder}
      inputMode={field.kind === "number" ? "numeric" : undefined}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Blank strings become `null`, number fields become numbers or `null`. */
function normalize(field: RecordFieldSpec, value: unknown): unknown {
  if (field.kind === "chips") return Array.isArray(value) ? value : [];
  if (field.kind === "number") {
    const parsed = Number(String(value ?? "").trim());
    return String(value ?? "").trim() === "" || Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // The identity field is required by the schema as a string, so it stays one.
    return trimmed.length === 0 ? (field.identity ? "" : null) : trimmed;
  }
  return value ?? null;
}
