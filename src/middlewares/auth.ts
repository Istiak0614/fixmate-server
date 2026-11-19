/**
 * Challenge 2: JWT verification + role-based middlewares.
 *
 *   verifyToken       -> 401 if there is no valid token cookie; otherwise loads the user from
 *                        the DB and puts it on req.user (fresh role, every request)
 *   verifyCustomer    -> 403 unless req.user.role === "customer"
 *   verifyTechnician  -> 403 unless req.user.role === "technician"
 *   verifyAdmin       -> 403 unless req.user.role === "admin"
 *
 * Always use verifyToken FIRST:  router.post("/", verifyToken, verifyCustomer, handler)
 */
import type { NextFunction, Request, Response } from "express";
import { getCollections } from "../config/db";
import { TOKEN_COOKIE, verifyJwtToken } from "../utils/token";
import type { Role } from "../types";

export async function verifyToken(req: Request, res: Response, next: NextFunction) {
  const token: string | undefined = req.cookies?.[TOKEN_COOKIE];
  if (!token) {
    res.status(401).json({ message: "Unauthorized: please sign in" });
    return;
  }

  // 1. Is the token real and not expired?
  let email: string;
  try {
    email = verifyJwtToken(token).email;
  } catch {
    res.status(401).json({ message: "Unauthorized: invalid or expired token" });
    return;
  }

  // 2. Does the account still exist? Read the CURRENT role from the database.
  const { users } = await getCollections();
  const user = await users.findOne(
    { email },
    { projection: { name: 1, email: 1, role: 1, image: 1, plan: 1 } }
  );
  if (!user) {
    res.status(401).json({ message: "Unauthorized: account not found" });
    return;
  }

  req.user = {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role ?? "customer",
    image: user.image ?? null,
    plan: user.plan ?? "free",
  };
  next();
}

/** Builds a middleware that only lets one role through. */
function allowRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      // verifyToken was not used before this middleware
      res.status(401).json({ message: "Unauthorized: please sign in" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ message: `Forbidden: ${role}s only` });
      return;
    }
    next();
  };
}

export const verifyCustomer = allowRole("customer");
export const verifyTechnician = allowRole("technician");
export const verifyAdmin = allowRole("admin");