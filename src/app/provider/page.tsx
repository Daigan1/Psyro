import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function ProviderLandingPage() {
  const user = await getCurrentUser();
  if (user?.role === "provider") {
    redirect("/provider/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Provider sign in</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Providers sign in with a 6-digit email code.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/sign-in?role=provider&next=/provider/dashboard"
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
        >
          Sign in
        </Link>
        <Link
          href="/sign-in?role=provider&next=/provider/onboarding"
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
