import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointment,
  isSlotBooked,
  putAppointment,
} from "@/lib/appointments-store";
import { getAvailability } from "@/lib/mock-availability";
import { getSession } from "@/lib/sessions-store";
import { sendEmail } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit-log";

type Body = { startTime: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.startTime) {
    return NextResponse.json({ error: "Pick a new time." }, { status: 400 });
  }

  const appointment = await getAppointment(id);
  if (!appointment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (appointment.clientId !== user.clientId) {
    return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
  }
  if (appointment.status !== "scheduled") {
    return NextResponse.json(
      { error: `Can't reschedule a '${appointment.status}' session.` },
      { status: 409 },
    );
  }
  if ((await getSession(appointment.id))?.meetingId) {
    return NextResponse.json(
      { error: "The session has already started." },
      { status: 409 },
    );
  }

  const avail = await getAvailability(appointment.providerId);
  const slot = avail.find((s) => s.startTime === body.startTime);
  if (!slot) {
    return NextResponse.json(
      { error: "That time isn't offered by this therapist." },
      { status: 409 },
    );
  }
  if (body.startTime === appointment.startTime) {
    return NextResponse.json(
      { error: "That's the same time you're already booked." },
      { status: 400 },
    );
  }
  if (await isSlotBooked(appointment.providerId, body.startTime)) {
    return NextResponse.json(
      { error: "That time is taken. Pick another." },
      { status: 409 },
    );
  }

  const updated = {
    ...appointment,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
  await putAppointment(updated);
  recordAudit({
    actorId: user.sub,
    actorRole: "client",
    action: "appointment.rescheduled",
    resource: "appointment",
    resourceId: appointment.id,
    metadata: {
      from: appointment.startTime,
      to: updated.startTime,
    },
  });

  const when = new Date(updated.startTime).toLocaleString();
  await Promise.all([
    sendEmail({
      kind: "appointment-booked",
      to: appointment.clientEmail,
      subject: `Your session with ${appointment.providerName} moved to ${when}`,
      body: `Your session is now scheduled for ${when}.`,
    }),
    sendEmail({
      kind: "appointment-booked",
      to: appointment.providerEmail,
      subject: `Session rescheduled to ${when}`,
      body: `A client moved their ${appointment.format} session with you to ${when}.`,
    }),
  ]);

  return NextResponse.json({ appointment: updated });
}
