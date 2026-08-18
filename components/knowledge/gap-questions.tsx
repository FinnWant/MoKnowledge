"use client";

import { Check, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { FieldEditor } from "./editors/field-editor";
import { useDraft, useDraftDispatch } from "@/context/knowledge-draft";
import { fieldMeta, type FollowUpQuestion, type Sourced } from "@/lib/schema";
import { getPath } from "@/lib/utils/path";

/**
 * The gaps, as questions (docs/EDIT-UX.md §7).
 *
 * "We couldn't find your founding year — what year did you start?" is a question
 * a business owner can answer in four seconds. An empty input labelled
 * `yearFounded` is not, and the difference is the whole "do as much for them as
 * possible" instruction in the brief.
 *
 * Capped at six by the scorer: a longer list is a form.
 */
export function GapQuestions() {
  const state = useDraft();
  const questions = state.draft.quality.followUpQuestions;

  if (questions.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        <p className="text-sm text-ink-muted">
          Nothing important is missing. Everything we&apos;d have asked about is
          already filled in.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MessageCircleQuestion className="size-4 text-link" aria-hidden="true" />
          A few things your website doesn&apos;t say
        </h2>
        <Badge tone="neutral">{questions.length} questions</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Answering these does more for the result than anything else on this page.
        Skip any you&apos;d rather not.
      </p>

      <ol className="mt-3 flex flex-col gap-2">
        {questions.map((question) => (
          <QuestionRow key={question.id} question={question} />
        ))}
      </ol>
    </Card>
  );
}

function QuestionRow({ question }: { question: FollowUpQuestion }) {
  const state = useDraft();
  const dispatch = useDraftDispatch();
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-surface-raised px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <span className="block text-sm text-ink">{question.question}</span>
        {question.example ? (
          <span className="mt-0.5 block text-xs text-ink-subtle">
            For example: {question.example}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {question.fills.map((path) => {
            const meta = fieldMeta(path);
            const field = getPath(state.draft, path) as Sourced<unknown> | undefined;
            if (!meta || !field) return null;

            return (
              <FieldEditor
                key={path}
                meta={meta}
                field={field}
                onCommit={(value) => {
                  // Routed through ANSWER_QUESTION rather than SET_FIELD so the
                  // answer is recorded as one act even when a grouped question
                  // fills three fields at once.
                  dispatch({ type: "ANSWER_QUESTION", id: question.id, answers: { [path]: value } });
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
