"use client";

import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import { websiteInputSchema } from "@/lib/schema";

/** Real sites from the validation set, so the page is demonstrable in one click. */
const EXAMPLES = ["beecavedrilling.com", "account-it.net", "moflo.ai"];

/**
 * The entry point: a URL in, a scrape out (R1, R9).
 *
 * Validation uses `websiteInputSchema` — the same zod schema the API route runs
 * on the server — so the client and the server can never disagree about what a
 * usable address is, and the wording of the error only exists in one place.
 */
export function UrlForm({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (url: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = websiteInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That address doesn't look right.");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Input
            label="Company website"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="beecavedrilling.com"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            error={error ?? undefined}
            hint="We read up to 20 pages, following the site's own robots.txt rules."
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={disabled}
          iconLeft={<Search className="size-4" aria-hidden="true" />}
          className="sm:mt-7"
        >
          Build knowledge base
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span>Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={disabled}
            onClick={() => {
              setValue(example);
              setError(null);
            }}
            className="rounded-md border border-border px-2 py-1 font-mono text-ink-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}
