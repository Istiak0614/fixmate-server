/**
 * Stripe client (test mode). Created on first use, so a missing key gives a clear error
 * on the payment routes instead of crashing the whole server at start-up.
 */
import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing. Add it to .env (local) or Vercel env vars.");
  if (!key.startsWith("sk_test_")) throw new Error("Use a Stripe TEST key (sk_test_...) for this project.");
  stripe ??= new Stripe(key);
  return stripe;
}

/** Where Stripe sends the customer back to (our Next.js app). */
export function clientUrl(): string {
  return (process.env.CLIENT_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
}