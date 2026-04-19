"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type Step = 0 | 1 | 2 | 3;

export function IntakeForm({
  initialData,
  initialStep,
}: {
  initialData: IntakeInput;
  initialStep: Step;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [data, setData] = useState<IntakeInput>(initialData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef({ data, step });
  useEffect(() => {
    latest.current = { data, step };
  }, [data, step]);

  async function persistProgress(next: { data: IntakeInput; step: Step }) {
    try {
      await fetch("/api/intake/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      // Progress save is best-effort; the user can still complete the flow.
    }
  }

  function goTo(next: Step) {
    setStep(next);
    void persistProgress({ data, step: next });
  }

  // Save whatever was typed when the user closes the tab mid-flow.
  useEffect(() => {
    function flush() {
      const { data, step } = latest.current;
      const body = JSON.stringify({ data, step });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/intake/progress",
          new Blob([body], { type: "application/json" }),
        );
      }
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push("/matches");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <ProgressDots step={step} total={4} />

      {step === 0 && (
        <SafetyStep
          name={data.personalInfo.name}
          onNameChange={(name) =>
            setData({ ...data, personalInfo: { ...data.personalInfo, name } })
          }
          value={data.crisis}
          onChange={(crisis) => setData({ ...data, crisis })}
          onNext={() => goTo(1)}
        />
      )}
      {step === 1 && (
        <ProblemsStep
          value={data.problems}
          onChange={(problems) => setData({ ...data, problems })}
          onBack={() => goTo(0)}
          onNext={() => goTo(2)}
        />
      )}
      {step === 2 && (
        <PreferencesStep
          value={data.preferences}
          onChange={(preferences) => setData({ ...data, preferences })}
          onBack={() => goTo(1)}
          onNext={() => goTo(3)}
        />
      )}
      {step === 3 && (
        <ReviewStep
          data={data}
          submitting={submitting}
          error={error}
          onBack={() => goTo(2)}
          onSubmit={submit}
          nextLabel="Show my matches"
          submittingLabel="Finding matches…"
        />
      )}

      {submitting && <MatchingLoader />}
    </div>
  );
}

// Full-screen overlay shown while POST /api/match is in flight. The
// pipeline runs two Featherless calls back-to-back (categorize → rank)
// plus a provider lookup, totalling ~4-7s. Cycling messages give the
// user something to read so the wait doesn't feel dead. The messages are
// decorative — not tied to actual server progress, since the route is
// a single round-trip.
function MatchingLoader() {
  const messages = [
    "Reading what you shared…",
    "Categorizing your concerns…",
    "Looking at therapist profiles…",
    "Ranking the best fits for you…",
    "Almost there…",
  ];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setIdx((i) => Math.min(i + 1, messages.length - 1));
    }, 1500);
    return () => clearInterval(iv);
  }, [messages.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/85 backdrop-blur-sm dark:bg-primary/85">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
        <span className="inline-block h-10 w-10 animate-spin rounded-full border-[3px] border-zinc-200 border-t-accent dark:border-zinc-800 dark:border-t-accent" />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Finding your matches
          </h2>
          <p
            key={idx}
            className="mt-2 animate-pulse text-sm text-zinc-600 dark:text-zinc-400"
          >
            {messages[idx]}
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          A therapist reviews anything AI writes — this ranking is a starting
          point.
        </p>
      </div>
    </div>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-10 flex gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < step
              ? "bg-primary dark:bg-zinc-400"
              : i === step
                ? "bg-accent"
                : "bg-zinc-200 dark:bg-zinc-800"
          }`}
        />
      ))}
    </div>
  );
}

function StepShell({
  title,
  description,
  children,
  back,
  next,
  nextLabel = "Continue",
  nextDisabled,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  back?: () => void;
  next?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="text-zinc-600 dark:text-zinc-400">{description}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
      <div className="flex justify-between pt-4">
        {back ? (
          <button
            type="button"
            onClick={back}
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button
            type="button"
            onClick={next}
            disabled={nextDisabled}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
          >
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function SafetyStep({
  name,
  onNameChange,
  value,
  onChange,
  onNext,
}: {
  name: string;
  onNameChange: (v: string) => void;
  value: IntakeInput["crisis"];
  onChange: (v: IntakeInput["crisis"]) => void;
  onNext: () => void;
}) {
  const nameOk = name.trim().length >= 2;
  const safetyAnswered = typeof value.imminentHarm === "boolean";
  return (
    <StepShell
      title="A quick safety check"
      description="Before we go further, we want to make sure you get the right kind of help right now."
      next={onNext}
      nextDisabled={!nameOk || !safetyAnswered}
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">Your name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="What should your therapist call you?"
          autoComplete="given-name"
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary"
        />
        <span className="block text-xs text-zinc-500">
          We&apos;ll show this to your therapist when you join a video call.
        </span>
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Are you having thoughts of harming yourself or someone else, or are
          you in immediate danger?
        </legend>
        <RadioCard
          name="imminent"
          checked={value.imminentHarm === true}
          onChange={() => onChange({ ...value, imminentHarm: true })}
          label="Yes, or I'm not sure"
          sublabel="We'll point you to crisis resources."
        />
        <RadioCard
          name="imminent"
          checked={value.imminentHarm === false}
          onChange={() => onChange({ ...value, imminentHarm: false })}
          label="No"
          sublabel="Let's find you a therapist."
        />
      </fieldset>
    </StepShell>
  );
}

function ProblemsStep({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: IntakeInput["problems"];
  onChange: (v: IntakeInput["problems"]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const tooShort = value.description.trim().length < 10;
  return (
    <StepShell
      title="What brings you in?"
      description="There are no wrong answers. This helps us match you."
      back={onBack}
      next={onNext}
      nextDisabled={tooShort}
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">In your own words</span>
        <textarea
          rows={5}
          value={value.description}
          onChange={(e) =>
            onChange({ ...value, description: e.target.value })
          }
          placeholder="For example: I've been feeling overwhelmed at work, having trouble sleeping, and I notice I'm getting angry at small things."
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
        />
      </label>
      <div className="space-y-2">
        <span className="text-sm font-medium">
          Any of these apply? (optional)
        </span>
        <div className="flex flex-wrap gap-2">
          {PROBLEM_TAGS.map((tag) => {
            const active = value.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    tags: active
                      ? value.tags.filter((t) => t !== tag)
                      : [...value.tags, tag],
                  })
                }
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-white dark:bg-accent dark:text-primary"
                    : "border border-zinc-300 text-zinc-700 hover:border-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
    </StepShell>
  );
}

function PreferencesStep({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: IntakeInput["preferences"];
  onChange: (v: IntakeInput["preferences"]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <StepShell
      title="Your preferences"
      description="Tell us what you'd like in a therapist. You can change these later."
      back={onBack}
      next={onNext}
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Therapist&apos;s gender</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { v: "no-preference", l: "No preference" },
              { v: "female", l: "Female" },
              { v: "male", l: "Male" },
              { v: "nonbinary", l: "Nonbinary" },
            ] as const
          ).map((opt) => (
            <ChipRadio
              key={opt.v}
              checked={value.therapistGender === opt.v}
              onChange={() =>
                onChange({ ...value, therapistGender: opt.v })
              }
              label={opt.l}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Session format</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: "video", l: "Video" },
              { v: "audio", l: "Audio" },
              { v: "either", l: "Either" },
            ] as const
          ).map((opt) => (
            <ChipRadio
              key={opt.v}
              checked={value.format === opt.v}
              onChange={() => onChange({ ...value, format: opt.v })}
              label={opt.l}
            />
          ))}
        </div>
      </fieldset>
    </StepShell>
  );
}

function ReviewStep({
  data,
  submitting,
  error,
  onBack,
  onSubmit,
  nextLabel,
  submittingLabel,
}: {
  data: IntakeInput;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
  nextLabel: string;
  submittingLabel: string;
}) {
  return (
    <StepShell
      title="Ready to see your matches?"
      description="We'll use AI to rank therapists — a therapist reviews anything the AI writes before you see it."
      back={onBack}
      next={submitting ? undefined : onSubmit}
      nextLabel={submitting ? submittingLabel : nextLabel}
      nextDisabled={submitting}
    >
      <Summary
        label="In your words"
        value={data.problems.description || "—"}
      />
      {data.problems.tags.length > 0 && (
        <Summary label="Tags" value={data.problems.tags.join(", ")} />
      )}
      <Summary
        label="Preferences"
        value={`${labelGender(data.preferences.therapistGender)} · ${data.preferences.format}`}
      />
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </StepShell>
  );
}

function labelGender(g: IntakeInput["preferences"]["therapistGender"]): string {
  if (g === "no-preference") return "No gender preference";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}

function RadioCard({
  name,
  checked,
  onChange,
  label,
  sublabel,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
        checked
          ? "border-primary bg-zinc-50 dark:border-accent dark:bg-zinc-900"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-primary dark:accent-accent"
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        {sublabel && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {sublabel}
          </div>
        )}
      </div>
    </label>
  );
}

function ChipRadio({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        checked
          ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
          : "border-zinc-300 text-zinc-700 hover:border-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent"
      }`}
    >
      {label}
    </button>
  );
}
