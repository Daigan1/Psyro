"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton({
  className,
  children = "Sign out",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function handle() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className={
        className ??
        "text-sm text-zinc-600 hover:text-primary disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-50"
      }
    >
      {busy ? "Signing out…" : children}
    </button>
  );
}
