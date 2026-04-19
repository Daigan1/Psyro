import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { SessionFormat } from "@/lib/types";
import { getAvailability, getTherapist } from "@/lib/mock-availability";
import { isSlotBooked } from "@/lib/appointments-store";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import {
  attachCheckoutSession,
  putPendingBooking,
} from "@/lib/pending-bookings-store";

type BookRequest = {
  providerId: string;
  startTime: string;
  format: Exclude<SessionFormat, "either">;
};

// POST /api/book — creates a Stripe Checkout Session for the per-session fee
// and returns its URL. The Appointment record isn't written here — the
// Stripe webhook handler at /api/stripe/webhook finalizes the booking on
// `checkout.session.completed`. This keeps payment and fulfillment
// idempotent and matches Stripe's recommended pattern.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") {
    return NextResponse.json(
      { error: "Sign in to book an appointment." },
      { status: 401 },
    );
  }
  const clientId = user.clientId!;

  let body: BookRequest;
  try {
    body = (await request.json()) as BookRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.providerId || !body.startTime || !body.format) {
    return NextResponse.json(
      { error: "providerId, startTime, and format are required" },
      { status: 400 },
    );
  }

  const therapist = await getTherapist(body.providerId);
  if (!therapist) {
    return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
  }

  const avail = await getAvailability(body.providerId);
  const slot = avail.find((s) => s.startTime === body.startTime);
  if (!slot) {
    return NextResponse.json(
      { error: "That time is no longer offered by this therapist." },
      { status: 409 },
    );
  }

  if (await isSlotBooked(body.providerId, body.startTime)) {
    return NextResponse.json(
      { error: "That time was just booked. Pick another." },
      { status: 409 },
    );
  }

  if (!therapist.sessionFormats.includes(body.format)) {
    return NextResponse.json(
      { error: `This therapist doesn't offer ${body.format} sessions.` },
      { status: 400 },
    );
  }

  if (therapist.ratePerSessionCents < 100) {
    return NextResponse.json(
      { error: "This therapist hasn't set a session rate yet." },
      { status: 409 },
    );
  }

  const pendingId = `pb_${randomUUID()}`;
  await putPendingBooking({
    id: pendingId,
    tenantId: therapist.tenantId,
    providerId: therapist.id,
    providerName: therapist.name,
    providerEmail: `${therapist.id}@demo.local`,
    clientId,
    clientEmail: user.email,
    startTime: slot.startTime,
    endTime: slot.endTime,
    format: body.format,
    amountCents: therapist.ratePerSessionCents,
    createdAt: new Date().toISOString(),
    appointmentId: null,
    checkoutSessionId: null,
  });

  const stripe = getStripe();
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: therapist.ratePerSessionCents,
          product_data: {
            name: `Therapy session with ${therapist.name}`,
            description: `${body.format} session · ${new Date(slot.startTime).toUTCString()}`,
          },
        },
      },
    ],
    // Surface pendingId on both the metadata and the session id so the
    // webhook and success-page lookups can both resolve the booking.
    metadata: { pendingBookingId: pendingId },
    success_url: `${env.stripe.appBaseUrl}/booking/success?pending=${pendingId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.stripe.appBaseUrl}/booking/${therapist.id}`,
  });

  if (!checkout.url) {
    return NextResponse.json(
      { error: "Stripe didn't return a checkout URL." },
      { status: 502 },
    );
  }

  await attachCheckoutSession(pendingId, checkout.id);

  return NextResponse.json({ checkoutUrl: checkout.url, pendingId });
}
