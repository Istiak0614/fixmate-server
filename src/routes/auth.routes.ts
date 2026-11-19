/**
 * Auth routes for the Express JWT (BetterAuth handles sign up / sign in on the client).
 *   POST /api/jwt     -> after BetterAuth sign-in, the client sends { email }; we set the JWT cookie
 *   POST /api/logout  -> clears the JWT cookie (called together with BetterAuth signOut)
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { TOKEN_COOKIE, cookieOptions, signToken } from "../utils/token";

const router = Router();

router.post("/jwt", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ message: "Email is required" });
    return;
  }

  // Only issue a token for a real account (BetterAuth has already saved it on sign up).
  const { users } = await getCollections();
  const user = await users.findOne({ email }, { projection: { email: 1, role: 1 } });
  if (!user) {
    res.status(404).json({ message: "No account found for this email" });
    return;
  }

  res.cookie(TOKEN_COOKIE, signToken({ email: user.email }), cookieOptions);
  res.json({ success: true, role: user.role });
});

router.post("/logout", (_req: Request, res: Response) => {
  // clearCookie must use the same options (except maxAge) or the browser keeps the cookie.
  const { maxAge: _maxAge, ...clearOptions } = cookieOptions;
  res.clearCookie(TOKEN_COOKIE, clearOptions);
  res.json({ success: true });
});

export default router;