"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Status =
  | { kind: "pending" }
  | { kind: "ready"; appointmentId: string }
  | { kind: "error"; message: string };

const MAX_POLLS = 15;
const POLL_INTERVAL_MS = 2000;

export function BookingSuccessClient() {
  const params = useSearchParams();
  const pendingId = params.get("pending");
  const [status, setStatus] = useState<Status>({ kind: "pending" });

  useEffect(() => {
    if (!pendingId) return;

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      attempts++;
      try {
        const res = await fetch(
          `/api/book/status?pending=${encodeURIComponent(pendingId!)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStatus({
            kind: "error",
            message: json.error ?? "Couldn't verify payment.",
          });
          return;
        }
        if (json.ready) {
          setStatus({ kind: "ready", appointmentId: json.appointmentId });
          return;
        }
        if (attempts >= MAX_POLLS) {
          setStatus({
            kind: "error",
            message:
              "Payment is still processing. Refresh in a minute — if it doesn't appear, contact support.",
          });
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          setStatus({ kind: "error", message: "Network error." });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [pendingId]);

  if (!pendingId) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Booking reference missing
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          We couldn&apos;t find the pending booking in the URL.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
        >
          Go to dashboard
        </Link>
      </>
    );
  }

  if (status.kind === "ready") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Payment received — session booked
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A confirmation email is on its way. You can join the session from
          your dashboard at the scheduled time.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
        >
          Open dashboard
        </Link>
      </>
    );
  }

  if (status.kind === "error") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Still waiting on confirmation
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {status.message}
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Go to dashboard
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Confirming your payment…
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Stripe just notified us. We&apos;re finalizing your appointment — this
        usually takes a second or two.
      </p>
    </>
  );
}
