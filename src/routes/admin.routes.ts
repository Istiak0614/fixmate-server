/**
 * Admin routes (mounted at /api/admin). EVERY route here uses verifyToken + verifyAdmin
 * (applied once with router.use below).
 *   GET   /api/admin/stats           -> overview cards + chart data
 *   GET   /api/admin/users           -> all users
 *   PATCH /api/admin/users/:id/role  -> change a user's role (never your own)
 *   GET   /api/admin/services?status=pending|approved|rejected  -> all services, pending first
 *   PATCH /api/admin/services/:id/approval  -> approve or reject a service
 * Coming next: bookings (Server 12), payments (Server 14).
 */
import { Router, type Request, type Response } from "express";
import { getCollections } from "../config/db";
import { verifyAdmin, verifyToken } from "../middlewares/auth";
import { toObjectId } from "../utils/objectId";
import type { ApprovalStatus, Role } from "../types";

const router = Router();
router.use(verifyToken, verifyAdmin); // protects every route below

const ROLES: Role[] = ["customer", "technician", "admin"];

type GroupCount = { _id: string | null; count: number };

/** [{_id:"customer",count:3}, ...] -> { customer: 3, ... } */
function toCountMap(groups: GroupCount[], fallbackKey: string) {
  const map: Record<string, number> = {};
  for (const g of groups) map[g._id ?? fallbackKey] = (map[g._id ?? fallbackKey] ?? 0) + g.count;
  return map;
}

/** Last 6 months as "YYYY-MM" keys, oldest first, so charts have no missing months. */
function lastSixMonths(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

router.get("/stats", async (_req: Request, res: Response) => {
  const { users, services, bookings, payments } = await getCollections();
  const months = lastSixMonths();
  const sixMonthsAgo = new Date(`${months[0]}-01T00:00:00.000Z`);

  // Run all counts in parallel: one round trip instead of five
  const [usersByRole, servicesByStatus, bookingsByStatus, revenue, monthly] = await Promise.all([
    users.aggregate<GroupCount>([{ $group: { _id: "$role", count: { $sum: 1 } } }]).toArray(),
    services.aggregate<GroupCount>([{ $group: { _id: "$approvalStatus", count: { $sum: 1 } } }]).toArray(),
    bookings.aggregate<GroupCount>([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    payments
      .aggregate<{ total: number; count: number }>([
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    payments
      .aggregate<{ _id: string; revenue: number }>([
        { $match: { paidAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } }, revenue: { $sum: "$amount" } } },
      ])
      .toArray(),
  ]);

  const roleCounts = toCountMap(usersByRole, "customer"); // users without a role = customer (default)
  const serviceCounts = toCountMap(servicesByStatus, "pending");
  const bookingCounts = toCountMap(bookingsByStatus, "requested");
  const revenueByMonth = new Map(monthly.map((m) => [m._id, m.revenue]));

  res.json({
    // overview cards (assignment: Total Users, Total Technicians, Pending Services)
    totalUsers: Object.values(roleCounts).reduce((a, b) => a + b, 0),
    totalTechnicians: roleCounts.technician ?? 0,
    pendingServices: serviceCounts.pending ?? 0,
    // extra numbers + chart data
    totalBookings: Object.values(bookingCounts).reduce((a, b) => a + b, 0),
    totalRevenue: revenue[0]?.total ?? 0,
    totalPayments: revenue[0]?.count ?? 0,
    usersByRole: roleCounts,
    servicesByStatus: serviceCounts,
    bookingsByStatus: bookingCounts,
    monthlyRevenue: months.map((month) => ({ month, revenue: revenueByMonth.get(month) ?? 0 })),
  });
});

router.get("/users", async (_req: Request, res: Response) => {
  const { users } = await getCollections();
  const allUsers = await users
    .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, plan: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(allUsers);
});

router.patch("/users/:id/role", async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid user id" });
    return;
  }

  const role = req.body?.role as Role;
  if (!ROLES.includes(role)) {
    res.status(400).json({ message: "Role must be customer, technician or admin" });
    return;
  }

  // Assignment rule: the admin cannot change their own role (avoids locking yourself out)
  if (_id.toString() === req.user!.id) {
    res.status(403).json({ message: "You cannot change your own role" });
    return;
  }

  const { users } = await getCollections();
  const result = await users.updateOne({ _id }, { $set: { role, updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.json({ success: true, role, message: `Role changed to ${role}` });
});

/* ------------------------------- Service approval ------------------------------- */
const APPROVAL_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected"];

// All services from all technicians. Optional ?status= filter.
// Pending services always come first, so the admin finds them instantly.
router.get("/services", async (req: Request, res: Response) => {
  const status = req.query.status as ApprovalStatus | undefined;
  const match = status && APPROVAL_STATUSES.includes(status) ? { approvalStatus: status } : {};

  const { services } = await getCollections();
  const list = await services
    .aggregate([
      { $match: match },
      // pending -> 0, approved -> 1, rejected -> 2 (used only for sorting)
      { $addFields: { statusOrder: { $indexOfArray: [APPROVAL_STATUSES, "$approvalStatus"] } } },
      { $sort: { statusOrder: 1, createdAt: -1 } },
      { $project: { statusOrder: 0 } },
    ])
    .toArray();
  res.json(list);
});

router.patch("/services/:id/approval", async (req: Request, res: Response) => {
  const _id = toObjectId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid service id" });
    return;
  }

  const approvalStatus = req.body?.approvalStatus as ApprovalStatus;
  if (approvalStatus !== "approved" && approvalStatus !== "rejected") {
    res.status(400).json({ message: "approvalStatus must be approved or rejected" });
    return;
  }

  const { services } = await getCollections();
  const result = await services.updateOne({ _id }, { $set: { approvalStatus } });
  if (result.matchedCount === 0) {
    res.status(404).json({ message: "Service not found" });
    return;
  }
  res.json({ success: true, approvalStatus, message: `Service ${approvalStatus}` });
});

export default router;