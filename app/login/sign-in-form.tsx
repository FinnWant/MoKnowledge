"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/auth/browser";

/**
 * Sign in and sign up, in one form.
 *
 * Two forms would be two routes, two layouts and one more decision for someone
 * who just wants to get in. The mode is a toggle, and the only thing that
 * changes is which call is made and whether the workspace name is asked for.
 *
 * Signing up creates an organization: `handle_new_user` runs on the new
 * `auth.users` row and makes the account the owner of a fresh tenant, named
 * from `organization_name` here. That is the only thing this form sends beyond
 * credentials, and it is safe to take from the client because it labels a
 * tenant the user is about to own — unlike an organization *id*, which would
 * let anyone join anyone's account (docs/DATABASE.md §4).
 */

type Mode = "sign-in" | "sign-up";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const supabase = supabaseBrowser();
      const result =
        mode === "sign-up"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { data: { organization_name: workspace.trim() || undefined } },
            })
          : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError(friendly(result.error.message));
        return;
      }

      // Email confirmation is off, so a successful sign-up returns a session.
      // If it is ever turned back on, this is where the user would be told to
      // go and check their inbox instead.
      if (!result.data.session) {
        setError("Check your email to confirm the account, then sign in.");
        return;
      }

      // The session lives in a cookie the server has to read, and the pages
      // being navigated to are server-rendered — so the router cache has to be
      // dropped or the first render still thinks nobody is signed in.
      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        label="Password"
        type="password"
        name="password"
        autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        required
        hint={mode === "sign-up" ? "At least 6 characters." : undefined}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {mode === "sign-up" && (
        <Input
          label="Workspace name"
          name="workspace"
          hint="What this account's knowledge bases belong to. You can be the only member."
          placeholder="Acme Marketing"
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" loading={busy}>
        {mode === "sign-up" ? "Create workspace" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        {mode === "sign-up" ? "Already have an account?" : "No account yet?"}{" "}
        <button
          type="button"
          className="text-link underline underline-offset-4 hover:text-ink"
          onClick={() => {
            setMode(mode === "sign-up" ? "sign-in" : "sign-up");
            setError(null);
          }}
        >
          {mode === "sign-up" ? "Sign in" : "Create one"}
        </button>
      </p>
    </form>
  );
}

/**
 * Supabase's messages are accurate and written for developers. These are the
 * two a user actually hits.
 */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match an account.";
  }
  if (/user already registered/i.test(message)) {
    return "There's already an account with that email. Try signing in.";
  }
  return message;
}
