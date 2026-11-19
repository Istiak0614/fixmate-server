/**
 * Payment routes (mounted at /api/payments).
 *   POST /api/payments/create-checkout-session  verifyToken + verifyCustomer -> Stripe Checkout URL
 *   GET  /api/payments/verify?session_id=...    verifyToken + verifyCustomer -> save the payment (once)
 *   GET  /api/payments/my                       verifyToken + verifyCustomer -> my payment history
 *   GET  /api/payments/:id                      verifyToken + verifyCustomer (owner) -> one payment (invoice)
 * Coming next: webhook (Server 15).
 * Challenge 3 "payment gate": only for a booking that is completed + unpaid AND belongs to the
 * logged-in customer. The amount ALWAYS comes from booking.finalAmount in the database.
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { clientUrl, getStripe } from "../config/stripe";
import { verifyCustomer, verifyToken } from "../middlewares/auth";
import { toObjectId } from "../utils/objectId";
import { saveJobPayment } from "../utils/savePayment";

const router = Router();

router.post("/create-checkout-session", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const bookingId = typeof req.body?.bookingId === "string" ? req.body.bookingId : "";
  const _id = toObjectId(bookingId);
  if (!_id) {
    res.status(400).json({ message: "Invalid booking id" });
    return;
  }

  const { bookings } = await getCollections();
  const booking = await bookings.findOne({ _id });
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }

  // ---- Payment gate (Challenge 3) ----
  if (booking.customerEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this is not your booking" });
    return;
  }
  if (booking.paymentStatus === "paid") {
    res.status(400).json({ message: "This job is already paid" });
    return;
  }
  if (booking.status !== "completed") {
    res.status(400).json({ message: "You can pay only after the technician completes the job" });
    return;
  }
  if (!(booking.finalAmount > 0)) {
    res.status(400).json({ message: "The final amount for this job is not set" });
    return;
  }

  const stripe = getStripe();

  // Pay Now clicked twice (two tabs, double click)? Reuse the still-open Checkout page
  // instead of creating a second one — so the customer can never be charged twice.
  if (booking.checkoutSessionId) {
    const previous = await stripe.checkout.sessions.retrieve(booking.checkoutSessionId);
    if (previous.status === "open" && previous.url) {
      res.json({ url: previous.url });
      return;
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: req.user!.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(booking.finalAmount * 100), // dollars -> cents, from the DATABASE
          product_data: {
            name: booking.serviceTitle,
            description: `Repair by ${booking.technicianName}`,
          },
        },
      },
    ],
    // Read back by the verify route and the webhook
    metadata: { type: "job", bookingId, customerEmail: req.user!.email },
    success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl()}/payment/cancel`,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // page expires after 31 min (Stripe minimum is 30)
  });

  await bookings.updateOne({ _id }, { $set: { checkoutSessionId: session.id } });
  res.json({ url: session.url });
});
// Success page: /payment/success?session_id=cs_test_... calls this.
// Safe to call again (reload): the payment is saved only once (see utils/savePayment.ts).
router.get("/verify", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? "");
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({ message: "Invalid payment session" });
    return;
  }

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(404).json({ message: "Payment session not found" });
    return;
  }

  // Only the customer who paid can verify it
  if (session.metadata?.customerEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this payment belongs to another account" });
    return;
  }

  const result = await saveJobPayment(session);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  const { payment } = result;
  res.json({
    success: true,
    paymentId: payment._id,
    amount: payment.amount,
    transactionId: payment.transactionId,
    serviceTitle: payment.serviceTitle,
    paidAt: payment.paidAt,
  });
});

// Payment history (customer): only MY job payments, newest first
router.get("/my", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const { payments } = await getCollections();
  const list = await payments
    .find({ customerEmail: req.user!.email, type: "job" })
    .sort({ paidAt: -1 })
    .toArray();
  res.json(list);
});

// One payment (for the PDF invoice) — only the customer who paid can read it
router.get("/:id", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(404).json({ message: "Payment not found" });
    return;
  }
  const { payments } = await getCollections();
  const payment = await payments.findOne({ _id });
  if (!payment) {
    res.status(404).json({ message: "Payment not found" });
    return;
  }
  if (payment.customerEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this is not your payment" });
    return;
  }
  res.json(payment);
});

export default router;