"use client";

import { Check, FileJson, Save } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Meter } from "@/components/ui";
import { JsonPreview } from "./json-preview";
import { useClearAutosave, useDraft, useDraftDispatch } from "@/context/knowledge-draft";
import { saveKnowledgeBase } from "@/lib/knowledge/client";
import { attentionFields, editCount } from "@/lib/knowledge/draft";
import type { KnowledgeBase } from "@/lib/schema";

/**
 * The sticky footer: where you are, and the two things you can do about it.
 *
 * Save is never blocked by incomplete fields (docs/EDIT-UX.md §8). A partial
 * knowledge base is valuable, and hard-gating would punish exactly the sparse
 * site the roadmap says is normal — so when items are unreviewed the button says
 * `Save anyway` and carries the count, rather than refusing.
 */
export function SaveBar({ onSaved }: { onSaved?: (saved: KnowledgeBase) => void }) {
  const state = useDraft();
  const dispatch = useDraftDispatch();
  const clearAutosave = useClearAutosave();

  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = attentionFields(state).length;
  const edits = editCount(state);
  const { draft, saved } = state;

  async function save() {
    setSaving(true);
    setError(null);

    const result = await saveKnowledgeBase(draft);
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    dispatch({ type: "MARK_SAVED", knowledgeBase: result.value });
    // The autosaved copy exists to survive a refresh before the save. Once the
    // work is in the store, keeping it would resurrect an older draft the next
    // time this site is scraped.
    clearAutosave();
    onSaved?.(result.value);
  }

  return (
    <>
      {previewing ? (
        <JsonPreview knowledgeBase={draft} onClose={() => setPreviewing(false)} />
      ) : null}

      <div className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {error ? (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Meter
              value={draft.quality.overallScore}
              compact
              className="w-24 shrink-0 sm:w-40"
              label={`${Math.round(draft.quality.overallScore * 100)}% complete`}
            />
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
              {outstanding > 0 ? (
                <Badge tone="warn">{outstanding} to check</Badge>
              ) : (
                <Badge tone="success">
                  <Check className="size-3" aria-hidden="true" />
                  All checked
                </Badge>
              )}
              {edits > 0 ? (
                <span>
                  {edits} {edits === 1 ? "edit" : "edits"}
                </span>
              ) : null}
              {saved ? (
                <span className="text-success">Saved as version {draft.version}</span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPreviewing(true)}
              iconLeft={<FileJson className="size-4" aria-hidden="true" />}
            >
              <span className="hidden sm:inline">Preview JSON</span>
              <span className="sm:hidden">JSON</span>
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              onClick={save}
              iconLeft={<Save className="size-4" aria-hidden="true" />}
            >
              {saved
                ? "Save again"
                : outstanding > 0
                  ? `Save anyway (${outstanding} unchecked)`
                  : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
