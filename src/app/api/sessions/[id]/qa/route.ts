import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { QACitation, QAInteraction } from "@/lib/types";
import { requireAuthApi } from "@/lib/auth-api";
import { getAppointment } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { listResourcesForProvider } from "@/lib/resources-store";
import { answerSessionQuestion } from "@/lib/featherless";
import { listInteractions, recordInteraction } from "@/lib/qa-store";
import { recordAudit } from "@/lib/audit-log";

// Crisis short-circuit: don't ship anything sensitive to Featherless when
// the user is in distress. Hand off to crisis resources locally.
const SENSITIVE_KEYWORDS = [
  "suicide",
  "suicidal",
  "kill myself",
  "self harm",
  "self-harm",
  "hurt myself",
  "harm",
  "overdose",
  "abuse",
];

function isSensitive(question: string): boolean {
  const q = question.toLowerCase();
  return SENSITIVE_KEYWORDS.some((k) => q.includes(k));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthApi("client");
  if ("error" in auth) return auth.error;

  const appointment = await getAppointment(id);
  if (!appointment || appointment.clientId !== auth.user.clientId) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }
  const interactions = await listInteractions(id);
  return NextResponse.json({ interactions });
}

type PostBody = { question: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthApi("client");
  if ("error" in auth) return auth.error;

  const appointment = await getAppointment(id);
  if (!appointment || appointment.clientId !== auth.user.clientId) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  const artifact = await getArtifact(id);
  if (!artifact || artifact.reviewStatus !== "approved") {
    return NextResponse.json(
      { error: "Your therapist hasn't approved this session's summary yet." },
      { status: 409 },
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = body.question?.trim() ?? "";
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a longer question." }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  let answer: string;
  let citations: QACitation[];

  if (isSensitive(question)) {
    answer =
      "This sounds important and I'm not the right source for it. Please reach out to your therapist directly, or if you're in immediate distress, call or text 988. I can help with questions about what you and your therapist discussed in the approved session summary.";
    citations = [];
  } else {
    const resources = await listResourcesForProvider(appointment.providerId);
    try {
      const result = await answerSessionQuestion({
        question,
        artifact,
        resources,
      });
      answer = result.answer;
      const segs = artifact.transcriptSegments ?? [];
      console.log(
        `[qa] artifact ${id}: ${segs.length} transcript segments, ${result.citations.length} model citations`,
      );
      // First pass: resolve any "seg-N" sourceIds the model returned.
      citations = result.citations.map((c) => {
        if (c.source !== "transcript") return c;
        const m = /^seg-(\d+)$/.exec(c.sourceId);
        if (!m) return c;
        const seg = segs[Number(m[1])];
        if (!seg) return c;
        return enrichTranscriptCitation(c, seg.start, id);
      });
      // Second pass: if no transcript citation has a replay link yet,
      // pick the best-matching segment for the question via keyword
      // overlap and inject it. This guarantees the panel always shows
      // a "▸ listen at X:XX" link even when the LLM forgets to cite a
      // seg-N id.
      const hasReplay = citations.some(
        (c) => c.source === "transcript" && c.replayUrl,
      );
      if (!hasReplay && segs.length > 0) {
        const bestIdx = bestMatchingSegmentIndex(question, segs);
        if (bestIdx >= 0) {
          const seg = segs[bestIdx];
          console.log(
            `[qa] injecting fallback link to seg ${bestIdx} @ ${Math.floor(seg.start)}s`,
          );
          citations.unshift(
            enrichTranscriptCitation(
              {
                source: "transcript",
                sourceId: id,
                quote: seg.text.slice(0, 200),
              },
              seg.start,
              id,
            ),
          );
        }
      } else if (segs.length === 0) {
        console.warn(
          `[qa] artifact ${id} has NO transcript segments — replay deep-links impossible. Likely a pasted transcript or pre-Scribe artifact. Re-transcribe via the provider review page to get timestamps.`,
        );
      }
    } catch (err) {
      console.error(
        `[qa] featherless answer failed: ${(err as Error).message}`,
      );
      return NextResponse.json(
        {
          error:
            "Couldn't compose an answer right now. Please try again in a moment.",
        },
        { status: 502 },
      );
    }
  }

  const interaction: QAInteraction = {
    id: `qa_${randomUUID()}`,
    appointmentId: id,
    clientId: auth.user.clientId!,
    question,
    answer,
    citations,
    askedAt: new Date().toISOString(),
  };
  await recordInteraction(interaction);
  recordAudit({
    actorId: auth.user.clientId ?? null,
    actorRole: "client",
    action: "qa.asked",
    resource: "appointment",
    resourceId: id,
    metadata: {
      citationCount: citations.length,
      escalated: citations.length === 0,
    },
  });
  return NextResponse.json({ interaction });
}

function enrichTranscriptCitation(
  c: QACitation,
  startSeconds: number,
  appointmentId: string,
): QACitation {
  const t = Math.floor(startSeconds);
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toString().padStart(2, "0");
  return {
    ...c,
    sourceId: appointmentId,
    timestamp: t,
    humanTimestamp: `${mm}:${ss}`,
    replayUrl: `/sessions/${appointmentId}?t=${t}`,
  };
}

// Tiny keyword-overlap retriever — same shape as lib/qa-retrieval but
// scoped to one segment array, no allocations beyond the result. Used as
// a fallback when the LLM forgot to cite a seg-N so the panel still gets
// a clickable timestamp.
const QA_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "for", "of",
  "to", "in", "on", "at", "by", "with", "that", "this", "these", "those",
  "it", "its", "as", "if", "then", "than", "so", "i", "me", "my", "you",
  "your", "we", "us", "our", "they", "them", "their", "can", "will",
  "would", "should", "could", "about", "from", "into", "not", "no", "yes",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !QA_STOPWORDS.has(t));
}

function bestMatchingSegmentIndex(
  question: string,
  segs: { start: number; end: number; text: string }[],
): number {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return -1;
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < segs.length; i++) {
    const sTokens = new Set(tokenize(segs[i].text));
    if (sTokens.size === 0) continue;
    let overlap = 0;
    for (const t of qTokens) if (sTokens.has(t)) overlap += 1;
    if (overlap === 0) continue;
    const score = overlap / Math.log(sTokens.size + 2);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
