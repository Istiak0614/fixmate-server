/**
 * Shared document types for FixMate's 4 collections.
 * Field names follow the assignment's data design exactly.
 * Fields marked (optional feature) belong to the optional requirements we chose.
 */
import type { ObjectId } from "mongodb";

export type Role = "customer" | "technician" | "admin";

export type ServiceCategory =
  | "Smartphone"
  | "Laptop & PC"
  | "AC"
  | "Refrigerator"
  | "TV"
  | "Washing Machine"
  | "Electrical";

export type ServiceMode = "Home Visit" | "Shop Drop-off";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "in-progress"
  | "completed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid";

/** 1. users — BetterAuth's "user" collection + our additionalFields */
export interface UserDoc {
  _id?: ObjectId;
  name: string;
  email: string;
  image?: string | null;
  role: Role;
  phone?: string;
  area?: string;
  bio?: string;
  plan?: "free" | "pro"; // (optional feature) Pro Technician Plan
  stripeSubscriptionId?: string | null; // (optional feature) Pro Technician Plan
  createdAt?: Date; // set by BetterAuth
  updatedAt?: Date; // set by BetterAuth
}

/** 2. services */
export interface ServiceDoc {
  _id?: ObjectId;
  title: string;
  category: ServiceCategory;
  description: string;
  image: string;
  basePrice: number;
  estimatedDuration: string;
  serviceMode: ServiceMode;
  serviceArea: string;
  technicianName: string;
  technicianEmail: string;
  approvalStatus: ApprovalStatus;
  isAvailable: boolean;
  createdAt: Date;
}

/** One entry of a booking's timeline — (optional feature) Job Timeline Tracker */
export interface StatusHistoryEntry {
  status: BookingStatus | "paid";
  changedAt: Date;
}

/** 3. bookings */
export interface BookingDoc {
  _id?: ObjectId;
  serviceId: string;
  serviceTitle: string;
  serviceImage: string;
  category: ServiceCategory;
  basePrice: number;
  technicianName: string;
  technicianEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  preferredDate: Date;
  problemDescription: string;
  status: BookingStatus;
  finalAmount: number;
  paymentStatus: PaymentStatus;
  createdAt: Date; // used for "newest first" sorting in tables
  statusHistory: StatusHistoryEntry[]; // (optional feature) Job Timeline Tracker
  rating?: number; // (optional feature) Rating & Review, 1-5
  review?: string; // (optional feature) Rating & Review
  checkoutSessionId?: string; // last Stripe Checkout Session, reused while still open (prevents paying twice)
}

/** 4. payments */
export interface PaymentDoc {
  _id?: ObjectId;
  type: "job" | "subscription"; // (optional feature) subscription payments of the Pro plan
  bookingId?: string; // only for type "job"
  serviceTitle: string;
  customerName: string;
  customerEmail: string;
  technicianName: string;
  technicianEmail: string;
  amount: number;
  currency: "usd";
  transactionId: string; // Stripe payment_intent id
  stripeSessionId: string; // Stripe Checkout Session id — UNIQUE (never save a payment twice)
  paymentStatus: "paid";
  paidAt: Date;
}