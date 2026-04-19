"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AvailabilitySlot } from "@/lib/types";

type Props = {
  appointmentId: string;
  providerId: string;
};

type Phase =
  | { kind: "idle" }
  | { kind: "confirming-cancel" }
  | { kind: "rescheduling"; slots: AvailabilitySlot[]; selected: string | null };

export function AppointmentActions({ appointmentId, providerId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't cancel.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function openReschedule() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/availability/${providerId}`);
      if (!res.ok) {
        setError("Couldn't load availability.");
        return;
      }
      const json = await res.json();
      setPhase({ kind: "rescheduling", slots: json.slots, selected: null });
    } finally {
      setBusy(false);
    }
  }

  async function confirmReschedule(startTime: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startTime }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't reschedule.");
        return;
      }
      setPhase({ kind: "idle" });
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === "rescheduling") {
    return (
      <div className="mt-4 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Pick a new time</h4>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="text-xs text-zinc-500 hover:underline"
          >
            Cancel
          </button>
        </div>
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          {phase.slots.map((s) => (
            <button
              key={s.startTime}
              type="button"
              onClick={() => confirmReschedule(s.startTime)}
              disabled={busy}
              className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:border-primary disabled:opacity-40 dark:border-zinc-800 dark:hover:border-accent"
            >
              {formatSlot(s.startTime)}
            </button>
          ))}
        </div>
        {error && (
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  if (phase.kind === "confirming-cancel") {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        <span className="flex-1 text-zinc-700 dark:text-zinc-300">
          Cancel this session? We&apos;ll let your therapist know.
        </span>
        <button
          type="button"
          onClick={() => setPhase({ kind: "idle" })}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? "Cancelling…" : "Yes, cancel"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3 text-xs">
      <button
        type="button"
        onClick={openReschedule}
        disabled={busy}
        className="text-zinc-600 hover:text-primary disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Reschedule
      </button>
      <button
        type="button"
        onClick={() => setPhase({ kind: "confirming-cancel" })}
        className="text-red-700 hover:underline dark:text-red-400"
      >
        Cancel
      </button>
      {error && (
        <span className="text-red-700 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
