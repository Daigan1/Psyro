"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AvailabilitySlot, SessionFormat } from "@/lib/types";

type Props = {
  providerId: string;
  availableFormats: Exclude<SessionFormat, "either">[];
  slots: AvailabilitySlot[];
  ratePerSessionCents: number;
};

export function BookingForm({
  providerId,
  availableFormats,
  slots,
  ratePerSessionCents,
}: Props) {
  const [format, setFormat] = useState<Exclude<SessionFormat, "either">>(
    availableFormats[0] ?? "video",
  );
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupByDay(slots), [slots]);
  const priceLabel = (ratePerSessionCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  async function confirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId,
          startTime: selectedSlot,
          format,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.checkoutUrl) {
        setError(json.error ?? "Couldn't start checkout.");
        setSubmitting(false);
        return;
      }
      // Hand off to Stripe Checkout. Payment success → /booking/success.
      window.location.assign(json.checkoutUrl);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (slots.length === 0) {
    return (
      <div className="mt-8 space-y-4">
        <p className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No openings in the next two weeks. Check back soon.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-10 space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Session format</h2>
        <div className="flex gap-2">
          {availableFormats.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                format === f
                  ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
                  : "border-zinc-300 text-zinc-700 hover:border-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Pick a time</h2>
        <div className="space-y-6">
          {grouped.map(({ day, slots }) => (
            <div key={day}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {day}
              </div>
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => {
                  const selected = selectedSlot === slot.startTime;
                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      onClick={() => setSelectedSlot(slot.startTime)}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
                          : "border-zinc-200 hover:border-primary dark:border-zinc-800 dark:hover:border-accent"
                      }`}
                    >
                      {formatTime(slot.startTime)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="space-y-0.5 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">
            {selectedSlot
              ? `${formatDay(selectedSlot)} at ${formatTime(selectedSlot)} · ${format}`
              : "Select a time to continue"}
          </p>
          <p className="text-xs text-zinc-500">
            {priceLabel} charged via Stripe at checkout.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            aria-disabled={submitting}
            className={`rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700 ${
              submitting
                ? "pointer-events-none opacity-40"
                : "text-zinc-700 hover:border-zinc-400 dark:text-zinc-300"
            }`}
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={confirm}
            disabled={!selectedSlot || submitting}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
          >
            {submitting ? "Redirecting…" : `Pay ${priceLabel} & book`}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupByDay(
  slots: AvailabilitySlot[],
): { day: string; slots: AvailabilitySlot[] }[] {
  const map = new Map<string, AvailabilitySlot[]>();
  for (const s of slots) {
    const day = formatDay(s.startTime);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(s);
  }
  return Array.from(map.entries()).map(([day, slots]) => ({ day, slots }));
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
