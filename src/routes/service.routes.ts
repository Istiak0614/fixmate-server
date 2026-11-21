/**
 * Service routes (mounted at /api/services).
 *   GET    /api/services                   public -> approved + available, search/filter/sort/page (Challenge 1)
 *   GET    /api/services/featured          public -> 6 latest approved + available (Home page)
 *   GET    /api/services/mine              verifyToken + verifyTechnician -> my services
 *   GET    /api/services/:id               public -> details + technician summary (404 if not public)
 *   GET    /api/services/:id/reviews       public -> latest reviews of a service (optional feature)
 *   POST   /api/services                   verifyToken + verifyTechnician -> add (always "pending")
 *   PATCH  /api/services/:id               verifyToken + verifyTechnician (owner) -> edit, back to "pending"
 *   PATCH  /api/services/:id/availability  verifyToken + verifyTechnician (owner) -> turn on/off
 *   DELETE /api/services/:id               verifyToken + verifyTechnician (owner) -> delete
 * NOTE: "/featured" and "/mine" must stay ABOVE "GET /:id", or Express would treat them as an id.
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { FREE_SERVICE_LIMIT } from "../utils/subscription";
import { verifyTechnician, verifyToken } from "../middlewares/auth";
import { validateServiceInput } from "../utils/validate";
import { toObjectId } from "../utils/objectId";
import { buildServiceQuery } from "../utils/serviceQuery";
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

/* --------------------------------- Public --------------------------------- */

// Browse Services (Challenge 1 + pagination): one aggregation returns the page AND the total count
router.get("/", async (req: Request, res: Response) => {
  const { match, sort, page, skip, limit } = buildServiceQuery(req.query);
  const { services } = await getCollections();

  const [result] = await services
    .aggregate<{ items: ServiceDoc[]; total: { count: number }[] }>([
      { $match: match },
      {
        $facet: {
          items: [{ $sort: sort }, { $skip: skip }, { $limit: limit }, { $project: { description: 0 } }],
          total: [{ $count: "count" }],
        },
      },
    ])
    .toArray();

  const total = result?.total[0]?.count ?? 0;
  res.json({
    services: result?.items ?? [],
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// Home page: the 6 latest approved + available services
router.get("/featured", async (_req: Request, res: Response) => {
  const { services } = await getCollections();
  const featured = await services
    .find({ approvalStatus: "approved", isAvailable: true }, { projection: { description: 0 } })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  res.json(featured);
});
// Reviews of a public service, newest first. Only the first name is shown (no emails leave the server).
router.get("/:id/reviews", async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  const { services, bookings, users } = await getCollections();
  const service = _id ? await services.findOne({ _id, approvalStatus: "approved", isAvailable: true }, { projection: { _id: 1 } }) : null;
  if (!service) {
    res.status(404).json({ message: "Service not found" });
    return;
  }

  const reviewed = await bookings
    .find(
      { serviceId: req.params.id, rating: { $exists: true } },
      { projection: { customerName: 1, customerEmail: 1, rating: 1, review: 1, reviewedAt: 1 } }
    )
    .sort({ reviewedAt: -1 })
    .limit(20)
    .toArray();

  // Current profile photos of the reviewers (one query for all of them)
  const people = await users
    .find({ email: { $in: reviewed.map((b) => b.customerEmail) } }, { projection: { email: 1, image: 1 } })
    .toArray();
  const photoOf = new Map(people.map((u) => [u.email, u.image ?? null]));

  res.json(
    reviewed.map((b) => ({
      _id: b._id,
      name: b.customerName.split(" ")[0],
      image: photoOf.get(b.customerEmail) ?? null,
      rating: b.rating,
      review: b.review,
      reviewedAt: b.reviewedAt,
    }))
  );
});

/* ------------------------------- Technician ------------------------------- */

router.post("/", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const { data, error } = validateServiceInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  const { services } = await getCollections();

  // Pro Technician Plan: the Free plan can have at most 3 services (any status)
  if (req.user!.plan !== "pro") {
    const count = await services.countDocuments({ technicianEmail: req.user!.email });
    if (count >= FREE_SERVICE_LIMIT) {
      res.status(403).json({
        code: "PLAN_LIMIT",
        message: `The Free plan allows ${FREE_SERVICE_LIMIT} services. Upgrade to Pro for unlimited services.`,
      });
      return;
    }
  }

  const service: ServiceDoc = {
    ...data,
    // Owner info comes from the verified token, NEVER from the request body
    technicianName: req.user!.name,
    technicianEmail: req.user!.email,
    technicianPlan: req.user!.plan, // for the "Verified Pro" badge on cards
    approvalStatus: "pending", // only an admin can approve
    isAvailable: true,
    createdAt: new Date(),
  };

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

/* ------------------------- Public details (keep after /mine) ------------------------- */

// Service details + technician summary. Not approved / not available / missing -> 404 (Not Found page)
router.get("/:id", async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(404).json({ message: "Service not found" });
    return;
  }

  const { services, users } = await getCollections();
  const service = await services.findOne({ _id, approvalStatus: "approved", isAvailable: true });
  if (!service) {
    res.status(404).json({ message: "Service not found" });
    return;
  }

  const technician = await users.findOne(
    { email: service.technicianEmail },
    { projection: { _id: 0, name: 1, image: 1, area: 1, bio: 1, plan: 1 } }
  );

  res.json({
    ...service,
    technician: {
      name: technician?.name ?? service.technicianName,
      image: technician?.image ?? null,
      area: technician?.area ?? "",
      bio: technician?.bio ?? "",
      plan: technician?.plan ?? "free",
    },
  });
});

/* ------------------------------- Technician ------------------------------- */

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