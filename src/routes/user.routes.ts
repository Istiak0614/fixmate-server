/**
 * User routes.
 *   GET /api/users/me -> the logged-in user (from the JWT cookie). Handy for testing the
 *                        middlewares and for the client to double-check the current role.
 *   (PATCH /api/users/profile is added in Server step 12.)
 */
import { Router, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth";

const router = Router();

router.get("/me", verifyToken, (req: Request, res: Response) => {
  res.json(req.user);
});

export default router;