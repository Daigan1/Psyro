import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getIntakeProgress } from "@/lib/intake-store";
import { getUser } from "@/lib/users-store";
import { ClientTopBar } from "@/app/client-topbar";
import type { Match, MatchResult } from "@/lib/types";
import { SelectTherapistButton } from "./select-button";

export default async function MatchesPage() {
  const user = await requireAuth("client", "/matches");
  const [progress, record] = await Promise.all([
    getIntakeProgress(user.clientId!),
    getUser(user.clientId!),
  ]);

  if (!progress?.completed || !progress.matchResult) {
    redirect("/intake");
  }

  const result = progress.matchResult;
  const currentProviderId =
    record && record.role === "client"
      ? record.currentProviderId ?? null
      : null;

  if (result.kind === "crisis") {
    return <CrisisView result={result} />;
  }

  if (result.kind === "no-matches") {
    return (
      <Shell title="No matches yet">
        <p className="text-zinc-600 dark:text-zinc-400">{result.reason}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/settings"
            className="inline-block rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Adjust preferences
          </Link>
          <Link
            href="/dashboard"
            className="inline-block rounded-full px-5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Your matches">
      <p className="text-zinc-600 dark:text-zinc-400">
        Ranked for you based on your profile, demographic, and needs.
      </p>
      <ul className="mt-8 space-y-4">
        {result.matches.map((m) => (
          <TherapistCard
            key={m.therapist.id}
            match={m}
            isCurrent={m.therapist.id === currentProviderId}
          />
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
        <Link
          href="/settings"
          className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Adjust preferences
        </Link>
        <Link
          href="/dashboard"
          className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Go back
        </Link>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <ClientTopBar />
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {title && (
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">
            {title}
          </h1>
        )}
        {children}
      </div>
    </>
  );
}

function TherapistCard({
  match,
  isCurrent,
}: {
  match: Match;
  isCurrent: boolean;
}) {
  const { therapist, score, reasoning, isTopChoice } = match;
  return (
    <li
      className={`rounded-2xl border p-6 ${
        isTopChoice
          ? "border-accent ring-4 ring-accent-soft"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{therapist.name}</h2>
            <span className="text-sm text-zinc-500">{therapist.pronouns}</span>
            {isTopChoice && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">
                Top choice
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {therapist.specialties.slice(0, 4).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">Match</div>
          <div
            className={`text-base font-semibold tabular-nums ${
              isTopChoice ? "text-accent" : ""
            }`}
          >
            {Math.round(score * 100)}%
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {therapist.bio}
      </p>

      <div className="mt-4 rounded-xl border-l-2 border-accent bg-accent-soft p-3 text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-primary dark:text-zinc-50">
          Why this match:
        </span>{" "}
        {reasoning}.
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          <div>
            Next available{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {new Date(therapist.nextAvailable).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div>
            Self-pay{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {formatUsd(therapist.ratePerSessionCents)}
            </span>{" "}
            per 50-minute session
          </div>
        </div>
        <SelectTherapistButton
          therapistId={therapist.id}
          isCurrent={isCurrent}
        />
      </div>
    </li>
  );
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function CrisisView({
  result,
}: {
  result: Extract<MatchResult, { kind: "crisis" }>;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-6 dark:bg-red-950/30">
        <h1 className="text-2xl font-semibold text-red-900 dark:text-red-100">
          Please reach out right now
        </h1>
        <p className="mt-2 text-red-900/80 dark:text-red-100/80">
          {result.message}
        </p>
        <ul className="mt-6 space-y-3">
          {result.hotline.map((h) => (
            <li
              key={h.label}
              className="rounded-xl bg-white p-4 dark:bg-primary"
            >
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {h.label}
              </div>
              <div className="text-lg font-semibold">{h.number}</div>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/dashboard"
        className="mt-8 inline-block text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        Return to dashboard
      </Link>
    </div>
  );
}
