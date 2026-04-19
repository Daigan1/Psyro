import { NextResponse } from "next/server";
import { getAppointment } from "@/lib/appointments-store";
import { getClientId, getProviderId } from "@/lib/session";
import { getArtifact } from "@/lib/session-artifacts-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const appointment = await getAppointment(id);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const [clientId, providerId] = await Promise.all([
    getClientId(),
    getProviderId(),
  ]);
  const isClient = clientId === appointment.clientId;
  const isProvider = providerId === appointment.providerId;
  if (!isClient && !isProvider) {
    return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
  }

  const artifact = await getArtifact(id);
  if (!artifact) {
    return NextResponse.json({ artifact: null });
  }

  // Client only sees the artifact after therapist approval, and only the
  // final summary — never the raw transcript or the draft.
  if (isClient && !isProvider) {
    if (artifact.reviewStatus !== "approved" || !artifact.summaryFinal) {
      return NextResponse.json({
        artifact: {
          appointmentId: artifact.appointmentId,
          reviewStatus: artifact.reviewStatus,
          summary: null,
        },
      });
    }
    return NextResponse.json({
      artifact: {
        appointmentId: artifact.appointmentId,
        reviewStatus: artifact.reviewStatus,
        summary: artifact.summaryFinal,
        reviewedAt: artifact.reviewedAt,
      },
    });
  }

  // Provider sees everything.
  return NextResponse.json({ artifact });
}
