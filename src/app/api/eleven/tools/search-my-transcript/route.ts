// ElevenLabs ConvAI tool webhook: searches across the user's entire
// session history (every approved artifact) plus the therapist's
// resources, and returns timestamped citations with replay deep links.
//
// Scoring: each Whisper segment is scored individually as a candidate, so
// every transcript-source citation comes with a precise timestamp. The
// agent quotes verbatim and shares replayUrl as `/sessions/<id>?t=N` —
// audio, summary, transcript, and Q&A all live on the session page now.
//
// Auth: Bearer conversation token; the userId comes from the verified
// token, never from the request body.

import { NextResponse } from "next/server";
import { listAppointmentsForClient } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { listResourcesForTenant } from "@/lib/resources-store";
import { retrieveGrounding } from "@/lib/qa-retrieval";
import { recordAudit } from "@/lib/audit-log";
import { tokenFromRequest, verifyConversationToken } from "@/lib/eleven-token";
import type {
  SessionArtifact,
  TherapistResource,
  TranscriptSegment,
} from "@/lib/types";

type Body = { question?: string };

// How many of the user's most recent sessions to include in the search.
// Cap so a long history doesn't make every query a fan-out fest.
const SESSION_LOOKBACK = 20;
const TOP_K = 6;

export async function POST(request: Request) {
  const { token, body: parsedBody } = await tokenFromRequest(request);
  const payload = token ? verifyConversationToken(token) : null;
  if (!payload) {
    console.warn(
      "[eleven-tool] search_my_transcript called without a valid token (header or body).",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // tokenFromRequest already consumed the body if it came from there;
  // otherwise parse it now.
  let body: Body;
  if (Object.keys(parsedBody).length > 0) {
    body = parsedBody as Body;
  } else {
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  const question = body.question?.trim();
  console.log(
    `[eleven-tool] search_my_transcript: ${payload.sub} → "${(question ?? "").slice(0, 80)}"`,
  );
  if (!question || question.length < 3) {
    return NextResponse.json(
      { error: "Ask a longer question." },
      { status: 400 },
    );
  }

  const appts = await listAppointmentsForClient(payload.sub);
  const recent = [...appts]
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, SESSION_LOOKBACK);
  if (recent.length === 0) {
    return NextResponse.json({
      citations: [],
      message: "No sessions on file yet.",
    });
  }

  // Fetch artifacts for every session in parallel; keep only approved ones.
  const artifactsById = new Map<
    string,
    { artifact: SessionArtifact; sessionDate: string; providerName: string }
  >();
  await Promise.all(
    recent.map(async (a) => {
      const artifact = await getArtifact(a.id);
      if (artifact?.reviewStatus === "approved" && artifact.summaryFinal) {
        artifactsById.set(a.id, {
          artifact,
          sessionDate: a.startTime,
          providerName: a.providerName,
        });
      }
    }),
  );
  if (artifactsById.size === 0) {
    return NextResponse.json({
      citations: [],
      message:
        "No approved session is available yet. Your therapist may still be reviewing the most recent session.",
    });
  }

  // Pull provider resources once. We already have one provider per
  // tenant in this app's model, so we can reuse the same set across all
  // sessions.
  const tenantId = recent[0].tenantId;
  const allResources = await listResourcesForTenant(tenantId);
  const myProviderId = recent[0].providerId;
  const resources: TherapistResource[] = allResources.filter(
    (r) => r.providerId === myProviderId,
  );

  // Score per session, then merge.
  type Cite = {
    appointmentId: string;
    sessionDate: string;
    providerName: string;
    source: "transcript" | "summary" | "resource";
    label: string;
    quote: string;
    timestamp: number | null;
    humanTimestamp: string | null;
    replayUrl: string | null;
    phrase: string;
    score: number;
  };
  const merged: Cite[] = [];

  for (const { artifact, sessionDate, providerName } of artifactsById.values()) {
    const grounded = retrieveGrounding({
      question,
      artifact,
      resources,
      topK: TOP_K,
    });
    const segs: TranscriptSegment[] = artifact.transcriptSegments ?? [];

    for (const c of grounded) {
      let timestamp: number | null = null;
      let replayUrl: string | null = null;
      let humanTimestamp: string | null = null;
      if (c.source === "transcript" && segs.length > 0) {
        // The retriever scores Whisper segments directly when available,
        // so the candidate's text === the segment's text. Lookup is exact.
        const hit = segs.find((s) => s.text === c.text);
        if (hit) {
          timestamp = Math.floor(hit.start);
          humanTimestamp = formatTimestamp(timestamp);
          replayUrl = `/sessions/${artifact.appointmentId}?t=${timestamp}`;
        }
      }
      const quote = c.text.slice(0, 320);
      // Pre-format a "ready to read aloud" line so the agent can't miss
      // the timestamp / replay link when assembling its response.
      const phrase = buildPhrase({
        source: c.source,
        quote,
        sessionDate,
        humanTimestamp,
        replayUrl,
        label: c.label,
      });
      merged.push({
        appointmentId: artifact.appointmentId,
        sessionDate,
        providerName,
        source: c.source,
        label: c.label,
        quote,
        timestamp,
        humanTimestamp,
        replayUrl,
        phrase,
        score: c.score,
      });
    }
  }

  // Mix: ensure transcript citations aren't crowded out by summary's
  // denser scoring. Take the top transcript hits first, then top summary,
  // then resource — interleaved so the agent always sees a timestamped
  // moment to quote when one exists.
  merged.sort((a, b) => b.score - a.score);
  const transcripts = merged.filter((c) => c.source === "transcript");
  const summaries = merged.filter((c) => c.source === "summary");
  const resources_ = merged.filter((c) => c.source === "resource");
  const blended: Cite[] = [];
  const sources = [transcripts, summaries, resources_];
  let idx = 0;
  while (blended.length < TOP_K) {
    const bucket = sources[idx % sources.length];
    const next = bucket.shift();
    if (next) blended.push(next);
    if (transcripts.length === 0 && summaries.length === 0 && resources_.length === 0)
      break;
    idx += 1;
  }
  const citations = blended.map((c) => ({
    appointmentId: c.appointmentId,
    sessionDate: c.sessionDate,
    providerName: c.providerName,
    source: c.source,
    label: c.label,
    quote: c.quote,
    timestamp: c.timestamp,
    humanTimestamp: c.humanTimestamp,
    replayUrl: c.replayUrl,
    phrase: c.phrase,
  }));

  recordAudit({
    tenantId,
    actorId: payload.sub,
    actorRole: "client",
    action: "qa.asked",
    resource: "appointment",
    resourceId: null,
    metadata: {
      source: "elevenlabs.tool",
      tool: "search_my_transcript",
      conv: payload.conv,
      sessionsSearched: artifactsById.size,
      citationCount: citations.length,
    },
  });

  if (citations.length === 0) {
    return NextResponse.json({
      citations: [],
      message:
        "Searched your sessions but didn't find a strong match. Try rephrasing with the words you actually used in session.",
    });
  }

  return NextResponse.json({
    instructions:
      "MANDATORY: every answer MUST include at least one clickable replayUrl when one exists. Speak the most relevant citation's `phrase` field verbatim — it already contains the timestamp and the session-screen link in the right format. The link opens the user's SESSION SCREEN, where the audio, summary, and full transcript live together; tell the user they can listen back and see the transcript on that same session screen (there is no separate replay page). Never give a transcript answer without sharing the replayUrl. If no transcript citation has a replayUrl, fall back to a summary citation but tell the user: 'I don't have a deep-link timestamp for this one — open your session screen to see the transcript.'",
    sessionsSearched: artifactsById.size,
    citations,
  });
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildPhrase(args: {
  source: "transcript" | "summary" | "resource";
  quote: string;
  sessionDate: string;
  humanTimestamp: string | null;
  replayUrl: string | null;
  label: string;
}): string {
  const date = new Date(args.sessionDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  if (args.source === "transcript" && args.humanTimestamp && args.replayUrl) {
    return `From your session on ${date}, around ${args.humanTimestamp}, you said: "${args.quote}" — open your session screen to listen back and read the transcript: ${args.replayUrl}.`;
  }
  if (args.source === "summary") {
    return `From your ${date} session summary (${args.label.toLowerCase()}): "${args.quote}".`;
  }
  if (args.source === "resource") {
    return `From the resource "${args.label}" your therapist shared: "${args.quote}".`;
  }
  return `"${args.quote}" — from your ${date} session.`;
}
