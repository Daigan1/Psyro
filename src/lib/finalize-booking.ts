// Server-only: never import from a "use client" module.
// Shared booking-finalization logic used by both the Stripe webhook
// (/api/stripe/webhook) and the success-page status poll (/api/book/status).
// The webhook is authoritative in prod; the status endpoint calls this as a
// fallback when Stripe can't reach the webhook (e.g. local dev without
// `stripe listen`). Idempotent: repeated calls with the same pendingId no-op
// once the appointment exists.

import { randomUUID } from "node:crypto";
import {
  getAppointment,
  isSlotBooked,
  putAppointment,
} from "./appointments-store";
import { recordAudit } from "./audit-log";
import { sendEmail } from "./notifications";
import {
  getPendingBooking,
  markPendingBooked,
} from "./pending-bookings-store";
import { setClientCurrentProvider } from "./users-store";
import type { Appointment } from "./types";

export type FinalizeBookingResult =
  | { kind: "booked"; appointment: Appointment }
  | { kind: "already-booked"; appointment: Appointment }
  | { kind: "pending-missing" }
  | { kind: "slot-taken" };

export async function finalizeBooking(params: {
  pendingId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
}): Promise<FinalizeBookingResult> {
  const pending = await getPendingBooking(params.pendingId);
  if (!pending) return { kind: "pending-missing" };

  if (pending.appointmentId) {
    const existing = await getAppointment(pending.appointmentId);
    if (existing) return { kind: "already-booked", appointment: existing };
  }

  // Race guard: another booking claimed the slot after checkout started.
  if (await isSlotBooked(pending.providerId, pending.startTime)) {
    return { kind: "slot-taken" };
  }

  const appointment: Appointment = {
    id: `a_${randomUUID()}`,
    clientId: pending.clientId,
    clientEmail: pending.clientEmail,
    providerId: pending.providerId,
    providerName: pending.providerName,
    providerEmail: pending.providerEmail,
    startTime: pending.startTime,
    endTime: pending.endTime,
    status: "scheduled",
    format: pending.format,
    createdAt: new Date().toISOString(),
    pricePaidCents: pending.amountCents,
    stripeCheckoutSessionId: params.stripeCheckoutSessionId,
    stripePaymentIntentId: params.stripePaymentIntentId,
  };
  await putAppointment(appointment);
  // Claim the pending row synchronously before any awaits so a concurrent
  // webhook + status-poll can't both finalize.
  await markPendingBooked(pending.id, appointment.id);
  // Booking implies "this is who I'm working with now." A subsequent booking
  // with a different therapist (or an explicit Settings change) overwrites.
  await setClientCurrentProvider(
    appointment.clientId,
    appointment.providerId,
  );

  recordAudit({
    actorId: appointment.clientId,
    actorRole: "client",
    action: "appointment.booked",
    resource: "appointment",
    resourceId: appointment.id,
    metadata: {
      providerId: appointment.providerId,
      startTime: appointment.startTime,
      format: appointment.format,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId,
      pricePaidCents: pending.amountCents,
    },
  });

  const when = new Date(appointment.startTime).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  await Promise.all([
    sendEmail({
      kind: "appointment-booked",
      to: appointment.clientEmail,
      subject: `Your session with ${appointment.providerName} is booked`,
      body: `Your ${appointment.format} session with ${appointment.providerName} is scheduled for ${when}. Payment of $${(pending.amountCents / 100).toFixed(2)} was charged. You can join from your dashboard.`,
    }),
    sendEmail({
      kind: "appointment-booked",
      to: appointment.providerEmail,
      subject: `New appointment: ${when}`,
      body: `A client booked a ${appointment.format} session with you on ${when}.`,
    }),
  ]);

  return { kind: "booked", appointment };
}
