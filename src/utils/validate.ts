/**
 * Input validation for services (used by "add" now and "edit" in Server step 6).
 * Never trust the client: every field is checked and cleaned here, on the server.
 */
import type { ServiceCategory, ServiceDoc, ServiceMode } from "../types";

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
];

export const SERVICE_MODES: ServiceMode[] = ["Home Visit", "Shop Drop-off"];

/** The fields a technician is allowed to send. Everything else is set by the server. */
export type ServiceInput = Pick<
  ServiceDoc,
  "title" | "category" | "description" | "image" | "basePrice" | "estimatedDuration" | "serviceMode" | "serviceArea"
>;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function validateServiceInput(body: Record<string, unknown> | undefined): {
  data?: ServiceInput;
  error?: string;
} {
  const title = text(body?.title);
  const category = text(body?.category) as ServiceCategory;
  const description = text(body?.description);
  const image = text(body?.image);
  const basePrice = Number(body?.basePrice);
  const estimatedDuration = text(body?.estimatedDuration);
  const serviceMode = text(body?.serviceMode) as ServiceMode;
  const serviceArea = text(body?.serviceArea);

  if (title.length < 5 || title.length > 80) return { error: "Title must be 5 to 80 characters" };
  if (!SERVICE_CATEGORIES.includes(category)) return { error: "Choose a valid category" };
  if (description.length < 20) return { error: "Description must be at least 20 characters" };
  if (!/^https:\/\/\S+$/.test(image)) return { error: "Upload a service image" };
  if (!Number.isFinite(basePrice) || basePrice <= 0) return { error: "Base price must be a positive number" };
  if (!estimatedDuration) return { error: "Estimated duration is required" };
  if (!SERVICE_MODES.includes(serviceMode)) return { error: "Service mode must be Home Visit or Shop Drop-off" };
  if (!serviceArea) return { error: "Service area is required" };

  return {
    data: {
      title,
      category,
      description,
      image,
      basePrice: Math.round(basePrice * 100) / 100, // keep 2 decimals (USD cents)
      estimatedDuration,
      serviceMode,
      serviceArea,
    },
  };
}

/* ------------------------------- Repair requests ------------------------------- */

/** The fields a customer sends. Name, email, service and technician info come from the server. */
export type BookingInput = {
  serviceId: string;
  customerPhone: string;
  address: string;
  preferredDate: Date;
  problemDescription: string;
};

const PHONE_REGEX = /^\+?[0-9][0-9\s-]{6,18}$/; // e.g. 01712345678, +880 1712-345678
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // "YYYY-MM-DD" from <input type="date">

export function validateBookingInput(body: Record<string, unknown> | undefined): {
  data?: BookingInput;
  error?: string;
} {
  const serviceId = text(body?.serviceId);
  const customerPhone = text(body?.customerPhone);
  const address = text(body?.address);
  const dateText = text(body?.preferredDate);
  const problemDescription = text(body?.problemDescription);

  if (!serviceId) return { error: "Service is required" };
  if (!PHONE_REGEX.test(customerPhone)) return { error: "Enter a valid phone number" };
  if (address.length < 5) return { error: "Enter the service or pickup address" };

  // Preferred date: today or later. Stored as midnight UTC of the chosen day.
  // We allow "yesterday in UTC" too, because a customer's "today" can be behind UTC (other time zones).
  const preferredDate = new Date(`${dateText}T00:00:00.000Z`);
  // (the last check rejects impossible days like 2026-02-30, which JavaScript would turn into March 2)
  if (
    !DATE_REGEX.test(dateText) ||
    Number.isNaN(preferredDate.getTime()) ||
    preferredDate.toISOString().slice(0, 10) !== dateText
  ) {
    return { error: "Choose a preferred date" };
  }
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const oneDay = 24 * 60 * 60 * 1000;
  if (preferredDate.getTime() < todayUtc.getTime() - oneDay) {
    return { error: "Preferred date must be today or a future date" };
  }

  if (problemDescription.length < 20) return { error: "Describe the problem in at least 20 characters" };
  if (problemDescription.length > 1000) return { error: "Problem description is too long (max 1000 characters)" };

  return { data: { serviceId, customerPhone, address, preferredDate, problemDescription } };
}

/* ---------------------------------- Profile ---------------------------------- */

export type ProfileInput = { name: string; phone: string; area: string; bio: string; image?: string };

// Photos are uploaded to ImgBB by the client; we only accept ImgBB's own image links.
const IMGBB_URL_REGEX = /^https:\/\/i\.ibb\.co\/\S+$/;

export function validateProfileInput(body: Record<string, unknown> | undefined): {
  data?: ProfileInput;
  error?: string;
} {
  const name = text(body?.name);
  const phone = text(body?.phone);
  const area = text(body?.area);
  const bio = text(body?.bio);
  const image = text(body?.image);

  if (name.length < 2 || name.length > 50) return { error: "Name must be 2 to 50 characters" };
  if (phone && !PHONE_REGEX.test(phone)) return { error: "Enter a valid phone number" }; // optional
  if (area.length > 60) return { error: "Area is too long (max 60 characters)" };
  if (bio.length > 300) return { error: "Bio is too long (max 300 characters)" };
  if (image && !IMGBB_URL_REGEX.test(image)) return { error: "Upload the photo again" };

  // image is only changed when a new one was uploaded
  return { data: { name, phone, area, bio, ...(image && { image }) } };
}
/* ------------------------- Rating & Review (optional feature) ------------------------- */

export type ReviewInput = { rating: number; review: string };

export function validateReviewInput(body: Record<string, unknown> | undefined): {
  data?: ReviewInput;
  error?: string;
} {
  const rating = Number(body?.rating);
  const review = text(body?.review);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Choose a rating from 1 to 5 stars" };
  if (review.length < 10 || review.length > 500) return { error: "Review must be 10 to 500 characters" };
  return { data: { rating, review } };
}