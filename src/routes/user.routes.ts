/**
 * User routes.
 *   GET /api/users/me -> the logged-in user (from the JWT cookie). Handy for testing the
 *                        middlewares and for the client to double-check the current role.
 *   PATCH /api/users/profile -> update my name, phone, area, bio and photo (every role)
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyToken } from "../middlewares/auth";
import { validateProfileInput } from "../utils/validate";

const router = Router();

router.get("/me", verifyToken, (req: Request, res: Response) => {
  res.json(req.user);
});

// Email and role are NOT accepted here (read-only on the profile page; roles change via the admin API)
router.patch("/profile", verifyToken, async (req: Request, res: Response) => {
  const { data, error } = validateProfileInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  const { users, services } = await getCollections();
  // Only MY account: the filter uses the email from the token
  await users.updateOne({ email: req.user!.email }, { $set: { ...data, updatedAt: new Date() } });

  // Keep a technician's name on their service cards up to date.
  // (Bookings keep the name from the time of the request on purpose: they are a record.)
  if (req.user!.role === "technician" && data.name !== req.user!.name) {
    await services.updateMany({ technicianEmail: req.user!.email }, { $set: { technicianName: data.name } });
  }

  res.json({ success: true, message: "Profile updated", user: { ...data, email: req.user!.email } });
});

export default router;