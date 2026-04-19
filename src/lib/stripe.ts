// Server-only: never import from a "use client" module.
// Stripe SDK singleton. Uses test-mode keys in dev/sandbox.
// See https://docs.stripe.com/api for the underlying API.

import Stripe from "stripe";
import { env, requireEnv } from "./env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

export function getStripe(): Stripe {
  if (!g.__tinyfishStripe) {
    const key = requireEnv(env.stripe.secretKey, "STRIPE_SECRET_KEY");
    g.__tinyfishStripe = new Stripe(key);
  }
  return g.__tinyfishStripe as Stripe;
}

export function stripeConfigured(): boolean {
  return Boolean(env.stripe.secretKey);
}
