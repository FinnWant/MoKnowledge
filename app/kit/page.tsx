"use client";

import { useState } from "react";
import { Plus, Save, SearchX, Trash2 } from "lucide-react";
import {
  Accordion,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  ChipList,
  EmptyState,
  Input,
  Meter,
  Select,
  Skeleton,
  SkeletonField,
  Textarea,
} from "@/components/ui";
import {
  PROVENANCE_METHODS,
  ProvenanceBadge,
} from "@/components/knowledge/provenance-badge";

const SWATCHES = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-raised", "bg-surface-raised"],
  ["border", "bg-border"],
  ["primary", "bg-primary"],
  ["link", "bg-link"],
  ["secondary", "bg-secondary"],
  ["success", "bg-success"],
  ["warn", "bg-warn"],
  ["danger", "bg-danger"],
] as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {note ? <p className="mt-1 text-sm text-ink-subtle">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function KitPage() {
  const [areas, setAreas] = useState([
    "Austin",
    "Bee Cave",
    "Lakeway",
    "Dripping Springs",
  ]);
  const [loading, setLoading] = useState(false);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header>
        <p className="text-xs font-medium tracking-wide text-link uppercase">
          MoKnowledge
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Design system reference
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Every primitive the scrape, review, and library pages are built from,
          on the MoFlo palette. Not part of the product surface — this page
          exists so the kit can be reviewed in isolation.
        </p>
      </header>

      <Section
        title="Palette"
        note="Near-black surfaces, white text, one blue accent. #2663eb measures 3.8:1 on the canvas, so it is only ever used as a fill; blue text uses the lighter --color-link at 7.8:1."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, klass]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div
                className={`h-12 rounded-lg border border-border ${klass}`}
              />
              <span className="text-xs text-ink-subtle">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold text-ink">
            Bee Cave Drilling — semibold 24
          </p>
          <p className="text-base text-ink">Body copy, ink — 16</p>
          <p className="text-sm text-ink-muted">
            Secondary copy, ink-muted — 14
          </p>
          <p className="text-xs text-ink-subtle">
            Captions and provenance detail, ink-subtle — 12
          </p>
          <p className="font-mono text-sm text-ink-muted">
            font-mono · &quot;foundation.yearFounded&quot;: 1980
          </p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" iconLeft={<Save className="size-4" />}>
            Save
          </Button>
          <Button variant="secondary">Preview JSON</Button>
          <Button variant="ghost" iconLeft={<Plus className="size-4" />}>
            Add a person
          </Button>
          <Button variant="danger" iconLeft={<Trash2 className="size-4" />}>
            Remove
          </Button>
          <Button variant="link">Revert</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            Scrape site
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section
        title="Provenance badges"
        note="The whole user-facing vocabulary for where a value came from. AI sample is deliberately louder than AI draft — mock output has to be unmistakable."
      >
        <div className="flex flex-wrap items-center gap-2">
          {PROVENANCE_METHODS.map((method) => (
            <ProvenanceBadge key={method} method={method} />
          ))}
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>14 offerings</Badge>
          <Badge tone="info">Merged from 4 mentions</Badge>
          <Badge tone="success">Ready</Badge>
          <Badge tone="warn">Needs your attention</Badge>
          <Badge tone="danger">2 conflicts</Badge>
          <Badge tone="muted">Not found</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Website"
            placeholder="beecavedrilling.com"
            defaultValue="beecavedrilling.com"
          />
          <Input
            label="Year founded"
            defaultValue="18O0"
            error="That doesn't look like a year (try 1980)"
          />
          <Select label="Type of business" defaultValue="contractor">
            <option value="contractor">Contractor</option>
            <option value="service-provider">Service provider</option>
            <option value="retailer">Retailer</option>
          </Select>
          <Input
            label="Phone"
            defaultValue="512-273-7389"
            hint="Found on the Contact page"
          />
          <Textarea
            className="sm:col-span-2"
            label="What the business does"
            defaultValue="Bee Cave Drilling has drilled and serviced water wells across Central Texas since 1980, handling everything from new well installation to pump repair and water treatment."
            hint="Written by AI from what we found. Please check it."
          />
        </div>
      </Section>

      <Section
        title="Chips"
        note="Used for every list-of-strings field. Paste splits on commas — the reference data has a 13-entry Suppliers list nobody is typing one at a time."
      >
        <ChipList>
          {areas.map((area) => (
            <Chip
              key={area}
              label={area}
              onRemove={() => setAreas(areas.filter((a) => a !== area))}
            >
              {area}
            </Chip>
          ))}
          {areas.length === 0 ? (
            <span className="text-sm text-ink-subtle">
              All removed — reload to reset.
            </span>
          ) : null}
        </ChipList>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader
              title="Ethan"
              meta="Technician"
              actions={<ProvenanceBadge method="scraped" />}
            />
            <CardBody>
              <p className="text-sm text-ink-muted">
                An assigned technician praised by customers for diagnosing pump
                problems quickly.
              </p>
            </CardBody>
            <CardFooter>
              <Button size="sm" variant="link">
                Revert
              </Button>
              <Button size="sm" variant="danger">
                Remove
              </Button>
            </CardFooter>
          </Card>

          <Card raised accent="warn">
            <CardHeader
              title="Year founded"
              meta="Found &ldquo;since 1980&rdquo; on the About page"
              actions={<Badge tone="warn">Not fully sure</Badge>}
            />
            <CardBody>
              <p className="text-xl font-semibold text-ink">1980</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary">
                  Looks right
                </Button>
                <Button size="sm">Edit</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Accordion">
        <div className="flex flex-col gap-3">
          <Accordion
            title="Company foundation"
            summary={
              <>
                <span>15 fields</span>
                <Badge tone="success">Ready</Badge>
              </>
            }
            defaultOpen
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-subtle">Industry</dt>
                <dd className="text-sm text-ink">Water well drilling</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">Areas served</dt>
                <dd className="text-sm text-ink">Central Texas</dd>
              </div>
            </dl>
          </Accordion>
          <Accordion
            title="Proof &amp; credibility"
            summary={<Badge tone="warn">Needs attention</Badge>}
          >
            <p className="text-sm text-ink-muted">
              A Birdeye review widget was detected on /about, but its content
              loads separately and the scraper can&rsquo;t read it.
            </p>
          </Accordion>
        </div>
      </Section>

      <Section
        title="Completeness meter"
        note="The only number shown to the user, because it is impact-weighted and therefore means something. Per-field confidence is never surfaced numerically."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Meter label="Overall" value={0.72} />
          <Meter label="Branding" value={0.45} />
          <Meter label="Proof" value={0.15} />
        </div>
      </Section>

      <Section title="Loading and empty states">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardBody className="flex flex-col gap-4 pt-4">
              <Skeleton className="h-4 w-1/3" />
              <SkeletonField />
              <SkeletonField />
            </CardBody>
          </Card>
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="No knowledge bases yet"
            description="Scrape a company website to build your first one."
            action={<Button variant="primary">Scrape a site</Button>}
          />
        </div>
      </Section>
    </main>
  );
}
