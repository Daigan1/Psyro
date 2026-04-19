import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointment,
  putAppointment,
} from "@/lib/appointments-store";
import { getSession } from "@/lib/sessions-store";
import { sendEmail } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit-log";

const LATE_CANCEL_WINDOW_HOURS = 24;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || (user.role !== "client" && user.role !== "provider")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const appointment = await getAppointment(id);
  if (!appointment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ownedByUser =
    (user.role === "client" && user.clientId === appointment.clientId) ||
    (user.role === "provider" && user.providerId === appointment.providerId);
  if (!ownedByUser) {
    return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
  }

  if (appointment.status !== "scheduled") {
    return NextResponse.json(
      { error: `Can't cancel a session in '${appointment.status}' state.` },
      { status: 409 },
    );
  }
  if ((await getSession(appointment.id))?.meetingId) {
    return NextResponse.json(
      { error: "The session has already started." },
      { status: 409 },
    );
  }

  const hoursUntilStart =
    (new Date(appointment.startTime).getTime() - Date.now()) / 3_600_000;
  const status: "cancelled" | "late-cancel" =
    hoursUntilStart < LATE_CANCEL_WINDOW_HOURS ? "late-cancel" : "cancelled";

  await putAppointment({ ...appointment, status });
  recordAudit({
    tenantId: appointment.tenantId,
    actorId: user.sub,
    actorRole: user.role,
    action: "appointment.cancelled",
    resource: "appointment",
    resourceId: appointment.id,
    metadata: { status, hoursUntilStart: Math.round(hoursUntilStart) },
  });

  const cancelledBy = user.role === "client" ? "client" : "provider";
  const counterpartEmail =
    cancelledBy === "client" ? appointment.providerEmail : appointment.clientEmail;
  await sendEmail({
    tenantId: appointment.tenantId,
    kind: "appointment-cancelled",
    to: counterpartEmail,
    subject: `Session ${status === "late-cancel" ? "cancelled (late notice)" : "cancelled"}`,
    body: `The ${appointment.format} session scheduled for ${new Date(
      appointment.startTime,
    ).toLocaleString()} was cancelled by the ${cancelledBy}.`,
  });

  return NextResponse.json({
    appointment: { ...appointment, status },
    status,
  });
}
