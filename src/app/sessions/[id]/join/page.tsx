import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAppointment } from "@/lib/appointments-store";
import { ensureSession } from "@/lib/sessions-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { JoinSession } from "./join-session";

export default async function ClientJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appointment = await getAppointment(id);
  if (!appointment) notFound();

  const user = await requireAuth("client", `/sessions/${id}/join`);
  if (user.clientId !== appointment.clientId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not your session</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You&apos;re signed in as a different client. Return to your dashboard.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm underline"
        >
          My dashboard →
        </Link>
      </div>
    );
  }

  const [session, progress] = await Promise.all([
    ensureSession(appointment.id),
    getIntakeProgress(user.clientId!),
  ]);
  const displayName =
    progress?.data.personalInfo?.name?.trim() ||
    friendlyNameFromEmail(user.email);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Session with {appointment.providerName}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatStart(appointment.startTime)} · {appointment.format}
        </p>
      </div>
      <JoinSession
        appointmentId={appointment.id}
        providerName={appointment.providerName}
        startTime={appointment.startTime}
        role="client"
        initialSession={session}
        returnHref="/dashboard"
        leaveHref="/dashboard"
        displayName={displayName}
        counterpartyLabel="your therapist"
        consentText="Your therapist will record and transcribe this session so they can focus on you and review their notes afterward. After the session, your therapist reviews and approves the AI summary before you see it."
      />
    </div>
  );
}

function formatStart(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Clients don't have a stored display name — derive one from the email's
// local part so the Daily iframe pre-fills it. e.g. "ada.lovelace@x.com"
// → "Ada Lovelace".
function friendlyNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "Client";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || "Client";
}
