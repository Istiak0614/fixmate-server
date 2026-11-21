/**
 * Pro Technician Plan (optional feature) — mounted at /api/subscriptions. Technicians only.
 *   GET  /api/subscriptions/me                -> my plan, service count/limit, next renewal date
 *   POST /api/subscriptions/checkout          -> Stripe Checkout URL for $9.99/month
 *   GET  /api/subscriptions/verify?session_id -> success page: activate Pro (once) without waiting for the webhook
 *   POST /api/subscriptions/cancel            -> cancel the Stripe subscription, back to Free
 *
 * The webhook (webhook.ts) keeps the plan in sync with Stripe (renewals, cancellations, failed payments).
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { clientUrl, getStripe } from "../config/stripe";
import { verifyTechnician, verifyToken } from "../middlewares/auth";
import { activatePro, FREE_SERVICE_LIMIT, PRO_PRICE_CENTS, setPlan } from "../utils/subscription";

const router = Router();
router.use(verifyToken, verifyTechnician);

router.get("/me", async (req: Request, res: Response) => {
  const { users, services } = await getCollections();
  const [user, serviceCount] = await Promise.all([
    users.findOne({ email: req.user!.email }, { projection: { plan: 1, stripeSubscriptionId: 1 } }),
    services.countDocuments({ technicianEmail: req.user!.email }),
  ]);
  const plan = user?.plan ?? "free";

  // Next renewal date, straight from Stripe (not critical: skip it if Stripe is unreachable)
  let renewsAt: string | null = null;
  if (plan === "pro" && user?.stripeSubscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(user.stripeSubscriptionId);
      const end = sub.items.data[0]?.current_period_end;
      if (end) renewsAt = new Date(end * 1000).toISOString();
    } catch (error) {
      console.warn("Could not read the subscription from Stripe:", (error as Error).message);
    }
  }

  res.json({
    plan,
    price: PRO_PRICE_CENTS / 100,
    serviceCount,
    serviceLimit: plan === "pro" ? null : FREE_SERVICE_LIMIT, // null = unlimited
    renewsAt,
  });
});

router.post("/checkout", async (req: Request, res: Response) => {
  if (req.user!.plan === "pro") {
    res.status(409).json({ message: "You are already on the Pro plan" });
    return;
  }

  const metadata = { type: "subscription", userEmail: req.user!.email };
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: req.user!.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRO_PRICE_CENTS, // price is fixed on the server
          recurring: { interval: "month" },
          product_data: { name: "FixMate Pro Technician Plan", description: "Unlimited services and a Verified Pro badge" },
        },
      },
    ],
    metadata, // on the Checkout Session (checkout.session.completed)
    subscription_data: { metadata }, // copied to the subscription + its invoices (renewal webhooks)
    success_url: `${clientUrl()}/dashboard/technician/plan?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl()}/dashboard/technician/plan?canceled=1`,
  });

  res.json({ url: session.url });
});

router.get("/verify", async (req: Request, res: Response) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({ message: "Invalid session id" });
    return;
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(404).json({ message: "Checkout session not found" });
    return;
  }
  if (session.metadata?.userEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this checkout belongs to another account" });
    return;
  }

  const result = await activatePro(session);
  if (!result.ok) {
    res.status(400).json({ message: result.message });
    return;
  }
  res.json({ success: true, plan: "pro", message: result.message });
});

router.post("/cancel", async (req: Request, res: Response) => {
  const { users } = await getCollections();
  const user = await users.findOne({ email: req.user!.email }, { projection: { plan: 1, stripeSubscriptionId: 1 } });
  if (user?.plan !== "pro" || !user.stripeSubscriptionId) {
    res.status(400).json({ message: "You don't have an active Pro plan" });
    return;
  }

  // Cancel right away (simple to demo in test mode). Stripe also sends
  // "customer.subscription.deleted" to the webhook, which sets the same Free plan again (harmless).
  try {
    await getStripe().subscriptions.cancel(user.stripeSubscriptionId);
  } catch (error) {
    // Already cancelled on Stripe's side? Then just finish the downgrade here.
    if ((error as { code?: string }).code !== "resource_missing") throw error;
  }
  await setPlan(req.user!.email, "free", { stripeSubscriptionId: null });

  res.json({ success: true, plan: "free", message: "Pro plan cancelled. You are back on the Free plan." });
});

export default router;