/**
 * Service routes (mounted at /api/services).
 *   POST /api/services        verifyToken + verifyTechnician  -> add a service (always "pending")
 *   GET  /api/services/mine   verifyToken + verifyTechnician  -> the logged-in technician's services
 * Coming next: edit / availability / delete (Server 6), public list + details (Server 9).
 * NOTE: "/mine" must stay ABOVE "/:id" (added later), or Express would treat "mine" as an id.
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyTechnician, verifyToken } from "../middlewares/auth";
import { validateServiceInput } from "../utils/validate";
import type { ServiceDoc } from "../types";

const router = Router();

router.post("/", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const { data, error } = validateServiceInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  // (The Free-plan limit of 3 services is added in Server step 16 with the Pro plan.)

  const service: ServiceDoc = {
    ...data,
    // Owner info comes from the verified token, NEVER from the request body
    technicianName: req.user!.name,
    technicianEmail: req.user!.email,
    approvalStatus: "pending", // only an admin can approve
    isAvailable: true,
    createdAt: new Date(),
  };

  const { services } = await getCollections();
  const result = await services.insertOne(service);

  res.status(201).json({
    success: true,
    insertedId: result.insertedId,
    message: "Service submitted. It will appear publicly after admin approval.",
  });
});

router.get("/mine", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const { services } = await getCollections();
  const myServices = await services
    .find({ technicianEmail: req.user!.email }) // only MY services
    .sort({ createdAt: -1 })
    .toArray();
  res.json(myServices);
});

export default router;