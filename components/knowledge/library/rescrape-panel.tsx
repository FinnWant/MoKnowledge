"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { ScrapeProgress } from "../scrape-progress";
import { DiffPanel } from "./diff-panel";
import { saveKnowledgeBase } from "@/lib/knowledge/client";
import {
  applyChanges,
  changedOnly,
  countChanges,
  diffKnowledgeBases,
  type FieldChange,
} from "@/lib/knowledge/diff";
import { initialProgress, progressReducer, type ProgressState } from "@/lib/knowledge/progress";
import { hostOf } from "@/lib/knowledge/display";
import type { KnowledgeBase } from "@/lib/schema";
import type { ScrapeEvent } from "@/lib/scraper/events";
import { readNdjson } from "@/lib/utils/ndjson";

/**
 * Re-scrape with a diff (R14) — the honest answer to the six-month drift problem
 * in docs/VALIDATION.md §2.
 *
 * A website changes; a knowledge base that has been reviewed by a human should
 * not silently follow it. So the new crawl is never applied on its own: it is
 * shown as a field-level diff, and the user accepts per field. Additions are
 * pre-selected because new information costs nothing to take, while changes and
 * removals start unchecked — those are the ones that would overwrite something
 * a person already looked at and approved.
 */

type Phase =
  | { status: "running" }
  | { status: "failed"; message: string; hint: string | null }
  | { status: "review"; incoming: KnowledgeBase; changes: FieldChange[] };

export function RescrapePanel({
  current,
  onApplied,
  onCancel,
}: {
  current: KnowledgeBase;
  onApplied: (saved: KnowledgeBase) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ status: "running" });
  const [progress, setProgress] = useState<ProgressState>(initialProgress);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProgress(initialProgress);
    setPhase({ status: "running" });

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: current.sourceUrl }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setPhase({
          status: "failed",
          message: `The scraper returned an error (${response.status}).`,
          hint: null,
        });
        return;
      }

      let settled = false;
      for await (const event of readNdjson<ScrapeEvent>(response.body)) {
        if (event.kind === "result") {
          settled = true;
          const changes = changedOnly(diffKnowledgeBases(current, event.knowledgeBase));
          setPhase({ status: "review", incoming: event.knowledgeBase, changes });
          setAccepted(
            new Set(
              changes
                .filter((change) => change.kind === "added")
                .map((change) => change.meta.path),
            ),
          );
        } else if (event.kind === "failed") {
          settled = true;
          setPhase({ status: "failed", message: event.message, hint: event.hint });
        } else {
          setProgress((state) => progressReducer(state, event));
        }
      }

      if (!settled) {
        setPhase({
          status: "failed",
          message: "The connection dropped before the scrape finished.",
          hint: "Try again — a partial run costs the site nothing.",
        });
      }
    } catch {
      if (controller.signal.aborted) return;
      setPhase({
        status: "failed",
        message: "We couldn't reach the scraper.",
        hint: "Check that the app is still running, then try again.",
      });
    }
  }, [current]);

  useEffect(() => {
    void run();
    return () => abortRef.current?.abort();
  }, [run]);

  const counts = useMemo(
    () => (phase.status === "review" ? countChanges(phase.changes) : null),
    [phase],
  );

  async function apply() {
    if (phase.status !== "review") return;

    setSaving(true);
    setError(null);

    const updated = applyChanges(current, phase.changes, accepted);
    // The crawl that produced the accepted values is the one this version was
    // built from, so its page list and warnings come across with them. It is
    // also what lets the version rail mark this save as a re-scrape.
    const result = await saveKnowledgeBase({ ...updated, scrape: phase.incoming.scrape });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onApplied(result.value);
  }

  if (phase.status === "running") {
    return (
      <ScrapeProgress
        url={current.sourceUrl}
        progress={progress}
        onCancel={() => {
          abortRef.current?.abort();
          onCancel();
        }}
      />
    );
  }

  if (phase.status === "failed") {
    return (
      <Card accent="danger" className="flex items-start gap-3 p-4">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            We couldn&apos;t re-read {hostOf(current.sourceUrl)}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{phase.message}</p>
          {phase.hint ? (
            <p className="mt-1 text-sm text-ink-subtle">{phase.hint}</p>
          ) : null}
          <p className="mt-2 text-sm text-ink-subtle">
            Nothing was changed — the saved knowledge base is exactly as it was.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void run()}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Back
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <RefreshCw className="size-4 text-ink-subtle" aria-hidden="true" />
            What changed on {hostOf(current.sourceUrl)}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {counts && counts.total > 0
              ? `${counts.added} new · ${counts.changed} changed · ${counts.removed} gone. Tick what you want to keep — nothing is applied until you save.`
              : "The site says the same things it did last time. Nothing to apply."}
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={accepted.size === 0}
            onClick={() => void apply()}
          >
            {accepted.size === 0
              ? "Nothing selected"
              : `Apply ${accepted.size} and save`}
          </Button>
        </div>
      </Card>

      <DiffPanel
        changes={phase.changes}
        selected={accepted}
        onToggle={(path) =>
          setAccepted((previous) => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })
        }
        beforeLabel="Saved now"
        afterLabel="On the site today"
        emptyMessage="Nothing on the site has changed since this knowledge base was saved."
      />
    </div>
  );
}
