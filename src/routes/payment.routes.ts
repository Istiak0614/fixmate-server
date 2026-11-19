/**
 * Payment routes (mounted at /api/payments).
 *   POST /api/payments/create-checkout-session  verifyToken + verifyCustomer -> Stripe Checkout URL
 * Coming next: verify + history (Server 14), webhook (Server 15).
 *
 * Challenge 3 "payment gate": only for a booking that is completed + unpaid AND belongs to the
 * logged-in customer. The amount ALWAYS comes from booking.finalAmount in the database.
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { clientUrl, getStripe } from "../config/stripe";
import { verifyCustomer, verifyToken } from "../middlewares/auth";
import { toObjectId } from "../utils/objectId";

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

export default router;