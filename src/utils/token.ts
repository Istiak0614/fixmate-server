/**
 * JWT helpers + the cookie settings used everywhere.
 * The token only carries the user's email. The ROLE is always read fresh from the
 * database by the middlewares, so an admin's role change takes effect immediately.
 */
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { CookieOptions } from "express";

export const TOKEN_COOKIE = "fixmate_token";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type TokenPayload = { email: string };

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing. Add it to .env (local) or Vercel env vars.");
  return secret;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

/** Throws if the token is invalid or expired. */
export function verifyJwtToken(token: string): TokenPayload & JwtPayload {
  return jwt.verify(token, getSecret()) as TokenPayload & JwtPayload;
}

/**
 * httpOnly  -> JavaScript in the browser can't read it (protects against XSS token theft)
 * secure    -> HTTPS only in production (localhost is http, so off in development)
 * sameSite  -> "lax": the browser and API are the SAME site thanks to the Next.js rewrite,
 *              and lax still sends the cookie when Stripe redirects back to our success page.
 */
export const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SEVEN_DAYS_MS,
};