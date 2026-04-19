"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Role = "client" | "provider";

type StartResponse = {
  challengeId: string;
  devCode: string | null;
};

type Phase =
  | { kind: "email" }
  | { kind: "code"; challengeId: string; devCode: string | null };

export function SignInClient({
  initialRole,
  next,
  initialError,
}: {
  initialRole: Role;
  next: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState(hintEmail(initialRole));
  const [phase, setPhase] = useState<Phase>({ kind: "email" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't send code.");
        return;
      }
      const data = json as StartResponse;
      setPhase({
        kind: "code",
        challengeId: data.challengeId,
        devCode: data.devCode,
      });
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: string) {
    if (phase.kind !== "code") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: phase.challengeId, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't verify code.");
        return;
      }
      router.push(next ?? defaultLanding(role));
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <RoleTabs
        current={role}
        onChange={(r) => {
          setRole(r);
          setEmail(hintEmail(r));
          setPhase({ kind: "email" });
          setError(null);
        }}
      />

      {phase.kind === "email" && (
        <EmailStep
          email={email}
          setEmail={setEmail}
          busy={busy}
          onSubmit={start}
          role={role}
        />
      )}

      {phase.kind === "code" && (
        <CodeStep
          email={email}
          devCode={phase.devCode}
          busy={busy}
          onBack={() => setPhase({ kind: "email" })}
          onSubmit={submitCode}
        />
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function RoleTabs({
  current,
  onChange,
}: {
  current: Role;
  onChange: (r: Role) => void;
}) {
  const opts: { id: Role; label: string }[] = [
    { id: "client", label: "Client" },
    { id: "provider", label: "Provider" },
  ];
  return (
    <div className="flex rounded-full border border-zinc-200 p-1 dark:border-zinc-800">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            current === o.id
              ? "bg-primary text-white dark:bg-accent dark:text-primary"
              : "text-zinc-700 hover:text-primary dark:text-zinc-300 dark:hover:text-zinc-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EmailStep({
  email,
  setEmail,
  busy,
  onSubmit,
  role,
}: {
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  role: Role;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
        />
        <DemoHint role={role} />
      </label>
      <button
        type="submit"
        disabled={busy || !email.includes("@")}
        className="w-full rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
      >
        {busy ? "Sending code…" : "Send code"}
      </button>
    </form>
  );
}

function CodeStep({
  email,
  devCode,
  busy,
  onBack,
  onSubmit,
}: {
  email: string;
  devCode: string | null;
  busy: boolean;
  onBack: () => void;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState(devCode ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
      className="space-y-4"
    >
      {devCode && (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-xs dark:border-zinc-700">
          <span className="text-zinc-500">
            Scaffold shortcut — dev code shown here instead of emailing:{" "}
          </span>
          <code className="font-mono">{devCode}</code>
        </div>
      )}
      <label className="block space-y-2">
        <span className="text-sm font-medium">
          Enter the code sent to {email}
        </span>
        <input
          type="text"
          inputMode="numeric"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-center font-mono text-lg tracking-widest shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      </div>
    </form>
  );
}

function DemoHint({ role }: { role: Role }) {
  if (role === "client") {
    return (
      <span className="block text-xs text-zinc-500">
        Any email works as a client.
      </span>
    );
  }
  return (
    <span className="block text-xs text-zinc-500">
      New providers: any email — we create your profile on first sign-in.
      Demo seeds include <code className="font-mono">t_aria@demo.local</code>.
    </span>
  );
}

function hintEmail(role: Role): string {
  if (role === "provider") return "t_aria@demo.local";
  return "";
}

function defaultLanding(role: Role): string {
  if (role === "provider") return "/provider/dashboard";
  return "/dashboard";
}
