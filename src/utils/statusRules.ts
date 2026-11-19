/**
 * Challenge 3: the job status pipeline, written as a table (exactly like the assignment's table).
 *
 *   requested   -> accepted     (technician)
 *   requested   -> rejected     (technician)  final
 *   requested   -> cancelled    (customer)    final
 *   accepted    -> in-progress  (technician)
 *   in-progress -> completed    (technician)  must send finalAmount > 0
 *
 * Anything not in this table (e.g. requested -> completed, or changing a cancelled job) is refused.
 * "paid" is not a status: Stripe sets paymentStatus, only once (Server steps 14-15).
 */
import type { BookingStatus } from "../types";

type Actor = "customer" | "technician";

const ALLOWED: Partial<Record<BookingStatus, Partial<Record<BookingStatus, Actor>>>> = {
  requested: { accepted: "technician", rejected: "technician", cancelled: "customer" },
  accepted: { "in-progress": "technician" },
  "in-progress": { completed: "technician" },
};

/** Can `actor` move a booking from `from` to `to`? */
export function canChangeStatus(from: BookingStatus, to: BookingStatus, actor: Actor): boolean {
  return ALLOWED[from]?.[to] === actor;
}

/** Active = still in progress somewhere in the pipeline (used for the duplicate-request rule). */
export const ACTIVE_STATUSES: BookingStatus[] = ["requested", "accepted", "in-progress"];
/** "accepted" -> "an accepted", "requested" -> "a requested" (for readable error messages) */
export const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;