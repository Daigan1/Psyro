"use client";

import { useMemo, useState } from "react";
import type { WeeklyAvailability } from "@/lib/types";

const DAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00 – 20:00 UTC

type Schedule = { [dow: number]: Set<number> };

function toSchedule(input: WeeklyAvailability): Schedule {
  const out: Schedule = {};
  for (const [day, hours] of Object.entries(input)) {
    out[Number(day)] = new Set(hours);
  }
  return out;
}

function toPayload(schedule: Schedule): WeeklyAvailability {
  const out: WeeklyAvailability = {};
  for (const [day, hours] of Object.entries(schedule)) {
    if (hours.size > 0) {
      out[Number(day)] = Array.from(hours).sort((a, b) => a - b);
    }
  }
  return out;
}

export function AvailabilityCalendar({
  initial,
}: {
  initial: WeeklyAvailability;
}) {
  const [schedule, setSchedule] = useState<Schedule>(() => toSchedule(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const total = useMemo(
    () =>
      Object.values(schedule).reduce((sum, hours) => sum + hours.size, 0),
    [schedule],
  );

  function toggle(dow: number, hour: number) {
    setSchedule((prev) => {
      const next: Schedule = {};
      for (const [day, hours] of Object.entries(prev)) {
        next[Number(day)] = new Set(hours);
      }
      const set = next[dow] ?? new Set<number>();
      if (set.has(hour)) set.delete(hour);
      else set.add(hour);
      next[dow] = set;
      return next;
    });
    setMsg(null);
  }

  function clearAll() {
    setSchedule({});
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/provider/availability", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weeklyAvailability: toPayload(schedule) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: json.error ?? "Couldn't save." });
        return;
      }
      setMsg({ kind: "ok", text: "Availability saved." });
    } catch {
      setMsg({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `72px repeat(${DAYS.length}, minmax(72px, 1fr))` }}
        >
          <div />
          {DAYS.map((d) => (
            <div
              key={d.dow}
              className="pb-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              {d.label}
            </div>
          ))}
          {HOURS.map((hour) => (
            <HourRow
              key={hour}
              hour={hour}
              schedule={schedule}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>

      {msg && (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {total} hour{total === 1 ? "" : "s"} selected per week
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={busy || total === 0}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HourRow({
  hour,
  schedule,
  onToggle,
}: {
  hour: number;
  schedule: Schedule;
  onToggle: (dow: number, hour: number) => void;
}) {
  const label = `${hour.toString().padStart(2, "0")}:00`;
  return (
    <>
      <div className="flex items-center justify-end pr-2 font-mono text-xs text-zinc-500">
        {label}
      </div>
      {DAYS.map((d) => {
        const on = schedule[d.dow]?.has(hour) ?? false;
        return (
          <button
            key={`${d.dow}-${hour}`}
            type="button"
            onClick={() => onToggle(d.dow, hour)}
            aria-pressed={on}
            aria-label={`${d.label} ${label} ${on ? "available" : "unavailable"}`}
            className={`h-10 rounded-lg border text-xs transition-colors ${
              on
                ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            }`}
          />
        );
      })}
    </>
  );
}
