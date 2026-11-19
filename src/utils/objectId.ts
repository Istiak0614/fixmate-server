import { ObjectId } from "mongodb";

/**
 * Turns a URL id into an ObjectId, or null if it is not a valid 24-character hex id.
 * (ObjectId.isValid alone also accepts any 12-character string, so we check the format.)
 */
export function toObjectId(id: unknown): ObjectId | null {
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;
}