"use client";

import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { KnowledgeEditor } from "./knowledge-editor";
import { ScrapeProgress } from "./scrape-progress";
import { UrlForm } from "./url-form";
import type { EnrichmentReport } from "@/lib/ai/enrich";
import {
  initialProgress,
  progressReducer,
  type ProgressState,
} from "@/lib/knowledge/progress";
import type { KnowledgeBase } from "@/lib/schema";
import type { ScrapeEvent } from "@/lib/scraper/events";
import { readNdjson } from "@/lib/utils/ndjson";

/**
 * The scrape page's state machine: form → progress → result, or → failure.
 *
 * All of it client-side and in memory. There is no job store and nothing to
 * resume, which is the trade ROADMAP §3.2 makes deliberately: a single streamed
 * `POST` removes an entire subsystem, at the cost of a scrape not surviving a
 * page refresh. P5's `localStorage` draft is what makes the *reviewed* result
 * durable — the raw scrape is cheap to repeat.
 */

type Phase =
  | { status: "idle" }
  | { status: "running"; url: string }
  | {
      status: "done";
      url: string;
      knowledgeBase: KnowledgeBase;
      enrichment: EnrichmentReport | null;
    }
  | { status: "failed"; url: string; message: string; hint: string | null };

export function ScrapeWorkbench() {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [progress, setProgress] = useState<ProgressState>(initialProgress);
  const abortRef = useRef<AbortController | null>(null);

  // A scrape holds an open socket and a crawl of somebody's website. Leaving it
  // running after the user has navigated away is rude to them and to the site.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProgress(initialProgress);
    setPhase({ status: "running", url });

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setPhase({
          status: "failed",
          url,
          message: await errorMessage(response),
          hint: null,
        });
        return;
      }

      // Tracked separately from `phase`: the loop can't read state it set on a
      // previous iteration, and the stream ending without a result is its own
      // failure mode (a dropped connection, a killed server).
      let settled = false;

      for await (const event of readNdjson<ScrapeEvent>(response.body)) {
        if (event.kind === "result") {
          settled = true;
          setPhase({
            status: "done",
            url,
            knowledgeBase: event.knowledgeBase,
            enrichment: event.enrichment,
          });
        } else if (event.kind === "failed") {
          settled = true;
          setPhase({ status: "failed", url, message: event.message, hint: event.hint });
        } else {
          setProgress((current) => progressReducer(current, event));
        }
      }

      if (!settled) {
        setPhase({
          status: "failed",
          url,
          message: "The connection dropped before the scrape finished.",
          hint: "Try again — a partial run costs the site nothing.",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return; // The user pressed Stop.
      setPhase({
        status: "failed",
        url,
        message:
          error instanceof Error && error.message
            ? `We couldn't reach the scraper: ${error.message}`
            : "We couldn't reach the scraper.",
        hint: "Check that the app is still running, then try again.",
      });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ status: "idle" });
    setProgress(initialProgress);
  }, []);

  if (phase.status === "running") {
    return (
      <ScrapeProgress url={phase.url} progress={progress} onCancel={cancel} />
    );
  }

  if (phase.status === "done") {
    return (
      <KnowledgeEditor
        knowledgeBase={phase.knowledgeBase}
        enrichment={phase.enrichment}
        onReset={cancel}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {phase.status === "failed" ? (
        <ScrapeFailure
          url={phase.url}
          message={phase.message}
          hint={phase.hint}
          warnings={progress.warnings.length}
        />
      ) : null}
      <Card className="p-4 sm:p-6">
        <UrlForm onSubmit={start} />
      </Card>
    </div>
  );
}

/**
 * A dead site is a normal outcome, not an exception. The message comes from the
 * crawler — every failure mode in docs/DATA-QUALITY.md §7 is written for a
 * non-technical reader where it's detected — and the hint says what to do next.
 */
function ScrapeFailure({
  url,
  message,
  hint,
  warnings,
}: {
  url: string;
  message: string;
  hint: string | null;
  warnings: number;
}) {
  return (
    <Card accent="danger" className="flex items-start gap-3 p-4">
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
      <div>
        <h2 className="text-sm font-semibold text-ink">
          We couldn&apos;t build a knowledge base for {url}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{message}</p>
        {hint ? <p className="mt-1 text-sm text-ink-subtle">{hint}</p> : null}
        {warnings > 1 ? (
          <p className="mt-1 text-xs text-ink-subtle">
            {warnings} problems came up during the crawl.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** The route returns JSON for a rejected request and NDJSON for an accepted one. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `The scraper returned an error (${response.status}).`;
}
