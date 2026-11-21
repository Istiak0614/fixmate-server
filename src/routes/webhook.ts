/**
 * Challenge 4: Stripe webhook  ->  POST /api/payments/webhook
 *
 * Stripe calls this URL directly (server to server) after a payment. We:
 *   1. verify the "stripe-signature" header with STRIPE_WEBHOOK_SECRET (rejects fake calls),
 *   2. save the payment with the SAME save-once function as the success page,
 *   3. keep the Pro Technician Plan in sync (subscription start, renewals, cancellation).
 * So whichever arrives first — webhook or success page — the payment is saved exactly once.
 *
 * IMPORTANT: this handler needs the RAW request body for the signature check, so in index.ts it
 * is registered with express.raw() BEFORE app.use(express.json()).
 */
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe } from "../config/stripe";
import { getCollections } from "../config/db";
import { saveJobPayment } from "../utils/savePayment";
import { activatePro, saveSubscriptionPayment, setPlan } from "../utils/subscription";

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
      if (session.metadata?.type === "subscription") {
        const result = await activatePro(session);
        console.log(`${result.ok ? "✅" : "⚠️"} Webhook: ${result.message} (${session.id})`);
      }
      break;
    }

    // Every paid month of the Pro plan (first month AND renewals) -> one payment row
    case "invoice.paid": {
      const invoice = event.data.object;
      const details = invoice.parent?.subscription_details;
      const email = details?.metadata?.userEmail;
      if (details?.metadata?.type === "subscription" && email && invoice.amount_paid > 0) {
        const subscriptionId = typeof details.subscription === "string" ? details.subscription : details.subscription?.id ?? "";
        await saveSubscriptionPayment({ invoiceId: invoice.id!, amountCents: invoice.amount_paid, email, transactionId: subscriptionId || invoice.id! });
        await setPlan(email, "pro", { stripeSubscriptionId: subscriptionId }); // a renewal keeps them Pro
        console.log(`✅ Webhook: Pro plan payment saved for ${email}`);
      }
      break;
    }

    // Subscription changed or ended (cancelled, payment failed for good...) -> plan follows Stripe
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const email = sub.metadata?.userEmail;
      if (sub.metadata?.type !== "subscription" || !email) break;

      // Only react to the user's CURRENT subscription (an old one ending must not downgrade them)
      const { users } = await getCollections();
      const user = await users.findOne({ email }, { projection: { stripeSubscriptionId: 1 } });
      if (user?.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) break;

      const active = event.type === "customer.subscription.updated" && (sub.status === "active" || sub.status === "trialing");
      // keep the id while the subscription still exists, so a recovered payment can make them Pro again
      const ended = event.type === "customer.subscription.deleted";
      await setPlan(email, active ? "pro" : "free", { stripeSubscriptionId: ended ? null : sub.id });
      console.log(`✅ Webhook: ${email} is now on the ${active ? "Pro" : "Free"} plan (${sub.status})`);
      break;
    }
  }

  // A database error above throws -> Express answers 500 -> Stripe retries later (safe: save-once).
  res.json({ received: true });
}