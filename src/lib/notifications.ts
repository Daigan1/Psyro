// Server-only: never import from a "use client" module.
// Notification layer. Sends real email via SES when SES_FROM_ADDRESS is
// configured; otherwise just logs to the console + an in-memory ring
// buffer visible via listNotifications() for dev / tests.

import { randomUUID } from "node:crypto";
import { env } from "./env";

export type NotificationKind =
  | "appointment-booked"
  | "appointment-cancelled"
  | "appointment-reminder"
  | "session-summary-approved";

export type NotificationChannel = "email";

export type NotificationRecord = {
  id: string;
  tenantId: string | null;
  kind: NotificationKind;
  channel: NotificationChannel;
  to: string;
  subject: string | null;
  body: string;
  sentAt: string;
  delivered: boolean;
  deliveryNote: string | null;
};

const MAX_LOG = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__tinyfishNotifications) {
  g.__tinyfishNotifications = [] as NotificationRecord[];
}
const log: NotificationRecord[] = g.__tinyfishNotifications;

export function listNotifications(tenantId?: string | null): NotificationRecord[] {
  const all = log.slice().reverse();
  return tenantId ? all.filter((n) => n.tenantId === tenantId) : all;
}

export async function sendEmail(input: {
  tenantId: string | null;
  kind: NotificationKind;
  to: string;
  subject: string;
  body: string;
}): Promise<NotificationRecord> {
  return record(
    "email",
    input.to,
    input.subject,
    input.body,
    input.kind,
    input.tenantId,
    async () => {
      if (env.ses.from) {
        const { sendSesEmail } = await import("./aws/ses");
        await sendSesEmail({
          to: input.to,
          subject: input.subject,
          html: escapeHtml(input.body).replace(/\n/g, "<br/>"),
          text: input.body,
        });
        return;
      }
      console.log(
        `[notify] email → ${input.to} · ${input.kind} · "${input.subject}"`,
      );
    },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function record(
  channel: NotificationChannel,
  to: string,
  subject: string | null,
  body: string,
  kind: NotificationKind,
  tenantId: string | null,
  deliver: () => Promise<void>,
): Promise<NotificationRecord> {
  const entry: NotificationRecord = {
    id: `ntf_${randomUUID()}`,
    tenantId,
    kind,
    channel,
    to,
    subject,
    body,
    sentAt: new Date().toISOString(),
    delivered: true,
    deliveryNote: null,
  };
  try {
    await deliver();
  } catch (err) {
    entry.delivered = false;
    entry.deliveryNote = (err as Error).message;
  }
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  return entry;
}
