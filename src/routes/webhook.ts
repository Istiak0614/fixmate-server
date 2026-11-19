/**
 * Challenge 4: Stripe webhook  ->  POST /api/payments/webhook
 *
 * Stripe calls this URL directly (server to server) after a payment. We:
 *   1. verify the "stripe-signature" header with STRIPE_WEBHOOK_SECRET (rejects fake calls),
 *   2. save the payment with the SAME save-once function as the success page.
 * So whichever arrives first — webhook or success page — the payment is saved exactly once.
 *
 * IMPORTANT: this handler needs the RAW request body for the signature check, so in index.ts it
 * is registered with express.raw() BEFORE app.use(express.json()).
 */
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe } from "../config/stripe";
import { saveJobPayment } from "../utils/savePayment";

export async function stripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    res.status(400).json({ message: "Missing Stripe signature or webhook secret" });
    return;
  }

  // 1. Is this really from Stripe? (req.body is a Buffer here thanks to express.raw)
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, secret);
  } catch (error) {
    console.error("❌ Webhook signature verification failed:", (error as Error).message);
    res.status(400).json({ message: "Webhook signature verification failed" });
    return;
  }

  // 2. Handle the events we care about; everything else is acknowledged and ignored.
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.metadata?.type === "job") {
        const result = await saveJobPayment(session);
        if (result.ok) {
          console.log(`✅ Webhook: payment ${result.alreadySaved ? "was already saved" : "saved"} for ${session.id}`);
        } else {
          // e.g. not paid yet: answer 200 anyway, retrying would not change anything
          console.warn(`⚠️ Webhook: ${result.message} (${session.id})`);
        }
      }
      // (Pro subscription events are added in Server step 16.)
      break;
    }
  }

  // A database error above throws -> Express answers 500 -> Stripe retries later (safe: save-once).
  res.json({ received: true });
}