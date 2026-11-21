/**
 * Booking routes (mounted at /api/bookings).
 *   POST  /api/bookings             verifyToken + verifyCustomer -> send a repair request
 *   GET   /api/bookings/my          verifyToken + verifyCustomer -> my bookings
 *   PATCH /api/bookings/:id/cancel  verifyToken + verifyCustomer (owner) -> cancel, only while "requested"
 *   PATCH /api/bookings/:id/review  verifyToken + verifyCustomer (owner) -> rate a PAID job, once (optional feature)
 *   GET   /api/bookings/technician  verifyToken + verifyTechnician -> my jobs (?status= filter)
 *   PATCH /api/bookings/:id/status  verifyToken + verifyTechnician (owner) -> move the job forward (Challenge 3)
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyCustomer, verifyTechnician, verifyToken } from "../middlewares/auth";
import { toObjectId } from "../utils/objectId";
import { validateBookingInput, validateReviewInput } from "../utils/validate";
import { updateServiceRating } from "../utils/rating";
import { ACTIVE_STATUSES, canChangeStatus, withArticle } from "../utils/statusRules";
import type { BookingDoc, BookingStatus } from "../types";

const router = Router();

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Send a repair request. Only customers reach this (verifyCustomer), so technicians and
// admins can never send requests — the business rule is enforced on the server.
router.post("/", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const { data, error } = validateBookingInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  const serviceObjectId = toObjectId(data.serviceId);
  const { services, bookings } = await getCollections();
  const service = serviceObjectId
    ? await services.findOne({ _id: serviceObjectId, approvalStatus: "approved", isAvailable: true })
    : null;
  if (!service) {
    res.status(404).json({ message: "This service is not available for booking" });
    return;
  }

  // Rule: nobody can request their own service
  if (service.technicianEmail === req.user!.email) {
    res.status(403).json({ message: "You cannot request your own service" });
    return;
  }

  // Rule: no second ACTIVE request (requested / accepted / in-progress) for the same service
  const activeRequest = await bookings.findOne({
    serviceId: data.serviceId,
    customerEmail: req.user!.email,
    status: { $in: ACTIVE_STATUSES },
  });
  if (activeRequest) {
    res.status(409).json({ message: "You already have an active request for this service" });
    return;
  }

  const now = new Date();
  const booking: BookingDoc = {
    // copied from the service, so the booking still shows correctly if the service changes later
    serviceId: data.serviceId,
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
    basePrice: service.basePrice,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,
    // from the verified token (never from the body)
    customerName: req.user!.name,
    customerEmail: req.user!.email,
    // from the request form
    customerPhone: data.customerPhone,
    address: data.address,
    preferredDate: data.preferredDate,
    problemDescription: data.problemDescription,
    // defaults from the data design
    status: "requested",
    finalAmount: service.basePrice, // default = basePrice; the technician sets the real amount on completion
    paymentStatus: "unpaid",
    createdAt: now,
    statusHistory: [{ status: "requested", changedAt: now }], // (optional feature) Job Timeline Tracker
  };

  const result = await bookings.insertOne(booking);
  res.status(201).json({ success: true, insertedId: result.insertedId, message: "Repair request sent" });
});

// My bookings (customer). Only MY bookings: the filter uses the email from the token.
router.get("/my", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const { bookings } = await getCollections();
  const myBookings = await bookings.find({ customerEmail: req.user!.email }).sort({ createdAt: -1 }).toArray();
  res.json(myBookings);
});

// Cancel (customer, owner, only while "requested")
router.patch("/:id/cancel", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid booking id" });
    return;
  }

  const { bookings } = await getCollections();
  const booking = await bookings.findOne({ _id });
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }
  if (booking.customerEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this is not your booking" });
    return;
  }
  if (!canChangeStatus(booking.status, "cancelled", "customer")) {
    res.status(400).json({ message: `${capitalize(withArticle(booking.status))} job cannot be cancelled` });
    return;
  }

  // The filter repeats status: "requested" so a technician accepting at the same moment wins safely
  const now = new Date();
  const result = await bookings.updateOne(
    { _id, status: "requested" },
    { $set: { status: "cancelled" }, $push: { statusHistory: { status: "cancelled", changedAt: now } } }
  );
  if (result.modifiedCount === 0) {
    res.status(409).json({ message: "This request was just updated by the technician. Please refresh." });
    return;
  }
  res.json({ success: true, message: "Request cancelled" });
});
// Rating & Review: only the customer of a PAID job, and only once
router.patch("/:id/review", verifyToken, verifyCustomer, async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid booking id" });
    return;
  }
  const { data, error } = validateReviewInput(req.body);
  if (error || !data) {
    res.status(400).json({ message: error });
    return;
  }

  const { bookings } = await getCollections();
  const booking = await bookings.findOne({ _id });
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }
  if (booking.customerEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this is not your booking" });
    return;
  }
  if (booking.paymentStatus !== "paid") {
    res.status(400).json({ message: "You can review a job after paying for it" });
    return;
  }
  if (booking.rating) {
    res.status(409).json({ message: "You have already reviewed this job" });
    return;
  }

  // "rating does not exist" in the filter makes this a one-time write (double click safe)
  const result = await bookings.updateOne(
    { _id, paymentStatus: "paid", rating: { $exists: false } },
    { $set: { rating: data.rating, review: data.review, reviewedAt: new Date() } }
  );
  if (result.modifiedCount === 0) {
    res.status(409).json({ message: "You have already reviewed this job" });
    return;
  }

  await updateServiceRating(booking.serviceId);
  res.json({ success: true, message: "Thanks for your review!" });
});

/* ------------------------------- Technician ------------------------------- */

const ALL_STATUSES: BookingStatus[] = ["requested", "accepted", "rejected", "in-progress", "completed", "cancelled"];

// The technician's jobs: ONLY bookings where technicianEmail is the logged-in technician
router.get("/technician", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const status = req.query.status as BookingStatus | undefined;
  const filter = {
    technicianEmail: req.user!.email,
    ...(status && ALL_STATUSES.includes(status) && { status }), // ?status=all or nothing -> every job
  };

  const { bookings } = await getCollections();
  const jobs = await bookings.find(filter).sort({ createdAt: -1 }).toArray();
  res.json(jobs);
});

const SUCCESS_MESSAGES: Partial<Record<BookingStatus, string>> = {
  accepted: "Job accepted",
  rejected: "Job rejected",
  "in-progress": "Work started",
  completed: "Job marked as completed",
};

// Challenge 3: only the technician who owns the job, only the moves in the status table,
// and "completed" needs a finalAmount greater than 0.
router.patch("/:id/status", verifyToken, verifyTechnician, async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid booking id" });
    return;
  }

  const nextStatus = req.body?.status as BookingStatus;
  if (!ALL_STATUSES.includes(nextStatus)) {
    res.status(400).json({ message: "Invalid status" });
    return;
  }

  const { bookings } = await getCollections();
  const booking = await bookings.findOne({ _id });
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }

  // 1. Owner check: only the technician of THIS job
  if (booking.technicianEmail !== req.user!.email) {
    res.status(403).json({ message: "Forbidden: this job belongs to another technician" });
    return;
  }

  // 2. Pipeline check: e.g. requested -> completed or changing a cancelled job is refused
  if (!canChangeStatus(booking.status, nextStatus, "technician")) {
    res.status(400).json({ message: `Not allowed: ${withArticle(booking.status)} job cannot become ${nextStatus}` });
    return;
  }

  // 3. Completing needs the final amount (> 0). Rounded to cents. This is what the customer pays.
  const update: Partial<BookingDoc> = { status: nextStatus };
  if (nextStatus === "completed") {
    const finalAmount = Number(req.body?.finalAmount);
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      res.status(400).json({ message: "Final amount must be a number greater than 0" });
      return;
    }
    update.finalAmount = Math.round(finalAmount * 100) / 100;
  }

  // The filter repeats the CURRENT status: if the customer cancelled a moment ago, nothing changes
  const result = await bookings.updateOne(
    { _id, status: booking.status },
    { $set: update, $push: { statusHistory: { status: nextStatus, changedAt: new Date() } } }
  );
  if (result.modifiedCount === 0) {
    res.status(409).json({ message: "This job was just updated by someone else. Please refresh." });
    return;
  }

  res.json({ success: true, status: nextStatus, message: SUCCESS_MESSAGES[nextStatus] ?? "Status updated" });
});

export default router;