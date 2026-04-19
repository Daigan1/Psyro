// Server-only: never import from a "use client" module.
// Session artifact store keyed by appointmentId — one artifact per completed
// session. DDB-only, no cache.

import {
  ddbGetArtifact,
  ddbListArtifactsForProvider,
  ddbPutArtifact,
} from "./aws/dynamodb";
import type {
  DraftSummary,
  ReviewStatus,
  SessionArtifact,
  TranscriptSegment,
} from "./types";

export async function getArtifact(
  appointmentId: string,
): Promise<SessionArtifact | null> {
  return ddbGetArtifact(appointmentId);
}

export async function listArtifactsForProvider(
  providerId: string,
): Promise<SessionArtifact[]> {
  return ddbListArtifactsForProvider(providerId);
}

export async function createArtifact(args: {
  appointmentId: string;
  tenantId: string;
  providerId: string;
  clientId: string;
  transcriptRaw: string;
  transcriptSegments?: TranscriptSegment[];
}): Promise<SessionArtifact> {
  const artifact: SessionArtifact = {
    appointmentId: args.appointmentId,
    tenantId: args.tenantId,
    providerId: args.providerId,
    clientId: args.clientId,
    transcriptRaw: args.transcriptRaw,
    transcriptEdited: null,
    transcriptSegments: args.transcriptSegments ?? [],
    summaryDraft: null,
    summaryFinal: null,
    reviewStatus: "pending-transcript-review",
    rejectionNote: null,
    transcribedAt: new Date().toISOString(),
    summarizedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  };
  await ddbPutArtifact(artifact);
  return artifact;
}

export async function updateTranscriptEdit(
  appointmentId: string,
  edited: string,
): Promise<SessionArtifact> {
  const a = await ddbGetArtifact(appointmentId);
  if (!a) throw new Error(`Artifact ${appointmentId} not found`);
  // Allowed at any status. Therapists routinely fix typos or add notes
  // weeks after a session; the previous "lock after review" guard made
  // that impossible.
  const next: SessionArtifact = { ...a, transcriptEdited: edited };
  await ddbPutArtifact(next);
  return next;
}

export async function setSummaryDraft(
  appointmentId: string,
  draft: DraftSummary,
): Promise<SessionArtifact> {
  const a = await ddbGetArtifact(appointmentId);
  if (!a) throw new Error(`Artifact ${appointmentId} not found`);
  const next: SessionArtifact = {
    ...a,
    summaryDraft: draft,
    summarizedAt: new Date().toISOString(),
    reviewStatus: "pending-summary-review",
  };
  await ddbPutArtifact(next);
  return next;
}

export async function updateSummaryDraft(
  appointmentId: string,
  draft: DraftSummary,
): Promise<SessionArtifact> {
  const a = await ddbGetArtifact(appointmentId);
  if (!a) throw new Error(`Artifact ${appointmentId} not found`);
  // Allowed at any status. Editing an already-approved summary updates
  // both the draft and (if approved) the final-shared copy so the client
  // sees the corrected version on their next visit.
  const next: SessionArtifact = {
    ...a,
    summaryDraft: draft,
    summaryFinal: a.reviewStatus === "approved" ? draft : a.summaryFinal,
  };
  await ddbPutArtifact(next);
  return next;
}

export async function finalizeReview(
  appointmentId: string,
  decision: {
    status: Extract<ReviewStatus, "approved" | "rejected">;
    by: string;
    note?: string;
  },
): Promise<SessionArtifact> {
  const a = await ddbGetArtifact(appointmentId);
  if (!a) throw new Error(`Artifact ${appointmentId} not found`);
  if (!a.summaryDraft) {
    throw new Error("No summary draft to approve or reject");
  }
  // Allowed at any status. Re-approving an already-approved artifact
  // refreshes summaryFinal with whatever's now in the draft, so an
  // edited summary becomes the new source of truth for the client.
  const next: SessionArtifact = {
    ...a,
    reviewStatus: decision.status,
    summaryFinal: decision.status === "approved" ? a.summaryDraft : null,
    rejectionNote:
      decision.status === "rejected" ? decision.note ?? null : null,
    reviewedAt: new Date().toISOString(),
    reviewedBy: decision.by,
  };
  await ddbPutArtifact(next);
  return next;
}
