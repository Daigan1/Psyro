"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  therapistId: string;
  isCurrent: boolean;
};

export function SelectTherapistButton({ therapistId, isCurrent }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/me/current-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: therapistId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't select therapist.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (isCurrent) {
    return (
      <span className="rounded-full border border-accent px-4 py-2 text-sm font-medium text-primary dark:text-accent">
        Selected
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={select}
        disabled={busy}
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
      >
        {busy ? "Selecting…" : "Select"}
      </button>
      {error && (
        <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
