/**
 * Saves a PAID Stripe Checkout Session — used by BOTH the success-page verify route and the
 * webhook (Challenge 4). It can be called many times for the same session (page reload,
 * webhook + success page, Stripe retrying the webhook) and the payment is still saved ONCE:
 *
 *   1. insert the payment  -> the UNIQUE index on stripeSessionId rejects any second insert
 *   2. mark the booking paid -> the filter { paymentStatus: "unpaid" } makes this a one-time change
 *
 * Step 2 also runs when step 1 finds an existing payment, so a save that was interrupted
 * half-way is completed by the next call.
 */
import { MongoServerError } from "mongodb";
import type Stripe from "stripe";
import { getCollections } from "../config/db";
import { toObjectId } from "./objectId";
import type { PaymentDoc } from "../types";

type Collections = Awaited<ReturnType<typeof getCollections>>;

export type SaveResult =
  | { ok: true; payment: PaymentDoc; alreadySaved: boolean }
  | { ok: false; status: number; message: string };

export async function saveJobPayment(
  session: Stripe.Checkout.Session,
  collections?: Collections // (can be passed in tests; normally the real database)
): Promise<SaveResult> {
  if (session.payment_status !== "paid") {
    return { ok: false, status: 400, message: "Payment is not completed" };
  }

  const bookingId = session.metadata?.bookingId ?? "";
  const _id = toObjectId(bookingId);
  const { bookings, payments } = collections ?? (await getCollections());
  const booking = _id ? await bookings.findOne({ _id }) : null;
  if (!_id || !booking) {
    return { ok: false, status: 404, message: "Booking for this payment was not found" };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  const payment: PaymentDoc = {
    type: "job",
    bookingId,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: (session.amount_total ?? 0) / 100, // what Stripe actually charged, cents -> dollars
    currency: "usd",
    transactionId: paymentIntentId ?? session.id,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  // 1. Insert once
  let saved: PaymentDoc = payment;
  let alreadySaved = false;
  try {
    const result = await payments.insertOne(payment);
    saved = { ...payment, _id: result.insertedId };
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    alreadySaved = true; // duplicate key -> this session was saved before
    saved = (await payments.findOne({ stripeSessionId: session.id })) ?? payment;
  }

  // 2. Mark the booking paid (only changes an unpaid booking, so it happens once)
  await bookings.updateOne(
    { _id, paymentStatus: "unpaid" },
    { $set: { paymentStatus: "paid" }, $push: { statusHistory: { status: "paid", changedAt: saved.paidAt } } }
  );

  return { ok: true, payment: saved, alreadySaved };
}