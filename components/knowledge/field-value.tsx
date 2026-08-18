"use client";

import { ExternalLink } from "lucide-react";
import { Chip, ChipList } from "@/components/ui";
import { RecordList } from "./record-card";
import {
  chipValues,
  displayKind,
  formatScalar,
  presentColors,
  presentComposite,
  presentMedia,
  presentRecords,
} from "@/lib/knowledge/display";
import type { FieldMeta, Sourced } from "@/lib/schema";

/**
 * Renders whatever is in a field, in read-only form.
 *
 * The switch is on `displayKind`, not on the field path — that is what keeps the
 * page from growing a component per field as the schema grows (docs/EDIT-UX.md
 * §4 makes the same argument for the editors P5 puts in these slots).
 */
export function FieldValue({
  meta,
  field,
}: {
  meta: FieldMeta;
  field: Sourced<unknown>;
}) {
  const kind = displayKind(meta);
  const value = field.value;

  switch (kind) {
    case "prose":
      return (
        <p className="text-sm leading-relaxed whitespace-pre-line text-ink">
          {String(value)}
        </p>
      );

    case "link": {
      const href = formatScalar(meta, value);
      if (!href) return null;
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-sm text-link hover:text-ink"
        >
          {href.replace(/^https?:\/\//, "")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      );
    }

    case "chips": {
      const values = chipValues(meta.path, value);
      return (
        <ChipList>
          {values.map((entry, index) => (
            <Chip key={`${entry}-${index}`}>{entry}</Chip>
          ))}
        </ChipList>
      );
    }

    case "color":
      return <ColorRow colors={presentColors(value)} />;

    case "media":
      return <MediaRow items={presentMedia(value)} />;

    case "records": {
      const records = presentRecords(meta.path, value);
      if (records.length === 0) return null;
      return <RecordList records={records} noun={meta.label.toLowerCase()} />;
    }

    case "composite": {
      const rows = presentComposite(meta.path, value);
      if (rows.length === 0) return null;
      return (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,12rem)_1fr]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-xs text-ink-subtle">{row.label}</dt>
              <dd className="text-sm text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      );
    }

    default: {
      const text = formatScalar(meta, value);
      return text ? <p className="text-sm text-ink">{text}</p> : null;
    }
  }
}

function ColorRow({
  colors,
}: {
  colors: ReturnType<typeof presentColors>;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {colors.map((color) => (
        <li
          key={color.hex}
          className="flex items-center gap-2 rounded-md border border-border bg-surface-raised py-1 pr-2.5 pl-1"
        >
          <span
            aria-hidden="true"
            className="size-6 rounded border border-border-strong"
            style={{ backgroundColor: color.hex }}
          />
          <span className="text-xs">
            <span className="block font-mono text-ink">{color.hex}</span>
            <span className="block text-ink-subtle">
              {color.role} · {Math.round(color.share * 100)}%
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Logos on a white tile. A brand logo is usually dark artwork on a transparent
 * background, which on a near-black page renders as an empty rectangle.
 */
function MediaRow({ items }: { items: ReturnType<typeof presentMedia> }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col items-center gap-1">
          {/*
            The link carries the name and the image is marked decorative, rather
            than the other way around: a linked image needs one accessible name,
            and putting it on the link is what lets it say where the link goes.

            `alt` was `item.alt ?? "Logo"`, and `??` only replaces null and
            undefined — an extractor that found an `alt=""` yielded an empty
            string, which passed straight through and marked the image
            decorative. The link then had no accessible name at all and a screen
            reader announced a bare "link" (WCAG 2.4.4). Six of them on one
            knowledge base.
          */}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${item.alt?.trim() || "Image"} — opens in a new tab`}
            className="flex h-14 w-28 items-center justify-center rounded-md border border-border bg-white p-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          </a>
          {item.alt ? (
            <span className="max-w-28 truncate text-xs text-ink-subtle">
              {item.alt}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
