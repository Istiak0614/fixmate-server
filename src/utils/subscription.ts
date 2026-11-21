/**
 * Pro Technician Plan helpers (optional feature), shared by the subscription routes and the webhook.
 *
 * The plan is stored on the user ("free" | "pro") and copied to each of their services as
 * `technicianPlan`, so service cards can show the "Verified Pro" badge without an extra lookup
 * (same idea as `technicianName`).
 *
 * Every function is safe to call more than once (webhook retries, success page + webhook).
 */
import { MongoServerError } from "mongodb";
import type Stripe from "stripe";
import { getCollections } from "../config/db";
import type { PaymentDoc } from "../types";

export const PRO_PRICE_CENTS = 999; // $9.99 / month — set on the server, never taken from the client
export const FREE_SERVICE_LIMIT = 3;

type Plan = "free" | "pro";

/** Change a technician's plan (and the badge on all of their services). */
export async function setPlan(email: string, plan: Plan, extra: Record<string, unknown> = {}) {
  const { users, services } = await getCollections();
  await users.updateOne({ email }, { $set: { plan, ...extra, updatedAt: new Date() } });
  await services.updateMany({ technicianEmail: email }, { $set: { technicianPlan: plan } });
}

/**
 * Save one Pro plan payment. The Stripe INVOICE id is the unique key here (stored in
 * stripeSessionId, which has a unique index): the first month can be reported by both the
 * success page and the "invoice.paid" webhook, but it is saved once.
 */
export async function saveSubscriptionPayment(p: {
  invoiceId: string;
  amountCents: number;
  email: string;
  transactionId: string;
}) {
  const { users, payments } = await getCollections();
  const user = await users.findOne({ email: p.email }, { projection: { name: 1 } });
  const name = user?.name ?? p.email;

  const payment: PaymentDoc = {
    type: "subscription",
    serviceTitle: "Pro Technician Plan (1 month)",
    customerName: name, // the payer is the technician
    customerEmail: p.email,
    technicianName: name,
    technicianEmail: p.email,
    amount: p.amountCents / 100,
    currency: "usd",
    transactionId: p.transactionId,
    stripeSessionId: p.invoiceId,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await payments.insertOne(payment);
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error; // already saved
  }
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? "");

/**
 * A finished subscription Checkout -> make the technician Pro and save the first payment.
 * Used by GET /api/subscriptions/verify (success page) and by the webhook.
 */
export async function activatePro(session: Stripe.Checkout.Session): Promise<{ ok: boolean; message: string }> {
  const email = session.metadata?.userEmail;
  if (session.mode !== "subscription" || session.metadata?.type !== "subscription" || !email) {
    return { ok: false, message: "Not a Pro plan checkout" };
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { ok: false, message: "The Pro plan payment is not completed" };
  }

  const subscriptionId = idOf(session.subscription);
  await setPlan(email, "pro", { stripeSubscriptionId: subscriptionId, stripeCustomerId: idOf(session.customer) });

  const invoiceId = idOf(session.invoice);
  if (invoiceId) {
    await saveSubscriptionPayment({
      invoiceId,
      amountCents: session.amount_total ?? PRO_PRICE_CENTS,
      email,
      transactionId: subscriptionId || session.id,
    });
  }
  return { ok: true, message: "You are now a Pro technician" };
}