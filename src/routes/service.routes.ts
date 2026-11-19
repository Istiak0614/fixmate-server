/**
 * Service routes (mounted at /api/services).
 *   POST   /api/services                   verifyToken + verifyTechnician -> add a service (always "pending")
 *   GET    /api/services/mine              verifyToken + verifyTechnician -> the logged-in technician's services
 *   PATCH  /api/services/:id               verifyToken + verifyTechnician (owner) -> edit, back to "pending"
 *   PATCH  /api/services/:id/availability  verifyToken + verifyTechnician (owner) -> turn on/off
 *   DELETE /api/services/:id               verifyToken + verifyTechnician (owner) -> delete
 * Coming next: public list + details (Server 9).
 * NOTE: "/mine" must stay ABOVE "GET /:id" (Server 9), or Express would treat "mine" as an id.
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyTechnician, verifyToken } from "../middlewares/auth";
import { validateServiceInput } from "../utils/validate";
import { toObjectId } from "../utils/objectId";
import type { ServiceDoc } from "../types";

const router = Router();

/**
 * Loads a service and checks that the logged-in technician owns it.
 * Sends the error response itself and returns null when the request must stop.
 */
async function findOwnService(req: Request, res: Response) {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid service id" });
    return null;
  }
  const { services } = await getCollections();
  const service = await services.findOne({ _id });
  if (!service) {
    res.status(404).json({ message: "Service not found" });
    return null;
  }
  if (service.technicianEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: you can only manage your own services" });
    return null;
  }
  return service;
}

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

// Edit -> approvalStatus goes back to "pending" (the admin must re-approve the new content)
router.patch("/:id", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const service = await findOwnService(req, res);
  if (!service) return;

  const { data, error } = validateServiceInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  const { services } = await getCollections();
  await services.updateOne({ _id: service._id }, { $set: { ...data, approvalStatus: "pending" } });
  res.json({ success: true, message: "Service updated. It is pending admin approval again." });
});

// Availability on/off -> an unavailable service disappears from public pages.
// (Does NOT reset approval: the content didn't change.)
router.patch("/:id/availability", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const { isAvailable } = req.body ?? {};
  if (typeof isAvailable !== "boolean") {
    res.status(400).json({ message: "isAvailable must be true or false" });
    return;
  }

  const service = await findOwnService(req, res);
  if (!service) return;

  const { services } = await getCollections();
  await services.updateOne({ _id: service._id }, { $set: { isAvailable } });
  res.json({
    success: true,
    isAvailable,
    message: isAvailable ? "Service is now available" : "Service is now hidden from customers",
  });
});

// Delete. Existing bookings keep working: they store a copy of the service info.
router.delete("/:id", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const service = await findOwnService(req, res);
  if (!service) return;

  const { services } = await getCollections();
  await services.deleteOne({ _id: service._id });
  res.json({ success: true, message: "Service deleted" });
});

export default router;