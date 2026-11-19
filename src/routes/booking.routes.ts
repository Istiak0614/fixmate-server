/**
 * Booking routes (mounted at /api/bookings).
 *   POST  /api/bookings             verifyToken + verifyCustomer -> send a repair request
 *   GET   /api/bookings/my          verifyToken + verifyCustomer -> my bookings
 *   PATCH /api/bookings/:id/cancel  verifyToken + verifyCustomer (owner) -> cancel, only while "requested"
 * Coming next: technician jobs + status pipeline (Server 11).
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyCustomer, verifyToken } from "../middlewares/auth";
import { toObjectId } from "../utils/objectId";
import { validateBookingInput } from "../utils/validate";
import { ACTIVE_STATUSES, canChangeStatus } from "../utils/statusRules";
import type { BookingDoc } from "../types";

const router = Router();

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
    res.status(400).json({ message: `A ${booking.status} job cannot be cancelled` });
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

export default router;