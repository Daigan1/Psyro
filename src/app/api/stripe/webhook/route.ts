import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { finalizeBooking } from "@/lib/finalize-booking";

// POST /api/stripe/webhook — Stripe posts events here when Checkout succeeds.
// The raw body is required for signature verification, so we read it as text
// (Next.js App Router passes request.text() through untouched).
//
// Only `checkout.session.completed` with payment_status == "paid" finalizes
// a booking. Duplicate events (Stripe retries) are handled idempotently via
// finalizeBooking's pendingBooking.appointmentId guard.

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  if (!env.stripe.webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret not configured." },
      { status: 500 },
    );
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      env.stripe.webhookSecret,
    );
  } catch (err) {
    console.error("[stripe] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    // Ack and drop — Stripe just needs a 2xx so it stops retrying.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const pendingId = session.metadata?.pendingBookingId;
  if (!pendingId) {
    console.error("[stripe] checkout.session.completed missing pendingBookingId");
    return NextResponse.json({ received: true });
  }

  const result = await finalizeBooking({
    pendingId,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
  });

  if (result.kind === "pending-missing") {
    console.error(`[stripe] no pending booking for ${pendingId}`);
  } else if (result.kind === "slot-taken") {
    console.error(
      `[stripe] pending ${pendingId} paid but slot is taken; manual refund required`,
    );
  }

  return NextResponse.json({ received: true });
}
