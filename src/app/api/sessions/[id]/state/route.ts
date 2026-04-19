import { NextResponse } from "next/server";
import { getAppointment } from "@/lib/appointments-store";
import { getClientId, getProviderId } from "@/lib/session";
import { ensureSession } from "@/lib/sessions-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: appointmentId } = await params;
  const appointment = await getAppointment(appointmentId);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const [clientId, providerId] = await Promise.all([
    getClientId(),
    getProviderId(),
  ]);
  const isOwnedByClient = clientId === appointment.clientId;
  const isOwnedByProvider = providerId === appointment.providerId;
  if (!isOwnedByClient && !isOwnedByProvider) {
    return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
  }

  const session = await ensureSession(appointmentId, appointment.tenantId);
  return NextResponse.json({ session });
}
