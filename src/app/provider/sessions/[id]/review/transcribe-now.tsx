"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Auto-poller for the post-call transcription pipeline. Daily.co encodes
// recordings asynchronously (~30s-2min after the call ends), so the first
// call to /transcribe right after end usually 503s with "not ready yet."
// This component fires that POST on mount and re-fires every 10s until it
// succeeds OR the user backs off. No click required.

const POLL_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 30; // ~5 minutes total

export function TranscribeNowButton({
  appointmentId,
}: {
  appointmentId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "polling"; attempts: number; message: string }
    | { kind: "stopped"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function tryOnce(): Promise<boolean> {
      attempts += 1;
      try {
        const res = await fetch(`/api/sessions/${appointmentId}/transcribe`, {
          method: "POST",
        });
        if (cancelled) return true;
        if (res.ok) {
          router.refresh();
          return true;
        }
        const json = await res.json().catch(() => ({}));
        // 503 = recording not ready yet — keep polling. Anything else =
        // hard error, surface and stop.
        if (res.status === 503) {
          setStatus({
            kind: "polling",
            attempts,
            message: json.error ?? "Recording not ready yet…",
          });
          return false;
        }
        setStatus({
          kind: "error",
          message: json.error ?? `Transcription failed (${res.status}).`,
        });
        return true;
      } catch {
        setStatus({
          kind: "error",
          message: "Network error reaching transcription service.",
        });
        return true;
      }
    }

    (async () => {
      while (!cancelled && !stoppedRef.current && attempts < MAX_ATTEMPTS) {
        const done = await tryOnce();
        if (done) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled && attempts >= MAX_ATTEMPTS) {
        setStatus({
          kind: "stopped",
          message:
            "Still no recording from Daily after a few minutes. Refresh this page to retry.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId, router]);

  return (
    <div className="mt-5 space-y-2">
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        {status.kind === "polling" || status.kind === "idle" ? (
          <>
            <Spinner />
            <span className="text-zinc-700 dark:text-zinc-300">
              Waiting on Daily to finish encoding the recording…
            </span>
          </>
        ) : status.kind === "stopped" ? (
          <span className="text-zinc-700 dark:text-zinc-300">
            {status.message}
          </span>
        ) : (
          <span className="text-amber-800 dark:text-amber-200">
            {status.message}
          </span>
        )}
      </div>
      {status.kind === "polling" && (
        <p className="text-xs text-zinc-500">
          Attempt {status.attempts} of {MAX_ATTEMPTS}. This page will update
          automatically once the transcript is ready.
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
  );
}
