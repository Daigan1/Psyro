import { NextResponse } from "next/server";
import type { ParticipantRole } from "@/lib/types";
import { getAppointment } from "@/lib/appointments-store";
import { getClientId, getProviderId } from "@/lib/session";
import {
  bothConsented,
  ensureSession,
  recordConsent,
  recordJoin,
  recordRefusal,
  setMeetingId,
} from "@/lib/sessions-store";
import { createRoom, dailyConfigured, DailyError } from "@/lib/daily";
import { recordAudit } from "@/lib/audit-log";

type Body = {
  role: ParticipantRole;
  action: "consent" | "refuse";
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
  if (body.action !== "consent" && body.action !== "refuse") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const appointment = await getAppointment(appointmentId);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const authError = await authorize(body.role, appointment);
  if (authError) return authError;

  await ensureSession(appointmentId);

  if (body.action === "refuse") {
    try {
      const session = await recordRefusal(appointmentId, body.role);
      recordAudit({
        actorId: body.role === "client" ? appointment.clientId : appointment.providerId,
        actorRole: body.role,
        action: "session.refused",
        resource: "appointment",
        resourceId: appointmentId,
        metadata: {},
      });
      return NextResponse.json({ session });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 409 },
      );
    }
  }

  let session;
  try {
    session = await recordConsent(appointmentId, body.role);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
  recordAudit({
    actorId: body.role === "client" ? appointment.clientId : appointment.providerId,
    actorRole: body.role,
    action: "session.consent",
    resource: "appointment",
    resourceId: appointmentId,
    metadata: {},
  });

  // Both parties consented — create the Daily room and mark the consenting
  // party as joined. The other party's join-call fires when they hit this
  // endpoint.
  if (!session.meetingId && bothConsented(session)) {
    if (!dailyConfigured()) {
      return NextResponse.json(
        {
          error:
            "Video service is not configured. Set DAILY_API_KEY on the server.",
        },
        { status: 503 },
      );
    }
    try {
      const room = await createRoom(appointmentId);
      session = await setMeetingId(appointmentId, room.name, room.url);
      // Both parties have consented and the meeting now exists. Mark BOTH
      // as joined — the first-to-consent never got `recordJoin` called
      // because the meeting didn't exist when their consent was recorded,
      // which left the other side stuck on "Waiting for X to join…"
      // forever even after they actually loaded the iframe.
      session = await recordJoin(appointmentId, "client");
      session = await recordJoin(appointmentId, "provider");
      recordAudit({
        actorId: null,
        actorRole: "system",
        action: "session.started",
        resource: "appointment",
        resourceId: appointmentId,
        metadata: { meetingId: room.name, meetingUrl: room.url },
      });
    } catch (err) {
      const status = err instanceof DailyError ? 502 : 500;
      console.error(`[consent] room creation failed: ${(err as Error).message}`);
      return NextResponse.json(
        { error: "Couldn't start the video room. Please try again." },
        { status },
      );
    }
  } else if (session.meetingId) {
    // Re-entering after first consent (e.g. the consenting party comes
    // back via /sessions/.../join) — record their join idempotently.
    session = await recordJoin(appointmentId, body.role);
  }

  return NextResponse.json({ session });
}

async function authorize(
  role: ParticipantRole,
  appointment: { clientId: string; providerId: string },
) {
  if (role === "client") {
    const clientId = await getClientId();
    if (!clientId || clientId !== appointment.clientId) {
      return NextResponse.json(
        { error: "Not your appointment" },
        { status: 403 },
      );
    }
  } else {
    const providerId = await getProviderId();
    if (!providerId || providerId !== appointment.providerId) {
      return NextResponse.json(
        { error: "Not your appointment" },
        { status: 403 },
      );
    }
  }
  return null;
}
