// Server-only: never import from a "use client" module.
// Bookable intent between "client clicks Book" and the Stripe webhook
// confirming payment. DDB-only — the Stripe webhook and the success-page
// status poll hit different server instances, so these rows must be
// cross-process. DynamoDB TTL (48h) reaps unfinalized rows.

import {
  ddbGetPendingBooking,
  ddbPutPendingBooking,
} from "./aws/dynamodb";
import type { PendingBooking } from "./types";

export type { PendingBooking } from "./types";

export async function putPendingBooking(b: PendingBooking): Promise<void> {
  await ddbPutPendingBooking(b);
}

export async function getPendingBooking(
  id: string,
): Promise<PendingBooking | null> {
  return ddbGetPendingBooking(id);
}

export async function attachCheckoutSession(
  id: string,
  sessionId: string,
): Promise<void> {
  const existing = await ddbGetPendingBooking(id);
  if (!existing) return;
  await ddbPutPendingBooking({ ...existing, checkoutSessionId: sessionId });
}

export async function markPendingBooked(
  id: string,
  appointmentId: string,
): Promise<PendingBooking | null> {
  const existing = await ddbGetPendingBooking(id);
  if (!existing) return null;
  const next: PendingBooking = { ...existing, appointmentId };
  await ddbPutPendingBooking(next);
  return next;
}
