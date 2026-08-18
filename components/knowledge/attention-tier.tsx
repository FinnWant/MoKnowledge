"use client";

import { Check, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { FieldValue } from "./field-value";
import { FieldEditor } from "./editors/field-editor";
import { useDraft, useDraftDispatch } from "@/context/knowledge-draft";
import { reviewFlag, sourceSummary } from "@/lib/knowledge/display";
import {
  attentionFields,
  safeToAccept,
  type AttentionItem,
} from "@/lib/knowledge/draft";
import type { Conflict, FieldMeta } from "@/lib/schema";

/**
 * The triage tier (docs/EDIT-UX.md §2).
 *
 * Everything arrives pre-filled and pre-accepted; this is the short list of
 * things the scraper is not sure about, pinned above the categories. It is the
 * whole reason the page is usable by someone who will not read sixty fields:
 * the exceptions come to them.
 */
export function AttentionTier() {
  const state = useDraft();
  const dispatch = useDraftDispatch();

  const items = attentionFields(state);
  const safe = safeToAccept(state);
  const accepted = state.reviewed.size;

  if (items.length === 0) {
    return (
      <Card accent="primary" className="flex items-center gap-3 p-4">
        <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        <p className="text-sm text-ink-muted">
          Nothing needs checking.
          {accepted > 0 ? ` You&apos;ve confirmed ${accepted}.` : ""} Save
          whenever you&apos;re ready.
        </p>
      </Card>
    );
  }

  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="attention-heading" className="text-sm font-semibold text-ink">
          Needs your attention{" "}
          <span className="font-normal text-ink-subtle">({items.length})</span>
        </h2>

        {safe.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => dispatch({ type: "ACCEPT_ALL_SAFE" })}
          >
            Looks right for {safe.length} of them
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {items.length} items need attention. {accepted} confirmed.
      </p>

      {items.map((item) =>
        item.conflict ? (
          <ConflictCard
            key={item.meta.path}
            meta={item.meta}
            conflict={item.conflict}
          />
        ) : (
          <UncertainCard key={item.meta.path} item={item} />
        ),
      )}
    </section>
  );
}

/* --------------------------------------------------------- uncertain value */

function UncertainCard({ item }: { item: AttentionItem }) {
  const dispatch = useDraftDispatch();
  const [editing, setEditing] = useState(false);
  const { meta, field } = item;

  const generated = field.method === "ai-live" || field.method === "ai-mock";
  const flag = reviewFlag(field);

  return (
    <Card accent="warn" className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{meta.label}</h3>
        <Badge tone={generated ? "info" : "warn"}>
          {generated ? (
            <>
              <Sparkles className="size-3" aria-hidden="true" />
              Written by AI — please read it
            </>
          ) : (
            (flag?.label ?? "Worth a look")
          )}
        </Badge>
      </div>

      <div className="mt-2">
        {editing ? (
          <FieldEditor
            meta={meta}
            field={field}
            onCommit={(value) => {
              dispatch({ type: "SET_FIELD", path: meta.path, value });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <FieldValue meta={meta} field={field} />
            <p className="mt-1.5 text-xs text-ink-subtle">
              {sourceSummary(field.sourceUrls) ?? flag?.detail}
            </p>
            <Actions meta={meta} onEdit={() => setEditing(true)} />
          </>
        )}
      </div>
    </Card>
  );
}

function Actions({ meta, onEdit }: { meta: FieldMeta; onEdit: () => void }) {
  const dispatch = useDraftDispatch();

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => dispatch({ type: "ACCEPT_FIELD", path: meta.path })}
        iconLeft={<Check className="size-4" aria-hidden="true" />}
      >
        Looks right
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        iconLeft={<Pencil className="size-4" aria-hidden="true" />}
      >
        Fix it
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => dispatch({ type: "SET_FIELD", path: meta.path, value: null })}
        iconLeft={<Trash2 className="size-4" aria-hidden="true" />}
      >
        Wrong — remove it
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------- conflicts */

/**
 * Two values, one field. We ask instead of guessing (docs/EDIT-UX.md §6): the
 * highest-precedence candidate is pre-selected so accepting the default is a
 * single tap, and whichever value loses is kept in the field's note rather than
 * thrown away.
 */
function ConflictCard({ meta, conflict }: { meta: FieldMeta; conflict: Conflict }) {
  const dispatch = useDraftDispatch();
  const [custom, setCustom] = useState("");
  const [choice, setChoice] = useState<number | "custom">(0);

  return (
    <Card accent="danger" className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{meta.label}</h3>
        <Badge tone="danger">
          We found {conflict.candidates.length} different answers
        </Badge>
      </div>

      <fieldset className="mt-2">
        <legend className="sr-only">Which is right?</legend>
        {conflict.candidates.map((candidate, index) => (
          <label
            key={`${index}-${String(candidate.value)}`}
            className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink"
          >
            <input
              type="radio"
              name={`conflict-${meta.path}`}
              checked={choice === index}
              onChange={() => setChoice(index)}
              className="accent-primary"
            />
            <span className="font-medium">{String(candidate.value)}</span>
            <span className="text-xs text-ink-subtle">{candidate.sourceLabel}</span>
          </label>
        ))}

        <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
          <input
            type="radio"
            name={`conflict-${meta.path}`}
            checked={choice === "custom"}
            onChange={() => setChoice("custom")}
            className="accent-primary"
          />
          <span>Something else</span>
          <input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setChoice("custom");
            }}
            aria-label={`A different value for ${meta.label}`}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-2 py-1 text-sm text-ink"
          />
        </label>
      </fieldset>

      <Button
        size="sm"
        variant="primary"
        className="mt-2"
        disabled={choice === "custom" && custom.trim().length === 0}
        onClick={() =>
          dispatch({
            type: "RESOLVE_CONFLICT",
            path: meta.path,
            choice: choice === "custom" ? { value: custom.trim() } : { index: choice },
          })
        }
      >
        Use this one
      </Button>
    </Card>
  );
}
