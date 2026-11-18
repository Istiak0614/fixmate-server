/**
 * MongoDB connection (native driver, no Mongoose).
 *
 * Why a cache on globalThis?
 * On Vercel, every request runs in a serverless function. A "warm" function instance is reused
 * for many requests, so we keep ONE MongoClient per instance instead of opening a new connection
 * on every request (which would quickly hit Atlas' connection limit and cause slow 504s).
 */
import { MongoClient, type Db } from "mongodb";
import dns from "node:dns";

// Local-dev fix: some routers/ISPs refuse the SRV DNS lookup that "mongodb+srv://" needs
// (error: querySrv ECONNREFUSED). Use public DNS on our machine only; Vercel's DNS works fine.
if (!process.env.VERCEL) {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}
import type { BookingDoc, PaymentDoc, ServiceDoc, UserDoc } from "../types";

const DB_NAME = process.env.DB_NAME || "fixmate";

type MongoCache = {
  promise: Promise<MongoClient> | null; // the connection in progress / done
  indexesReady: boolean; // indexes are created once per instance
};

const globalForMongo = globalThis as unknown as { _fixmateMongo?: MongoCache };
const cache: MongoCache =
  globalForMongo._fixmateMongo ?? (globalForMongo._fixmateMongo = { promise: null, indexesReady: false });

/** Returns the connected database, connecting only the first time. */
export async function connectDB(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing. Add it to .env (local) or Vercel env vars.");

  if (!cache.promise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10, // small pool: each serverless instance needs only a few connections
      serverSelectionTimeoutMS: 8000, // fail fast with a clear error instead of hanging into a 504
    });
    cache.promise = client.connect().catch((error) => {
      cache.promise = null; // allow the next request to retry
      throw error;
    });
  }

  const client = await cache.promise;
  const db = client.db(DB_NAME);

  if (!cache.indexesReady) {
    await createIndexes(db);
    cache.indexesReady = true;
  }
  return db;
}

/**
 * Our 4 collections, typed.
 * NOTE: "user" (singular) is the collection BetterAuth's MongoDB adapter creates — it IS our users collection.
 * Usage in a route: const { services } = await getCollections();
 */
export async function getCollections() {
  const db = await connectDB();
  return {
    users: db.collection<UserDoc>("user"),
    services: db.collection<ServiceDoc>("services"),
    bookings: db.collection<BookingDoc>("bookings"),
    payments: db.collection<PaymentDoc>("payments"),
  };
}

/** createIndex is idempotent: running it again on an existing index does nothing. */
async function createIndexes(db: Db) {
  await Promise.all([
    // users: email links data across collections
    db.collection("user").createIndex({ email: 1 }, { unique: true }),

    // services: public listing query + "my services"
    db.collection("services").createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 }),
    db.collection("services").createIndex({ technicianEmail: 1 }),

    // bookings: customer / technician tables + duplicate-active-request check
    db.collection("bookings").createIndex({ customerEmail: 1, createdAt: -1 }),
    db.collection("bookings").createIndex({ technicianEmail: 1, createdAt: -1 }),
    db.collection("bookings").createIndex({ serviceId: 1, customerEmail: 1, status: 1 }),

    // payments: the SAME Stripe session can never be saved twice (verify page + webhook + retries)
    db.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true }),
    db.collection("payments").createIndex({ customerEmail: 1, paidAt: -1 }),
  ]);
}