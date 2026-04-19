import { NextResponse } from "next/server";
import type { ParticipantRole, SessionEndReason } from "@/lib/types";
import { getAppointment, putAppointment } from "@/lib/appointments-store";
import { getClientId, getProviderId } from "@/lib/session";
import { getSession, recordEnd } from "@/lib/sessions-store";
import { createArtifact } from "@/lib/session-artifacts-store";
import { transcribeSession, TranscriptionUnavailable } from "@/lib/stt";
import { recordAudit } from "@/lib/audit-log";

type Body = {
  role: ParticipantRole;
  reason?: Extract<SessionEndReason, "completed" | "tech-failure">;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: appointmentId } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.role !== "client" && body.role !== "provider") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const reason: SessionEndReason = body.reason ?? "completed";
  if (reason !== "completed" && reason !== "tech-failure") {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }

  const appointment = await getAppointment(appointmentId);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  if (body.role === "client") {
    const clientId = await getClientId();
    if (clientId !== appointment.clientId) {
      return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
    }
  } else {
    const providerId = await getProviderId();
    if (providerId !== appointment.providerId) {
      return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
    }
  }

  const existing = await getSession(appointmentId);
  if (!existing || !existing.meetingId) {
    return NextResponse.json(
      { error: "Session never started" },
      { status: 409 },
    );
  }

  const session = await recordEnd(appointmentId, reason);

  // Compute duration from the earliest join to the end.
  const joinMoments = [session.joined.client, session.joined.provider]
    .filter((v): v is string => Boolean(v))
    .map((s) => new Date(s).getTime());
  const earliestJoin = joinMoments.length > 0 ? Math.min(...joinMoments) : null;
  const endedMs = new Date(session.endedAt!).getTime();
  const durationSeconds =
    earliestJoin !== null ? Math.max(0, Math.round((endedMs - earliestJoin) / 1000)) : 0;

  await putAppointment({
    ...appointment,
    status: reason === "completed" ? "completed" : "tech-failure",
  });
  recordAudit({
    tenantId: appointment.tenantId,
    actorId: body.role === "client" ? appointment.clientId : appointment.providerId,
    actorRole: body.role,
    action: "session.ended",
    resource: "appointment",
    resourceId: appointment.id,
    metadata: { reason, durationSeconds },
  });

  // For completed sessions: try the STT pipeline immediately. Daily.co
  // encodes the recording asynchronously after the call ends — so the
  // first attempt right after end almost always fails with
  // TranscriptionUnavailable("not ready yet"). The provider review page
  // exposes a retry button (POST /api/sessions/[id]/transcribe) the
  // therapist clicks once the recording has landed (~30s-2min later).
  if (reason === "completed") {
    try {
      const result = await transcribeSession(appointment);
      await createArtifact({
        appointmentId: appointment.id,
        tenantId: appointment.tenantId,
        providerId: appointment.providerId,
        clientId: appointment.clientId,
        transcriptRaw: result.text,
        transcriptSegments: result.segments,
      });
    } catch (err) {
      if (err instanceof TranscriptionUnavailable) {
        console.warn(
          `[session-end] transcription unavailable for ${appointment.id}; provider will retry: ${err.message}`,
        );
      } else {
        console.error(
          `[session-end] transcription failed for ${appointment.id}:`,
          err,
        );
      }
    }
  }

  return NextResponse.json({ session, durationSeconds });
}
