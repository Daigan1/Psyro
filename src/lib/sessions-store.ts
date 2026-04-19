// Server-only: never import from a "use client" module.
// Session lifecycle store keyed by appointmentId — consent, meeting id,
// joins, end. DDB-only, no cache. State transitions are implemented as
// read-modify-write; concurrent writers (client + provider both clicking
// "Join" at once) are rare and tolerable since every field is write-once
// after set.

import { ddbGetSession, ddbPutSession } from "./aws/dynamodb";
import type { ParticipantRole, SessionEndReason, SessionState } from "./types";

export async function getSession(
  appointmentId: string,
): Promise<SessionState | null> {
  return ddbGetSession(appointmentId);
}

export async function ensureSession(
  appointmentId: string,
  tenantId: string,
): Promise<SessionState> {
  const existing = await ddbGetSession(appointmentId);
  if (existing) return existing;
  const fresh: SessionState = {
    appointmentId,
    tenantId,
    consent: { client: null, provider: null },
    refused: null,
    meetingId: null,
    meetingUrl: null,
    recordingUrl: null,
    joined: { client: null, provider: null },
    endedAt: null,
    endReason: null,
  };
  await ddbPutSession(fresh);
  return fresh;
}

export async function putSession(session: SessionState): Promise<void> {
  await ddbPutSession(session);
}

export async function recordConsent(
  appointmentId: string,
  role: ParticipantRole,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  if (session.refused) {
    throw new Error("Session was declined — consent no longer possible");
  }
  if (session.endedAt) {
    throw new Error("Session already ended");
  }
  const now = new Date().toISOString();
  const next: SessionState = {
    ...session,
    consent: { ...session.consent, [role]: session.consent[role] ?? now },
  };
  await ddbPutSession(next);
  return next;
}

export async function recordRefusal(
  appointmentId: string,
  role: ParticipantRole,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  if (session.meetingId) {
    throw new Error("Meeting already started — cannot refuse consent now");
  }
  const next: SessionState = {
    ...session,
    refused: { by: role, at: new Date().toISOString() },
    endedAt: new Date().toISOString(),
    endReason: "no-consent",
  };
  await ddbPutSession(next);
  return next;
}

export async function setMeetingId(
  appointmentId: string,
  meetingId: string,
  meetingUrl: string | null = null,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  if (session.meetingId) return session;
  const next: SessionState = {
    ...session,
    meetingId,
    meetingUrl: meetingUrl ?? session.meetingUrl ?? null,
  };
  await ddbPutSession(next);
  return next;
}

export async function setRecordingUrl(
  appointmentId: string,
  recordingUrl: string,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  const next: SessionState = { ...session, recordingUrl };
  await ddbPutSession(next);
  return next;
}

export async function recordJoin(
  appointmentId: string,
  role: ParticipantRole,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  if (!session.meetingId) {
    throw new Error("Meeting not created yet");
  }
  const now = new Date().toISOString();
  const next: SessionState = {
    ...session,
    joined: { ...session.joined, [role]: session.joined[role] ?? now },
  };
  await ddbPutSession(next);
  return next;
}

export async function recordEnd(
  appointmentId: string,
  reason: SessionEndReason,
): Promise<SessionState> {
  const session = await ddbGetSession(appointmentId);
  if (!session) throw new Error(`Session ${appointmentId} not found`);
  if (session.endedAt) return session;
  const next: SessionState = {
    ...session,
    endedAt: new Date().toISOString(),
    endReason: reason,
  };
  await ddbPutSession(next);
  return next;
}

export function bothConsented(session: SessionState): boolean {
  return Boolean(session.consent.client && session.consent.provider);
}
