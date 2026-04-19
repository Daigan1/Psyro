import { NextResponse } from "next/server";
import { getAppointment } from "@/lib/appointments-store";
import { getProviderId } from "@/lib/session";
import { finalizeReview } from "@/lib/session-artifacts-store";
import { sendEmail } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit-log";

type Body =
  | { decision: "approve" }
  | { decision: "reject"; note?: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const appointment = await getAppointment(id);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }
  const providerId = await getProviderId();
  if (providerId !== appointment.providerId) {
    return NextResponse.json({ error: "Not your appointment" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = body.decision === "approve" ? "approved" : "rejected";
  const note = body.decision === "reject" ? body.note : undefined;

  let artifact;
  try {
    artifact = await finalizeReview(id, {
      status,
      by: providerId,
      note,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
  recordAudit({
    tenantId: appointment.tenantId,
    actorId: providerId,
    actorRole: "provider",
    action: status === "approved" ? "artifact.approved" : "artifact.rejected",
    resource: "artifact",
    resourceId: id,
    metadata: note ? { note } : {},
  });

  if (status === "approved") {
    await sendEmail({
      tenantId: appointment.tenantId,
      kind: "session-summary-approved",
      to: appointment.clientEmail,
      subject: `Your session summary with ${appointment.providerName} is ready`,
      body: `Your therapist has approved the summary of your recent session. You can view it and ask follow-up questions from your dashboard.`,
    });
  }

  return NextResponse.json({ artifact });
}
