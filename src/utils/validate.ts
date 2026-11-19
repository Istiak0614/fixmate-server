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