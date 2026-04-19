// Provider-only endpoint with three input modes — all create the same
// SessionArtifact row that the review page consumes.
//
//  1. Default (no body): pull the latest Daily.co recording and run it
//     through ElevenLabs Scribe. Returns 503 if the recording isn't ready
//     yet so the polling UI on the review page can keep retrying.
//  2. Multipart form with `audio` file: bypass Daily entirely and send the
//     uploaded file directly to ElevenLabs Scribe. Useful when auto-record
//     failed or the therapist wants to upload a recording made off-platform.
//  3. JSON `{ transcriptText: string }`: paste a raw transcript with no STT
//     step. No timestamps; replay deep-links won't work for this artifact,
//     but every other downstream feature does (review, summary, citations).
//
// Idempotent: if the artifact already exists, return it as-is.

import { NextResponse } from "next/server";
import { getAppointment } from "@/lib/appointments-store";
import { getProviderId } from "@/lib/session";
import {
  createArtifact,
  getArtifact,
} from "@/lib/session-artifacts-store";
import { setRecordingUrl } from "@/lib/sessions-store";
import { transcribeSession, TranscriptionUnavailable } from "@/lib/stt";
import {
  ElevenSTTError,
  elevenSTTConfigured,
  transcribeAudioBlob,
} from "@/lib/eleven-stt";
import { recordAudit } from "@/lib/audit-log";

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

  const existing = await getArtifact(id);
  if (existing) {
    return NextResponse.json({ artifact: existing, alreadyTranscribed: true });
  }

  const ct = request.headers.get("content-type") ?? "";

  // Mode 3: pasted transcript text.
  if (ct.includes("application/json")) {
    let body: { transcriptText?: string };
    try {
      body = (await request.json()) as { transcriptText?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const text = body.transcriptText?.trim() ?? "";
    if (text.length < 20) {
      return NextResponse.json(
        { error: "Paste a longer transcript (at least a couple of sentences)." },
        { status: 400 },
      );
    }
    const artifact = await createArtifact({
      appointmentId: id,
      tenantId: appointment.tenantId,
      providerId: appointment.providerId,
      clientId: appointment.clientId,
      transcriptRaw: text,
      transcriptSegments: [], // no timestamps for pasted text
    });
    recordAudit({
      tenantId: appointment.tenantId,
      actorId: providerId,
      actorRole: "provider",
      action: "artifact.summary-generated",
      resource: "artifact",
      resourceId: id,
      metadata: { kind: "transcript-pasted", chars: text.length },
    });
    return NextResponse.json({ artifact });
  }

  // Mode 2: uploaded audio file → ElevenLabs Scribe.
  if (ct.includes("multipart/form-data")) {
    if (!elevenSTTConfigured()) {
      return NextResponse.json(
        { error: "Set ELEVENLABS_API_KEY to transcribe audio uploads." },
        { status: 503 },
      );
    }
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json(
        { error: "Attach an audio file under the 'audio' field." },
        { status: 400 },
      );
    }
    try {
      const result = await transcribeAudioBlob(file);
      const artifact = await createArtifact({
        appointmentId: id,
        tenantId: appointment.tenantId,
        providerId: appointment.providerId,
        clientId: appointment.clientId,
        transcriptRaw: result.text,
        transcriptSegments: result.segments,
      });
      recordAudit({
        tenantId: appointment.tenantId,
        actorId: providerId,
        actorRole: "provider",
        action: "artifact.summary-generated",
        resource: "artifact",
        resourceId: id,
        metadata: {
          kind: "audio-uploaded",
          segments: result.segments.length,
          fileBytes: file.size,
        },
      });
      return NextResponse.json({ artifact });
    } catch (err) {
      if (err instanceof ElevenSTTError) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }
      console.error(`[transcribe] upload failed for ${id}:`, err);
      return NextResponse.json(
        { error: "Couldn't transcribe that file." },
        { status: 502 },
      );
    }
  }

  // Mode 1 (default): pull from Daily.
  try {
    const result = await transcribeSession(appointment);
    const artifact = await createArtifact({
      appointmentId: id,
      tenantId: appointment.tenantId,
      providerId: appointment.providerId,
      clientId: appointment.clientId,
      transcriptRaw: result.text,
      transcriptSegments: result.segments,
    });
    try {
      await setRecordingUrl(id, `daily-recording:${result.recordingId}`);
    } catch {
      // session row may not exist yet (older flows). Non-fatal.
    }
    recordAudit({
      tenantId: appointment.tenantId,
      actorId: providerId,
      actorRole: "provider",
      action: "artifact.summary-generated",
      resource: "artifact",
      resourceId: id,
      metadata: {
        kind: "transcription-completed",
        segments: result.segments.length,
        durationSeconds: result.recordingDurationSeconds,
      },
    });
    return NextResponse.json({ artifact });
  } catch (err) {
    if (err instanceof TranscriptionUnavailable) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error(`[transcribe] failed for ${id}:`, err);
    return NextResponse.json(
      { error: "Transcription failed. Try again in a moment." },
      { status: 502 },
    );
  }
}
