/**
 * FixMate Server - entry point
 * - Locally: `npm run dev` starts app.listen() on PORT.
 * - On Vercel: the app is exported (no listen) and Vercel runs it as a serverless function.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { connectDB } from "./config/db";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import serviceRoutes from "./routes/service.routes";
import adminRoutes from "./routes/admin.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentRoutes from "./routes/payment.routes";
import { stripeWebhook } from "./routes/webhook";

dotenv.config({ quiet: true }); // quiet: hides dotenv's startup log

const app = express();
const port = Number(process.env.PORT) || 5000;

/* ---------------------------------- CORS ---------------------------------- */
// We send cookies, so origins must be listed exactly (never "*") and credentials must be true.
// CLIENT_URLS is a comma-separated list, e.g. "http://localhost:3000,https://fixmate-client.vercel.app"
const allowedOrigins = (process.env.CLIENT_URLS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header = server-to-server call (Next.js rewrite, Stripe, curl) -> allow.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // Unknown origin: no CORS headers are sent, so the browser blocks it (no 500 error).
      return callback(null, false);
    },
    credentials: true,
  })
);

/* ----------------------------- Stripe webhook ----------------------------- */
// IMPORTANT: registered with express.raw() BEFORE express.json(), because Stripe's signature
// check needs the untouched raw body. (express.json() would turn it into an object first.)
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

/* ----------------------------- Body & cookies ----------------------------- */
app.use(express.json());
app.use(cookieParser());

/* --------------------------------- Routes --------------------------------- */
app.get("/", (_req: Request, res: Response) => {
  res.send("FixMate server is running 🔧");
});

// Health check: also pings MongoDB, so one URL proves the server AND the database work.
app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const db = await connectDB();
    await db.command({ ping: 1 });
    res.json({ ok: true, service: "fixmate-server", db: "connected", time: new Date().toISOString() });
  } catch (error) {
    console.error("❌ MongoDB health check failed:", error);
    res.status(503).json({ ok: false, service: "fixmate-server", db: "disconnected" });
  }
});

// Feature routes (more are added step by step)
app.use("/api", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
/* ------------------------------ 404 & errors ------------------------------ */
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Express 5 forwards errors from async handlers here automatically.
// Express 5 forwards errors from async handlers here automatically.
// Errors from express.json() carry a status (e.g. 400 for a broken JSON body) -> keep it.
type HttpError = Error & { status?: number; type?: string };
app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ message: "Invalid JSON in request body" });
    return;
  }
  console.error("❌", err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ message: status === 500 ? "Internal server error" : err.message });
});

/* --------------------------------- Start ---------------------------------- */
// Vercel sets VERCEL=1, so listen() only runs on your machine.
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`🚀 FixMate server on http://localhost:${port}`));
}

export default app;