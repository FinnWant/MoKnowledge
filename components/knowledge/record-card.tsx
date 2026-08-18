"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { ProvenanceBadge } from "./provenance-badge";
import { recordNeedsReview, type DisplayRecord } from "@/lib/knowledge/display";

/**
 * One person, offering, testimonial, FAQ… as a card.
 *
 * Every collection in the schema renders through here, fed by a presenter from
 * `lib/knowledge/display.ts`. The alternative — a component per collection —
 * would be fifteen near-identical files, and the sparse-record case (a person
 * with a name and nothing else) would be got wrong in a different way in each.
 */
export function RecordCard({ record }: { record: DisplayRecord }) {
  const attention = recordNeedsReview(record.provenance);

  return (
    <Card accent={attention ? "warn" : "none"} className="overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        {record.imageUrl ? (
          <Thumbnail src={record.imageUrl} alt={record.title} />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold text-ink">{record.title}</h4>
            {record.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </div>

          {record.subtitle ? (
            <p className="mt-0.5 text-sm text-ink-muted">{record.subtitle}</p>
          ) : null}

          {record.body ? (
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-muted">
              {record.body}
            </p>
          ) : null}

          {record.details.length > 0 ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              {record.details.map((detail) => (
                <div key={detail.label} className="contents">
                  <dt className="text-xs text-ink-subtle">{detail.label}</dt>
                  <dd className="text-sm text-ink-muted">{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {record.url ? (
            <a
              href={record.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex items-center gap-1 text-xs text-link hover:text-ink"
            >
              Open
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>

        {record.provenance ? (
          <div className="shrink-0">
            <ProvenanceBadge method={record.provenance.method} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** How many records show before the list asks to be expanded. */
const PREVIEW_COUNT = 5;

export function RecordList({
  records,
  noun,
}: {
  records: DisplayRecord[];
  /** Plural noun for the expand control: "people", "offerings". */
  noun: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = records.length - PREVIEW_COUNT;
  const visible = expanded ? records : records.slice(0, PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-2">
      {visible.map((record) => (
        <RecordCard key={record.key} record={record} />
      ))}

      {hidden > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show all ${records.length} ${noun}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A remote image from a site we have never seen before, which is exactly the
 * case `next/image` is wrong for: it would need every SMB host allow-listed, and
 * optimizing a logo we only ever show at 40px buys nothing.
 */
function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="size-10 shrink-0 rounded-md border border-border bg-surface-raised object-cover"
    />
  );
}
