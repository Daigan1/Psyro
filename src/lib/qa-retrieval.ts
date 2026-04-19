// Server-only: never import from a "use client" module.
// Scaffold retrieval: keyword-overlap scoring across approved transcript +
// approved summary + tenant resources. Returns top-K grounded candidates.
// Real impl uses Bedrock/Titan embeddings + OpenSearch k-NN.

import { chunkText } from "./resource-ingestion";
import type {
  DraftSummary,
  SessionArtifact,
  TherapistResource,
} from "./types";

export type GroundedCandidate = {
  source: "transcript" | "summary" | "resource";
  sourceId: string;
  label: string;
  text: string;
  score: number;
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "for", "of",
  "to", "in", "on", "at", "by", "with", "that", "this", "these", "those",
  "it", "its", "as", "if", "then", "than", "so", "i", "me", "my", "you",
  "your", "we", "us", "our", "they", "them", "their", "can", "will",
  "would", "should", "could", "about", "from", "into", "not", "no", "yes",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function score(question: Set<string>, text: string): number {
  const tokens = tokenize(text);
  if (tokens.size === 0) return 0;
  let overlap = 0;
  for (const t of question) if (tokens.has(t)) overlap += 1;
  if (overlap === 0) return 0;
  // Normalize against chunk size to avoid long chunks dominating.
  return overlap / Math.log(tokens.size + 2);
}

export function retrieveGrounding(args: {
  question: string;
  artifact: SessionArtifact;
  resources: TherapistResource[];
  topK?: number;
}): GroundedCandidate[] {
  const k = args.topK ?? 5;
  const q = tokenize(args.question);
  if (q.size === 0) return [];

  const candidates: GroundedCandidate[] = [];

  // Approved summary — break into fielded quotes so citations are specific.
  if (args.artifact.summaryFinal) {
    for (const c of summaryCandidates(
      args.artifact.appointmentId,
      args.artifact.summaryFinal,
    )) {
      candidates.push({ ...c, score: score(q, c.text) });
    }
  }

  // Approved transcript — prefer Whisper segments when present so each
  // candidate is naturally tied to a timestamp the agent can deep-link to.
  // Fall back to chunkText only when segments aren't available (legacy
  // pasted transcripts).
  const segments = args.artifact.transcriptSegments ?? [];
  if (segments.length > 0) {
    for (const s of segments) {
      candidates.push({
        source: "transcript",
        sourceId: args.artifact.appointmentId,
        label: `Session transcript`,
        text: s.text,
        score: score(q, s.text),
      });
    }
  } else {
    const transcriptText =
      args.artifact.transcriptEdited ?? args.artifact.transcriptRaw;
    if (transcriptText) {
      const chunks = chunkText(args.artifact.appointmentId, transcriptText);
      for (const c of chunks) {
        candidates.push({
          source: "transcript",
          sourceId: args.artifact.appointmentId,
          label: `Session transcript`,
          text: c.text,
          score: score(q, c.text),
        });
      }
    }
  }

  // Therapist resources — each chunk is a citable quote. Filter to
  // resources visible to this client: an empty/missing clientIds means
  // "shared with all of the therapist's clients", a populated array
  // restricts visibility to the listed ones.
  const clientId = args.artifact.clientId;
  for (const r of args.resources) {
    if (r.status !== "ingested") continue;
    const scoped = r.clientIds && r.clientIds.length > 0;
    if (scoped && !r.clientIds!.includes(clientId)) continue;
    for (const c of r.chunks) {
      candidates.push({
        source: "resource",
        sourceId: r.id,
        label: r.title,
        text: c.text,
        score: score(q, c.text),
      });
    }
  }

  return candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function summaryCandidates(
  appointmentId: string,
  s: DraftSummary,
): Omit<GroundedCandidate, "score">[] {
  const out: Omit<GroundedCandidate, "score">[] = [];
  if (s.summary.trim()) {
    out.push({
      source: "summary",
      sourceId: appointmentId,
      label: "Approved summary",
      text: s.summary,
    });
  }
  for (const kp of s.keyPoints) {
    if (kp.trim())
      out.push({
        source: "summary",
        sourceId: appointmentId,
        label: "Key point",
        text: kp,
      });
  }
  for (const item of s.actionItems) {
    if (item.trim())
      out.push({
        source: "summary",
        sourceId: appointmentId,
        label: "Action item",
        text: item,
      });
  }
  for (const f of s.followUps) {
    if (f.trim())
      out.push({
        source: "summary",
        sourceId: appointmentId,
        label: "Follow-up",
        text: f,
      });
  }
  return out;
}
