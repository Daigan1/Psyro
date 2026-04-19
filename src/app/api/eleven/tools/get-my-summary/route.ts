// ElevenLabs ConvAI tool webhook: returns the user's recent approved
// session summaries — the most recent one in full, plus a short list of
// prior sessions so the agent can answer "what have we covered overall?"
// across history. The agent calls this when the user asks "what did we
// cover?", "what am I working on?", "remind me what we've discussed".
//
// Auth: Bearer conversation token; userId comes from the verified token.

import { NextResponse } from "next/server";
import { listAppointmentsForClient } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { recordAudit } from "@/lib/audit-log";
import { tokenFromRequest, verifyConversationToken } from "@/lib/eleven-token";
import type { SessionArtifact } from "@/lib/types";

const PRIOR_LOOKBACK = 10;

export async function POST(request: Request) {
  const { token } = await tokenFromRequest(request);
  const payload = token ? verifyConversationToken(token) : null;
  if (!payload) {
    const preview = token
      ? token.length > 60
        ? `${token.slice(0, 24)}…${token.slice(-8)}`
        : token
      : "<no token in header or body>";
    console.warn(
      `[eleven-tool] get_my_summary auth failed. token=${preview} | extracted=${Boolean(token)} | verified=${Boolean(payload)}`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log(
    `[eleven-tool] get_my_summary called by ${payload.sub} (conv ${payload.conv})`,
  );

  const appts = await listAppointmentsForClient(payload.sub);
  const recent = [...appts]
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, PRIOR_LOOKBACK);

  // Fetch artifacts in parallel; keep only approved ones with a summary.
  const enriched = await Promise.all(
    recent.map(async (a) => {
      const artifact = await getArtifact(a.id);
      if (artifact?.reviewStatus !== "approved" || !artifact.summaryFinal) {
        return null;
      }
      return {
        appointmentId: a.id,
        sessionDate: a.startTime,
        providerName: a.providerName,
        artifact: artifact as SessionArtifact & {
          summaryFinal: NonNullable<SessionArtifact["summaryFinal"]>;
        },
      };
    }),
  );
  const approved = enriched.filter(
    (x): x is NonNullable<typeof x> => x !== null,
  );

  if (approved.length === 0) {
    return NextResponse.json({
      summary: null,
      message:
        "No approved session summary is available yet. Your therapist may still be reviewing.",
    });
  }

  const head = approved[0];
  const tail = approved.slice(1);

  recordAudit({
    actorId: payload.sub,
    actorRole: "client",
    action: "qa.asked",
    resource: "appointment",
    resourceId: head.appointmentId,
    metadata: {
      source: "elevenlabs.tool",
      tool: "get_my_summary",
      conv: payload.conv,
      sessionsAvailable: approved.length,
    },
  });

  const headDate = new Date(head.sessionDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  // Include the raw transcript (capped) so the agent can answer
  // detail-level questions about what was actually said, not just what
  // the summary captured. Plus the timestamped segments so the agent
  // can deep-link to any moment.
  const transcript =
    head.artifact.transcriptEdited ?? head.artifact.transcriptRaw ?? "";
  const TRANSCRIPT_CAP = 25_000;
  const segs = head.artifact.transcriptSegments ?? [];
  console.log(
    `[eleven-tool] get_my_summary returning artifact ${head.appointmentId}: transcript=${transcript.length} chars, segments=${segs.length}`,
  );
  if (segs.length === 0) {
    console.warn(
      `[eleven-tool] artifact ${head.appointmentId} has NO transcript segments — agent cannot deep-link to timestamps. Re-transcribe via the provider review page (or via /api/sessions/${head.appointmentId}/transcribe) to populate segments from ElevenLabs Scribe.`,
    );
  }
  const segmentLines = segs.map((s) => {
    const t = Math.floor(s.start);
    const mm = Math.floor(t / 60);
    const ss = (t % 60).toString().padStart(2, "0");
    return {
      timestamp: t,
      humanTimestamp: `${mm}:${ss}`,
      text: s.text,
      replayUrl: `/sessions/${head.appointmentId}?t=${t}`,
    };
  });

  return NextResponse.json({
    instructions:
      "Address the user as 'you' / 'your therapist'. Never say 'the client' or 'the patient'. " +
      "Use `mostRecent.transcriptText` and `mostRecent.transcriptSegments` for detailed quotes — quote VERBATIM from the transcript when answering specific questions, and include the matching segment's `replayUrl` as a clickable listen-back link. " +
      "If a question is broad, pull from `mostRecent.summary` / `keyPoints` instead and link to `mostRecent.replayUrl`. " +
      "Every `replayUrl` opens the user's SESSION SCREEN — the audio player, summary, and full transcript all live on that same screen, so tell the user they can listen and read the transcript right there (there is no separate replay page). " +
      "Only consult `priorSessions` if the user explicitly asks about themes over time.",
    mostRecent: {
      appointmentId: head.appointmentId,
      sessionDate: head.sessionDate,
      providerName: head.providerName,
      summary: head.artifact.summaryFinal.summary,
      keyPoints: head.artifact.summaryFinal.keyPoints,
      actionItems: head.artifact.summaryFinal.actionItems,
      followUps: head.artifact.summaryFinal.followUps,
      transcriptText:
        transcript.length > TRANSCRIPT_CAP
          ? transcript.slice(0, TRANSCRIPT_CAP) + "…[truncated]"
          : transcript,
      transcriptSegments: segmentLines,
      replayUrl: `/sessions/${head.appointmentId}`,
      phrase: `From your ${headDate} session: ${head.artifact.summaryFinal.summary} Open your session screen to listen back and read the transcript: /sessions/${head.appointmentId}.`,
    },
    priorSessions: tail.map((s) => ({
      appointmentId: s.appointmentId,
      sessionDate: s.sessionDate,
      providerName: s.providerName,
      summary: s.artifact.summaryFinal.summary,
      keyPoints: s.artifact.summaryFinal.keyPoints,
      replayUrl: `/sessions/${s.appointmentId}`,
    })),
  });
}
