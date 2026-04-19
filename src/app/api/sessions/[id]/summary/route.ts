import { NextResponse } from "next/server";
import type { DraftSummary } from "@/lib/types";
import { getAppointment } from "@/lib/appointments-store";
import { getProviderId } from "@/lib/session";
import {
  getArtifact,
  setSummaryDraft,
  updateSummaryDraft,
} from "@/lib/session-artifacts-store";
import { summarizeTranscript } from "@/lib/stt";
import { recordAudit } from "@/lib/audit-log";

// POST generates the draft summary from the current (raw or edited)
// transcript. Transitions pending-transcript-review → pending-summary-review.
export async function POST(
  _request: Request,
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

  const artifact = await getArtifact(id);
  if (!artifact) {
    return NextResponse.json({ error: "No artifact for this session" }, { status: 404 });
  }
  // Allowed at any status — therapists may regenerate the AI draft after
  // editing the transcript, even on already-approved sessions. The
  // setSummaryDraft call below resets reviewStatus to
  // pending-summary-review so they can re-approve the new draft.

  // Use edited transcript if the provider modified it; otherwise use raw.
  const sourceTranscript = artifact.transcriptEdited ?? artifact.transcriptRaw;
  // Summarization is part of the STT tool — there is no separate
  // summarizer agent to configure.
  const draft = await summarizeTranscript(sourceTranscript);
  const updated = await setSummaryDraft(id, draft);
  recordAudit({
    actorId: providerId,
    actorRole: "provider",
    action: "artifact.summary-generated",
    resource: "artifact",
    resourceId: id,
    metadata: {},
  });
  return NextResponse.json({ artifact: updated });
}

type PatchBody = { summary: DraftSummary };

// PATCH updates the draft summary (provider edits it before approving).
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

  const err = validateSummary(body?.summary);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const artifact = await updateSummaryDraft(id, body.summary);
    recordAudit({
      actorId: providerId,
      actorRole: "provider",
      action: "artifact.summary-edited",
      resource: "artifact",
      resourceId: id,
      metadata: {},
    });
    return NextResponse.json({ artifact });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
}

function validateSummary(s: DraftSummary | undefined): string | null {
  if (!s) return "Missing summary";
  if (typeof s.summary !== "string" || s.summary.trim().length === 0) {
    return "Summary text can't be empty.";
  }
  for (const field of ["keyPoints", "actionItems", "followUps"] as const) {
    if (!Array.isArray(s[field])) return `${field} must be an array`;
    if (s[field].some((x) => typeof x !== "string")) {
      return `${field} items must all be strings`;
    }
  }
  return null;
}
