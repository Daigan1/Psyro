import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  // Marketing page is for unauthenticated visitors only. Returning users
  // shouldn't land on "Start intake" — they already have a dashboard with
  // their current therapist, upcoming sessions, and Settings to edit prefs.
  const user = await getCurrentUser();
  if (user?.role === "client") redirect("/dashboard");
  if (user?.role === "provider") redirect("/provider/dashboard");

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <main className="w-full max-w-3xl space-y-12">
        <header className="space-y-4">
          <p className="inline-flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-accent" />
            TinyFish
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-primary sm:text-5xl dark:text-zinc-50">
            Find the right therapist.
            <br />
            <span className="bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent dark:from-accent dark:to-zinc-50">
              Get more out of every session.
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            A therapist-led platform with AI-assisted discovery, session
            summaries reviewed by your provider, and grounded follow-up Q&amp;A.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <RoleCard
            href="/intake"
            title="I'm looking for care"
            body="Tell us what you're going through and we'll match you with a therapist."
            cta="Start intake"
          />
          <RoleCard
            href="/provider"
            title="I'm a provider"
            body="Manage sessions, review AI summaries, and share resources."
            cta="Provider sign in"
          />
        </div>
      </main>
    </div>
  );
}

function RoleCard({
  href,
  title,
  body,
  cta,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-6 transition-colors hover:border-primary dark:border-zinc-800 dark:bg-primary dark:hover:border-accent"
    >
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-primary dark:text-zinc-50">
          {title}
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {body}
        </p>
      </div>
      <span className="mt-6 flex items-center gap-1 text-sm font-medium text-primary dark:text-zinc-50">
        {cta}
        <span className="transition-transform group-hover:translate-x-0.5 text-accent">
          →
        </span>
      </span>
    </Link>
  );
}
