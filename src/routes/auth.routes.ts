/**
 * Auth routes for the Express JWT (BetterAuth handles sign up / sign in on the client).
 *   POST /api/jwt     -> after BetterAuth sign-in, we set the JWT cookie for the signed-in user
 *   POST /api/logout  -> clears the JWT cookie (called together with BetterAuth signOut)
 *
 * SECURITY: the JWT is only issued for a REAL BetterAuth session. The browser calls /api/* on
 * the client's own domain (Next.js rewrite), so BetterAuth's session cookie reaches us too.
 * We look that session up in MongoDB and take the user from it. The email in the body is
 * never trusted on its own, so nobody can get a token for someone else's account.
 */
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { connectDB, getCollections } from "../config/db";
import { TOKEN_COOKIE, cookieOptions, signToken } from "../utils/token";

const router = Router();

// BetterAuth's cookie names: "__Secure-" prefix on HTTPS (live), plain name on http://localhost
const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

/** BetterAuth stores "<token>.<signature>" in the cookie; the session document holds <token>. */
function sessionTokenFrom(req: Request): string {
  for (const name of SESSION_COOKIES) {
    const value = req.cookies?.[name];
    if (typeof value === "string" && value) return decodeURIComponent(value).split(".")[0];
  }
  return "";
}

router.post("/jwt", async (req: Request, res: Response) => {
  const token = sessionTokenFrom(req);
  if (!token) {
    res.status(401).json({ message: "Please sign in first" });
    return;
  }

  const db = await connectDB();
  const session = await db.collection("session").findOne({ token, expiresAt: { $gt: new Date() } });
  if (!session) {
    res.status(401).json({ message: "Your session has expired. Please sign in again." });
    return;
  }

  // userId may be saved as an ObjectId or as a string, depending on the adapter version
  const userId = session.userId instanceof ObjectId ? session.userId : ObjectId.isValid(String(session.userId)) ? new ObjectId(String(session.userId)) : null;
  const { users } = await getCollections();
  const user = userId ? await users.findOne({ _id: userId }, { projection: { email: 1, role: 1 } }) : null;
  if (!user) {
    res.status(404).json({ message: "No account found for this session" });
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