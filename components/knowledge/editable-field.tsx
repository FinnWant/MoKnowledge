"use client";

import { Pencil, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { FieldValue } from "./field-value";
import { FieldEditor } from "./editors/field-editor";
import { RecordListField } from "./editors/record-list-field";
import { ProvenanceBadge } from "./provenance-badge";
import { useDraft, useDraftDispatch } from "@/context/knowledge-draft";
import { displayKind, reviewFlag, sourceSummary } from "@/lib/knowledge/display";
import { isEditableCollection } from "@/lib/knowledge/records";
import type { FieldMeta, Sourced } from "@/lib/schema";

/**
 * One field, reviewable and correctable.
 *
 * The read-only display is the default state and the editor is opened on
 * request, because docs/EDIT-UX.md §1 is explicit that this is a draft to
 * approve rather than a form to fill: a user who reads nothing and saves must
 * still get a good knowledge base.
 */
export function EditableField({
  meta,
  field,
}: {
  meta: FieldMeta;
  field: Sourced<unknown>;
}) {
  const dispatch = useDraftDispatch();
  const state = useDraft();
  const [editing, setEditing] = useState(false);

  const dirty = state.dirty.has(meta.path);
  const flag = reviewFlag(field);
  const empty = isEmpty(field.value);
  const records = displayKind(meta) === "records" && isEditableCollection(meta.path);

  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
          {meta.label}
        </h4>

        <div className="flex shrink-0 items-center gap-1.5">
          {flag && !editing ? (
            <Badge tone="warn" title={flag.detail}>
              {flag.label}
            </Badge>
          ) : null}
          <ProvenanceBadge method={field.method} />

          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                dispatch({ type: "REVERT_FIELD", path: meta.path });
                setEditing(false);
              }}
              iconLeft={<Undo2 className="size-3.5" aria-hidden="true" />}
            >
              Undo
            </Button>
          ) : null}

          {!records && !editing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              iconLeft={
                empty ? (
                  <Plus className="size-3.5" aria-hidden="true" />
                ) : (
                  <Pencil className="size-3.5" aria-hidden="true" />
                )
              }
            >
              {empty ? "Add" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-1.5">
        {records ? (
          <RecordListField
            path={meta.path}
            records={Array.isArray(field.value) ? (field.value as Array<Record<string, unknown>>) : []}
          />
        ) : editing ? (
          <FieldEditor
            meta={meta}
            field={field}
            onCommit={(value) => {
              dispatch({ type: "SET_FIELD", path: meta.path, value });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : empty ? (
          <p className="text-sm text-ink-subtle">
            {meta.question ?? "We couldn't find this on the site."}
          </p>
        ) : (
          <FieldValue meta={meta} field={field} />
        )}
      </div>

      {!editing && field.sourceUrls.length > 0 && (flag || dirty) ? (
        <p className="mt-1.5 text-xs text-ink-subtle">
          {sourceSummary(field.sourceUrls)}
        </p>
      ) : null}
    </div>
  );
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}
