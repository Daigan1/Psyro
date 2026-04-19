import { NextResponse } from "next/server";
import { getAppointment } from "@/lib/appointments-store";
import { getProviderId } from "@/lib/session";
import { updateTranscriptEdit } from "@/lib/session-artifacts-store";
import { recordAudit } from "@/lib/audit-log";

type PatchBody = { transcript: string };

export async function PATCH(
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.transcript !== "string" || body.transcript.trim().length === 0) {
    return NextResponse.json(
      { error: "Transcript can't be empty." },
      { status: 400 },
    );
  }

  try {
    const artifact = await updateTranscriptEdit(id, body.transcript);
    recordAudit({
      tenantId: appointment.tenantId,
      actorId: providerId,
      actorRole: "provider",
      action: "artifact.transcript-edited",
      resource: "artifact",
      resourceId: id,
      metadata: { length: body.transcript.length },
    });
    return NextResponse.json({ artifact });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
}
