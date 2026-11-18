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
// IMPORTANT (Server step 15): the Stripe webhook route is registered HERE, with express.raw(),
// BEFORE express.json(). Stripe's signature check needs the untouched raw body.

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

/* ------------------------------ 404 & errors ------------------------------ */
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Express 5 forwards errors from async handlers here automatically.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("❌", err);
  res.status(500).json({ message: "Internal server error" });
});

/* --------------------------------- Start ---------------------------------- */
// Vercel sets VERCEL=1, so listen() only runs on your machine.
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`🚀 FixMate server on http://localhost:${port}`));
}

export default app;