"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Therapist } from "@/lib/types";

type Format = Exclude<Therapist["sessionFormats"][number], never>;

const GENDERS: Therapist["gender"][] = ["female", "male", "nonbinary"];
const FORMATS: Format[] = ["video", "audio"];

export function OnboardingForm({ provider }: { provider: Therapist }) {
  const router = useRouter();
  const [name, setName] = useState(provider.name);
  const [pronouns, setPronouns] = useState(provider.pronouns);
  const [gender, setGender] = useState<Therapist["gender"]>(provider.gender);
  const [bio, setBio] = useState(provider.bio);
  const [specialties, setSpecialties] = useState(
    provider.specialties.join(", "),
  );
  const [modalities, setModalities] = useState(provider.modalities.join(", "));
  const [rateDollars, setRateDollars] = useState(
    (provider.ratePerSessionCents / 100).toString(),
  );
  const [formats, setFormats] = useState<Format[]>(provider.sessionFormats);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggleFormat(f: Format) {
    setFormats(
      formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f],
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rateCents = parseRateCents(rateDollars);
    if (rateCents === null) {
      setMsg({
        kind: "err",
        text: "Enter a rate between $1 and $1,000 (whole dollars).",
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/provider/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          pronouns,
          gender,
          bio,
          specialties: splitList(specialties),
          modalities: splitList(modalities),
          sessionFormats: formats,
          ratePerSessionCents: rateCents,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: json.error ?? "Couldn't save." });
        return;
      }
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-10 space-y-6">
      <Grid>
        <Field label="Display name" value={name} onChange={setName} required />
        <Field
          label="Pronouns"
          value={pronouns}
          onChange={setPronouns}
          placeholder="e.g. she/her"
        />
      </Grid>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Gender (for client preferences)</legend>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <ChipButton
              key={g}
              active={gender === g}
              onClick={() => setGender(g)}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </ChipButton>
          ))}
        </div>
      </fieldset>

      <TextareaField
        label="Bio"
        value={bio}
        onChange={setBio}
        rows={4}
        placeholder="Two or three sentences about how you work and who you typically help."
      />

      <Field
        label="Specialties (comma separated)"
        value={specialties}
        onChange={setSpecialties}
        placeholder="anxiety, depression, work-stress"
        help="Used by the matcher. Short, lowercase tags work best."
      />
      <Field
        label="Modalities"
        value={modalities}
        onChange={setModalities}
        placeholder="CBT, ACT, EMDR"
      />
      <Field
        label="Self-pay rate (USD per 50-minute session)"
        value={rateDollars}
        onChange={setRateDollars}
        placeholder="150"
        help="Clients pay this up front via Stripe when they book. Whole dollars only."
      />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Session formats you offer</legend>
        <div className="flex gap-2">
          {FORMATS.map((f) => (
            <ChipButton
              key={f}
              active={formats.includes(f)}
              onClick={() => toggleFormat(f)}
            >
              {f}
            </ChipButton>
          ))}
        </div>
      </fieldset>

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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseRateCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  if (dollars < 1 || dollars > 1000) return null;
  return dollars * 100;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  help,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
      />
      {help && <span className="block text-xs text-zinc-500">{help}</span>}
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
      />
    </label>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
