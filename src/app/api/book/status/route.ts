import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPendingBooking } from "@/lib/pending-bookings-store";
import { getAppointment } from "@/lib/appointments-store";
import { finalizeBooking } from "@/lib/finalize-booking";
import { getStripe } from "@/lib/stripe";

// GET /api/book/status?pending=pb_... — lets the /booking/success page poll
// for the booking result. The Stripe webhook is authoritative, but if it
// hasn't arrived yet (common in local dev without `stripe listen`) we fall
// back to retrieving the Checkout Session directly and finalizing the
// appointment here. finalizeBooking is idempotent, so this is safe to run
// alongside the webhook.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pendingId = searchParams.get("pending");
  if (!pendingId) {
    return NextResponse.json(
      { error: "pending query param required" },
      { status: 400 },
    );
  }

  const pending = await getPendingBooking(pendingId);
  if (!pending) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pending.clientId !== user.clientId) {
    return NextResponse.json(
      { error: "Not your booking" },
      { status: 403 },
    );
  }

  if (pending.appointmentId) {
    const appointment = await getAppointment(pending.appointmentId);
    return NextResponse.json({
      ready: true,
      appointmentId: pending.appointmentId,
      appointment,
    });
  }

  // Webhook hasn't finalized yet — try reading the Checkout Session directly.
  if (pending.checkoutSessionId) {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(
      pending.checkoutSessionId,
    );
    if (session.payment_status === "paid") {
      const result = await finalizeBooking({
        pendingId: pending.id,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
      });
      if (result.kind === "booked" || result.kind === "already-booked") {
        return NextResponse.json({
          ready: true,
          appointmentId: result.appointment.id,
          appointment: result.appointment,
        });
      }
      if (result.kind === "slot-taken") {
        return NextResponse.json(
          {
            error:
              "That time was booked by someone else after your payment. Contact support for a refund.",
          },
          { status: 409 },
        );
      }
    }
  }

  return NextResponse.json({ ready: false });
}
