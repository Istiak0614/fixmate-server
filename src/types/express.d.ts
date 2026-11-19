/**
 * Adds `req.user` to Express' Request type.
 * verifyToken fills it from the database, so every protected route can use req.user safely.
 */
import type { Role } from "./index";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  image: string | null;
  plan: "free" | "pro";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}