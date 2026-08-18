"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  createDraft,
  draftReducer,
  draftStorageKey,
  restoreDraft,
  serializeDraft,
  type DraftAction,
  type DraftState,
} from "@/lib/knowledge/draft";
import type { KnowledgeBase } from "@/lib/schema";

/**
 * Draft state for the review page (R4).
 *
 * Two contexts, not one. React re-renders every consumer of a context whose
 * value changes, and Bee Cave's draft holds thirty people and eighteen
 * offerings — a component that only ever dispatches must not re-render because
 * a character was typed somewhere else (docs/EDIT-UX.md §3).
 */

const StateContext = createContext<DraftState | null>(null);
const DispatchContext = createContext<Dispatch<DraftAction> | null>(null);
const AutosaveKeyContext = createContext<string | null>(null);

export function KnowledgeDraftProvider({
  knowledgeBase,
  autosaveKey,
  children,
}: {
  knowledgeBase: KnowledgeBase;
  /**
   * Overrides the default per-URL key. The library edits a *saved* record, which
   * has an identity of its own — keying that draft by URL would let a half-
   * finished review of a fresh scrape reappear on top of the saved version of
   * the same site.
   */
  autosaveKey?: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(draftReducer, knowledgeBase, createDraft);
  const key = autosaveKey ?? draftStorageKey(knowledgeBase.sourceUrl);

  useAutosave(state, dispatch, key);
  useUnsavedGuard(state);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <AutosaveKeyContext.Provider value={key}>
          {children}
        </AutosaveKeyContext.Provider>
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

/** Key for a saved record's draft, so it never collides with a fresh scrape. */
export function savedDraftKey(id: string): string {
  return `moknowledge:saved:${id}`;
}

export function useDraft(): DraftState {
  const state = useContext(StateContext);
  if (!state) throw new Error("useDraft must be used inside a KnowledgeDraftProvider");
  return state;
}

export function useDraftDispatch(): Dispatch<DraftAction> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) {
    throw new Error("useDraftDispatch must be used inside a KnowledgeDraftProvider");
  }
  return dispatch;
}

/** The current knowledge base. Memo-friendly: the identity changes only on edit. */
export function useDraftKnowledgeBase(): KnowledgeBase {
  return useDraft().draft;
}

/**
 * A named slice, so a component re-renders only when its own field changes.
 * Structural sharing in `setPath` is what makes the identity check meaningful.
 */
export function useDraftSelector<T>(select: (state: DraftState) => T): T {
  const state = useDraft();
  return useMemo(() => select(state), [select, state]);
}

/* --------------------------------------------------------------- autosave */

/**
 * Autosave to `localStorage`, keyed by the scraped URL (docs/EDIT-UX.md §8).
 *
 * A scrape takes half a minute of somebody else's bandwidth; losing the review
 * on top of it to a stray refresh would be the worst moment in the product.
 */
function useAutosave(
  state: DraftState,
  dispatch: Dispatch<DraftAction>,
  key: string,
): void {
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const raw = window.localStorage.getItem(key);
    if (!raw) return;

    const saved = restoreDraft(raw);
    // Only worth restoring if it holds work: a pristine autosave of the same
    // scrape would just be the state we already have.
    if (saved && (saved.dirty.size > 0 || saved.reviewed.size > 0)) {
      dispatch({ type: "RESTORE", state: saved });
    }
  }, [key, dispatch]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(key, serializeDraft(state));
    } catch {
      // A full or disabled localStorage must not break the editor. The explicit
      // Save button is the durable path; this is only a safety net.
    }
  }, [key, state]);
}

/* ---------------------------------------------------------------- guard */

/**
 * Two guards, because there are two ways to lose the work.
 *
 * `beforeunload` covers closing the tab and reloading. The App Router has no
 * route-change hook to hang the second one on, so an in-app navigation is caught
 * where it starts: a capturing click listener on links that leave the page.
 * Jump links inside the page and new-tab clicks are left alone — a guard that
 * fires on the completeness rail would be worse than no guard.
 */
function useUnsavedGuard(state: DraftState): void {
  const edits = state.dirty.size;

  useEffect(() => {
    if (state.saved) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.saved]);

  useEffect(() => {
    if (state.saved || edits === 0) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      const leave = window.confirm(
        `You have ${edits} unsaved ${edits === 1 ? "change" : "changes"}. Leave this page and lose them?`,
      );
      if (!leave) event.preventDefault();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [state.saved, edits]);
}

/** Clears the autosaved draft once its work is safely in the store. */
export function clearAutosave(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do — the draft is saved either way.
  }
}

/**
 * Clears whichever draft this provider is holding. The save bar shouldn't have
 * to know whether it is inside a fresh scrape or a saved record being edited.
 */
export function useClearAutosave(): () => void {
  const key = useContext(AutosaveKeyContext);
  return () => {
    if (key) clearAutosave(key);
  };
}
