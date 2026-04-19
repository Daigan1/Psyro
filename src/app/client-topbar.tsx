// Client-side top navigation. Server component so it can read the session
// cookie + the user's currentProviderId without a client-side fetch round
// trip. Renders nothing for unauthenticated visitors and for providers (who
// have their own layout under /provider).

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUser } from "@/lib/users-store";
import { getProvider } from "@/lib/providers-store";
import { SignOutButton } from "./sign-out-button";

export async function ClientTopBar() {
  const session = await getCurrentUser();
  if (!session || session.role !== "client" || !session.clientId) return null;

  const record = await getUser(session.clientId);
  const currentProviderId =
    record && record.role === "client" ? record.currentProviderId ?? null : null;
  const currentProvider = currentProviderId
    ? await getProvider(currentProviderId)
    : null;

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-primary">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold"
        >
          <img src="/logo.png" width={45} height={45}/>
          Psyro
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          {currentProvider ? (
            <Link
              href="/matches"
              title="Switch therapist"
              className="hidden items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-700 hover:border-primary sm:inline-flex dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="font-medium">{currentProvider.name}</span>
              <span className="text-zinc-500">Switch</span>
            </Link>
          ) : (
            <Link
              href="/matches"
              className="hidden rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-primary sm:inline-block dark:text-zinc-50"
            >
              Find a therapist
            </Link>
          )}
          <Link
            href="/dashboard"
            className="text-zinc-600 hover:text-primary dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Dashboard
          </Link>
          <Link
            href="/settings"
            className="text-zinc-600 hover:text-primary dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Settings
          </Link>
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
