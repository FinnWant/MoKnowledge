"use client";

import { Check, Copy, Download, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { hostOf } from "@/lib/knowledge/display";
import type { KnowledgeBase } from "@/lib/schema";

/**
 * The exact object that will be written (docs/EDIT-UX.md §8).
 *
 * The assignment asks for the knowledge base to be converted into a JSON
 * structure; this is what makes that visible rather than implied. It is also the
 * fastest way for a reviewer to check that a badge in the UI matches the
 * provenance in the data.
 */
export function JsonPreview({
  knowledgeBase,
  onClose,
}: {
  knowledgeBase: KnowledgeBase;
  onClose: () => void;
}) {
  const json = useMemo(() => JSON.stringify(knowledgeBase, null, 2), [knowledgeBase]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copy() {
    navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${hostOf(knowledgeBase.sourceUrl).replace(/[^a-z0-9]+/gi, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The JSON that will be saved"
      className="fixed inset-0 z-50 flex flex-col bg-canvas/95 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              What gets saved
            </h2>
            <p className="text-xs text-ink-subtle">
              {(json.length / 1024).toFixed(0)} KB of JSON · every value carries
              where it came from
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={copy}
              iconLeft={
                copied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={download}
              iconLeft={<Download className="size-4" aria-hidden="true" />}
            >
              Download
            </Button>
            <Button
              autoFocus
              size="sm"
              variant="ghost"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-ink-muted">
          {json}
        </pre>
      </div>
    </div>
  );
}
