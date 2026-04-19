import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAppointment } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { getSession } from "@/lib/sessions-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { getUser } from "@/lib/users-store";
import { ReviewClient } from "./review-client";
import { TranscribeNowButton } from "./transcribe-now";
import { ManualTranscriptForm } from "./manual-transcript";

export default async function ProviderReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appointment = await getAppointment(id);
  if (!appointment) notFound();

  const user = await requireAuth("provider", `/provider/sessions/${id}/review`);
  if (user.providerId !== appointment.providerId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not your appointment</h1>
        <Link
          href="/provider/dashboard"
          className="mt-4 inline-block text-sm underline"
        >
          Provider dashboard →
        </Link>
      </div>
    );
  }

  const [artifact, sessionState, clientIntake, clientRecord] =
    await Promise.all([
      getArtifact(id),
      getSession(id),
      getIntakeProgress(appointment.clientId),
      getUser(appointment.clientId),
    ]);
  const clientName =
    clientIntake?.data.personalInfo?.name?.trim() ||
    (clientRecord?.email ? friendlyNameFromEmail(clientRecord.email) : null) ||
    `Client ${appointment.clientId.slice(0, 10)}…`;

  if (!artifact) {
    // Two cases:
    //  - The call ended completed but the recording wasn't ready when the
    //    end route fired (Daily encoding lag). Offer a manual retry.
    //  - The call was tech-failure / no-consent / never started. No retry
    //    will ever produce a transcript — explain that.
    const completed =
      sessionState?.endReason === "completed" && Boolean(sessionState.meetingId);
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">
          {completed ? "Transcript processing" : "No transcript"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {completed
            ? "Daily.co encodes the recording for ~30s-2min after the call ends, then we transcribe automatically. Leave this page open — it will update on its own when the AI-drafted notes are ready."
            : "This session didn't produce a recording (tech-failure, declined consent, or never started). There's nothing to review."}
        </p>
        {completed && <TranscribeNowButton appointmentId={id} />}
        <ManualTranscriptForm appointmentId={id} />
        <Link
          href="/provider/dashboard"
          className="mt-6 inline-block text-sm underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Session review</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {clientName} ·{" "}
          {new Date(appointment.startTime).toLocaleString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
      <ReviewClient appointmentId={id} initial={artifact} />
    </div>
  );
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
