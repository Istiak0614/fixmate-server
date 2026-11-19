/**
 * Challenge 1 + optional pagination: turns the URL query of GET /api/services into a MongoDB
 * filter, sort and page. Everything happens in MongoDB (no JavaScript .filter() on the client).
 *
 *   /api/services?search=iphone&category=Smartphone&mode=Home%20Visit&minPrice=20&maxPrice=80&sort=price-asc&page=2
 */
import type { Document, Sort } from "mongodb";
import { SERVICE_CATEGORIES, SERVICE_MODES } from "./validate";
import type { ServiceCategory, ServiceMode } from "../types";

export const PAGE_SIZE = 12; // 12 fits 4, 3, 2 or 1 cards per row evenly

const SORTS: Record<string, Sort> = {
  newest: { createdAt: -1, _id: -1 },
  "price-asc": { basePrice: 1, createdAt: -1, _id: -1 },
  "price-desc": { basePrice: -1, createdAt: -1, _id: -1 },
};

/** "c++ (repair)" -> "c\+\+ \(repair\)" so user text can't break or abuse the regex */
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/** "25" -> 25; empty, negative or not a number -> undefined (= no limit) */
function toPrice(value: unknown): number | undefined {
  const text = String(first(value) ?? "").trim();
  if (!text) return undefined;
  const price = Number(text);
  return Number.isFinite(price) && price >= 0 ? price : undefined;
}

export function buildServiceQuery(query: Record<string, unknown>) {
  const search = String(first(query.search) ?? "").trim().slice(0, 60);
  const category = String(first(query.category) ?? "") as ServiceCategory;
  const mode = String(first(query.mode) ?? "") as ServiceMode;
  const sortKey = String(first(query.sort) ?? "newest");
  const page = Math.max(1, Math.floor(Number(first(query.page)) || 1));
  let minPrice = toPrice(query.minPrice);
  let maxPrice = toPrice(query.maxPrice);
  // Typed the wrong way round (min 80, max 20)? Swap them instead of returning nothing.
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  // Public pages only ever show approved + available services
  const match: Document = { approvalStatus: "approved", isAvailable: true };

  if (SERVICE_CATEGORIES.includes(category)) match.category = category;
  if (SERVICE_MODES.includes(mode)) match.serviceMode = mode;
  if (minPrice !== undefined || maxPrice !== undefined) {
    match.basePrice = {
      ...(minPrice !== undefined && { $gte: minPrice }),
      ...(maxPrice !== undefined && { $lte: maxPrice }),
    };
  }
  if (search) {
    const regex = { $regex: escapeRegex(search), $options: "i" }; // case-insensitive "contains"
    match.$or = [{ title: regex }, { category: regex }];
  }

  return {
    match,
    sort: SORTS[sortKey] ?? SORTS.newest,
    page,
    skip: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
}