"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntakeInput } from "@/lib/types";

const PROBLEM_TAGS = [
  "anxiety",
  "depression",
  "work-stress",
  "trauma",
  "ptsd",
  "grief",
  "relationships",
  "identity",
  "lgbtq",
  "adhd",
  "ocd",
  "eating-disorders",
  "addiction",
  "postpartum",
  "life-transitions",
];

type Props = {
  initialData: IntakeInput;
  currentProviderName: string | null;
};

export function SettingsForm({
  initialData,
  currentProviderName,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState<IntakeInput>(initialData);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savedAt, setSavedAt] = useState<"prefs" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: string) {
    const active = data.problems.tags.includes(tag);
    setData({
      ...data,
      problems: {
        ...data.problems,
        tags: active
          ? data.problems.tags.filter((t) => t !== tag)
          : [...data.problems.tags, tag],
      },
    });
  }

  async function savePreferences() {
    if (data.personalInfo.name.trim().length < 2) {
      setError("Please enter a display name.");
      return;
    }
    if (data.problems.description.trim().length < 10) {
      setError("Tell us a bit more about what's going on (10+ characters).");
      return;
    }
    setError(null);
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/intake/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data, step: 3 }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't save.");
        return;
      }
      setSavedAt("prefs");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <Section
        title="Your therapist"
        description="Auto-set when you book a session. Switch by picking from your ranked matches."
      >
        {currentProviderName ? (
          <p className="text-sm">
            Currently working with{" "}
            <span className="font-semibold">{currentProviderName}</span>.
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No current therapist selected.
          </p>
        )}

        <Link
          href="/matches"
          className="mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
        >
          {currentProviderName ? "Switch therapist" : "Find a therapist"}
        </Link>
      </Section>

      <Section
        title="Your name"
        description="Shown to your therapist when you join a video call."
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Display name</span>
          <input
            type="text"
            value={data.personalInfo.name}
            onChange={(e) =>
              setData({
                ...data,
                personalInfo: { ...data.personalInfo, name: e.target.value },
              })
            }
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-primary"
          />
        </label>
      </Section>

      <Section
        title="What's going on"
        description="Free-text plus tags. Used to rank therapists for you."
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">In your own words</span>
          <textarea
            rows={4}
            value={data.problems.description}
            onChange={(e) =>
              setData({
                ...data,
                problems: { ...data.problems, description: e.target.value },
              })
            }
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-primary"
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {PROBLEM_TAGS.map((tag) => {
            const active = data.problems.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  active
                    ? "bg-primary text-white dark:bg-accent dark:text-primary"
                    : "border border-zinc-300 text-zinc-700 hover:border-primary dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Preferences"
        description="Treated as soft signals — mismatches lower a therapist's score, they're not excluded."
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Therapist&apos;s gender</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["no-preference", "No preference"],
                ["female", "Female"],
                ["male", "Male"],
                ["nonbinary", "Nonbinary"],
              ] as const
            ).map(([v, l]) => (
              <Chip
                key={v}
                checked={data.preferences.therapistGender === v}
                onClick={() =>
                  setData({
                    ...data,
                    preferences: { ...data.preferences, therapistGender: v },
                  })
                }
                label={l}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium">Session format</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["video", "Video"],
                ["audio", "Audio"],
                ["either", "Either"],
              ] as const
            ).map(([v, l]) => (
              <Chip
                key={v}
                checked={data.preferences.format === v}
                onClick={() =>
                  setData({
                    ...data,
                    preferences: { ...data.preferences, format: v },
                  })
                }
                label={l}
              />
            ))}
          </div>
        </fieldset>
      </Section>

      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          {savedAt === "prefs" && !savingPrefs && (
            <span className="text-emerald-700 dark:text-emerald-400">
              Preferences saved.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={savePreferences}
          disabled={savingPrefs}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {savingPrefs ? "Saving…" : "Save preferences"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {description}
      </p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Chip({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
        checked
          ? "bg-primary text-white dark:bg-accent dark:text-primary"
          : "border border-zinc-300 text-zinc-700 hover:border-primary dark:border-zinc-700 dark:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
