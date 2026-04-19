// Server-only: never import from a "use client" module.
// Append-only audit log. In-memory ring buffer for dev; swap for DynamoDB
// (immutable writes, stream to S3 for long-term retention) when USE_AWS=true.

import { randomUUID } from "node:crypto";

export type AuditActorRole = "client" | "provider" | "system";

export type AuditAction =
  | "auth.sign-in"
  | "auth.sign-out"
  | "appointment.booked"
  | "appointment.cancelled"
  | "appointment.rescheduled"
  | "session.consent"
  | "session.refused"
  | "session.started"
  | "session.ended"
  | "artifact.transcript-edited"
  | "artifact.summary-generated"
  | "artifact.summary-edited"
  | "artifact.approved"
  | "artifact.rejected"
  | "resource.created"
  | "resource.deleted"
  | "qa.asked"
  | "client.current-provider-changed"
  | "client.preferences-updated"
  | "provider.profile-updated"
  | "provider.availability-updated";

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorRole: AuditActorRole;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  at: string;
};

const MAX_LOG = 1_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__tinyfishAudit) {
  g.__tinyfishAudit = [] as AuditEntry[];
}
const log: AuditEntry[] = g.__tinyfishAudit;

export function recordAudit(input: Omit<AuditEntry, "id" | "at">): AuditEntry {
  const entry: AuditEntry = {
    ...input,
    id: `aud_${randomUUID()}`,
    at: new Date().toISOString(),
  };
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  return entry;
}

export function listAudit(opts: {
  actorId?: string;
  action?: AuditAction;
  limit?: number;
}): AuditEntry[] {
  const limit = opts.limit ?? 200;
  const all = log.slice().reverse();
  return all
    .filter((e) =>
      (opts.actorId === undefined || e.actorId === opts.actorId) &&
      (opts.action === undefined || e.action === opts.action),
    )
    .slice(0, limit);
}
