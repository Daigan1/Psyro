import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAppointment } from "@/lib/appointments-store";
import { ensureSession } from "@/lib/sessions-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { getUser } from "@/lib/users-store";
import { JoinSession } from "@/app/sessions/[id]/join/join-session";

export default async function ProviderJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appointment = await getAppointment(id);
  if (!appointment) notFound();

  const user = await requireAuth("provider", `/provider/sessions/${id}/join`);
  if (user.providerId !== appointment.providerId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not your appointment</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This appointment belongs to another provider.
        </p>
        <Link
          href="/provider/dashboard"
          className="mt-4 inline-block text-sm underline"
        >
          Provider dashboard →
        </Link>
      </div>
    );
  }

  const [session, clientIntake, clientRecord] = await Promise.all([
    ensureSession(appointment.id),
    getIntakeProgress(appointment.clientId),
    getUser(appointment.clientId),
  ]);
  const clientName =
    clientIntake?.data.personalInfo?.name?.trim() ||
    (clientRecord?.email ? friendlyNameFromEmail(clientRecord.email) : null) ||
    shortenClientId(appointment.clientId);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Session with{" "}
          <span className="text-zinc-700 dark:text-zinc-300">
            {clientName}
          </span>
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatStart(appointment.startTime)} · {appointment.format}
        </p>
      </div>
      <JoinSession
        appointmentId={appointment.id}
        providerName={appointment.providerName}
        startTime={appointment.startTime}
        role="provider"
        initialSession={session}
        returnHref="/provider/dashboard"
        reviewHref={`/provider/sessions/${appointment.id}/review`}
        displayName={appointment.providerName}
        counterpartyLabel="your client"
        consentText="Confirm your client has verbally consented as well. Recording and transcription begin once both parties confirm in this app. You will review the AI-drafted summary before anything is shared with the client."
      />
    </div>
  );
}

function shortenClientId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function friendlyNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "Client";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || "Client"
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
