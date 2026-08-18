"use client";

import { AlertTriangle, Check, FileText } from "lucide-react";
import { Badge, Button, Card, Meter } from "@/components/ui";
import {
  pathOf,
  ROLE_LABELS,
  STAGE_LABELS,
  STAGES,
  type ProgressState,
} from "@/lib/knowledge/progress";
import { hostOf } from "@/lib/knowledge/display";
import { cn } from "@/lib/utils/cn";

/**
 * What the wait looks like (R8).
 *
 * A polite crawl is ~1 request per second, so a twenty-page site takes the best
 * part of half a minute — long enough that a spinner reads as a hang. Every line
 * here is a real event off the NDJSON stream: the pages named as they land, the
 * robots.txt result, and warnings as they happen rather than all at the end.
 */
export function ScrapeProgress({
  url,
  progress,
  onCancel,
}: {
  url: string;
  progress: ProgressState;
  onCancel: () => void;
}) {
  const current = progress.stage;

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Reading {hostOf(url)}
          </h2>
          <p
            aria-live="polite"
            className="mt-0.5 text-sm text-ink-muted"
          >
            {current
              ? STAGE_LABELS[current].running
              : "Getting started"}
            …
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Stop
        </Button>
      </div>

      <ol className="mt-4 flex flex-col gap-2">
        {STAGES.map((stage) => {
          const done = progress.completed.includes(stage);
          const running = current === stage;
          return (
            <li
              key={stage}
              className={cn(
                "flex items-center gap-2 text-sm",
                done ? "text-ink-muted" : running ? "text-ink" : "text-ink-subtle",
              )}
            >
              <StageIcon done={done} running={running} />
              {done ? STAGE_LABELS[stage].done : STAGE_LABELS[stage].running}
            </li>
          );
        })}
      </ol>

      {progress.budget > 0 ? (
        <div className="mt-4">
          <Meter
            value={progress.pagesFetched / progress.budget}
            label={`${progress.pagesFetched} of up to ${progress.budget} pages read`}
            compact
          />
          <p className="mt-1.5 text-xs text-ink-subtle">
            {progress.discovered} links found
            {progress.robots
              ? progress.robots.found
                ? " · following the site's robots.txt rules"
                : " · no robots.txt, using our own limits"
              : null}
          </p>
        </div>
      ) : null}

      {progress.pages.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1">
          {progress.pages.map((page) => (
            <li
              key={page.url}
              className="flex items-center gap-2 text-xs text-ink-muted"
            >
              <FileText className="size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <span className="truncate font-mono">{pathOf(page.url)}</span>
              <Badge tone="muted">{ROLE_LABELS[page.role]}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {progress.warnings.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5">
          {progress.warnings.map((warning) => (
            <li
              key={warning.message}
              className="flex items-start gap-2 text-xs text-ink-muted"
            >
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-warn"
                aria-hidden="true"
              />
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function StageIcon({ done, running }: { done: boolean; running: boolean }) {
  if (done) {
    return <Check className="size-4 shrink-0 text-success" aria-hidden="true" />;
  }
  if (running) {
    return (
      <span
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-link border-t-transparent"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full border-2 border-border"
    />
  );
}
