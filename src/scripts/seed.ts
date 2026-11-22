/**
 * Seed script  ->  npm run seed
 *
 * Fills the database with demo data so every page has something to show:
 *   - the ADMIN account (the ONLY way to create an admin: nobody can sign up as admin)
 *   - 3 technicians (2 Pro, 1 Free with exactly 3 services = the Free limit) and 3 customers
 *   - 15 approved services + 1 pending + 1 rejected
 *   - bookings in every status, payments (jobs + Pro plan) and reviews
 *
 * Accounts are BetterAuth-compatible, so you can sign in with them on the website:
 *   user     -> BetterAuth's "user" collection (+ our role / phone / area / bio / plan fields)
 *   account  -> providerId "credential" with the password hashed the way BetterAuth does it
 *               (scrypt N=16384 r=16 p=1, 64 bytes, "salt:key" in hex)
 *
 * Safe to run again: every seed document has a FIXED _id (made from a name), so a second run
 * replaces the same documents instead of adding copies. A seeded service that was deleted by
 * accident comes back. Real users' data is never touched.
 *
 * Needs in .env: MONGODB_URI, DB_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD
 */
import dotenv from "dotenv";
import { createHash, randomBytes, scrypt } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { closeDB, connectDB } from "../config/db";
import type { BookingDoc, BookingStatus, PaymentDoc, ServiceCategory, ServiceDoc, ServiceMode, StatusHistoryEntry, UserDoc } from "../types";

dotenv.config({ quiet: true });

/* -------------------------------- helpers -------------------------------- */

/** The same id every run, e.g. idFor("user:admin") */
const idFor = (key: string) => new ObjectId(createHash("md5").update(`fixmate-seed:${key}`).digest("hex").slice(0, 24));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const dateOnly = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Exactly BetterAuth's hashPassword (better-auth/crypto) using Node's built-in scrypt. */
function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }, (err, key) =>
      err ? reject(err) : resolve(`${salt}:${key.toString("hex")}`)
    );
  });
}

/** Same rule as sign-up: 6+ characters, one uppercase, one lowercase. */
const strongEnough = (p: string) => p.length >= 6 && /[A-Z]/.test(p) && /[a-z]/.test(p);

/* --------------------------------- people --------------------------------- */

type Person = { key: string; name: string; email: string; role: UserDoc["role"]; plan?: "free" | "pro"; phone: string; area: string; bio: string };

const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();

const PEOPLE: Person[] = [
  { key: "admin", name: "FixMate Admin", email: adminEmail, role: "admin", phone: "01700000000", area: "Dhaka", bio: "Keeps FixMate safe and running." },
  { key: "tech-rafi", name: "Rafi Ahmed", email: "rafi.tech@fixmate.demo", role: "technician", plan: "pro", phone: "01711223344", area: "Dhanmondi, Dhaka", bio: "8 years fixing smartphones and laptops. Original parts, 90-day warranty on every repair." },
  { key: "tech-sumaiya", name: "Sumaiya Karim", email: "sumaiya.tech@fixmate.demo", role: "technician", plan: "pro", phone: "01822334455", area: "Mirpur, Dhaka", bio: "Certified AC, refrigerator and home electrical technician. Gas refills, compressors and safe wiring." },
  { key: "tech-tanvir", name: "Tanvir Hasan", email: "tanvir.tech@fixmate.demo", role: "technician", plan: "free", phone: "01933445566", area: "Uttara, Dhaka", bio: "Home appliance repair for TVs and washing machines. On the Free plan (3 services)." },
  { key: "cust-nusrat", name: "Nusrat Jahan", email: "nusrat@fixmate.demo", role: "customer", phone: "01644556677", area: "Gulshan, Dhaka", bio: "" },
  { key: "cust-arif", name: "Arif Hossain", email: "arif@fixmate.demo", role: "customer", phone: "01555667788", area: "Mohammadpur, Dhaka", bio: "" },
  { key: "cust-mitu", name: "Mitu Rahman", email: "mitu@fixmate.demo", role: "customer", phone: "01366778899", area: "Banani, Dhaka", bio: "" },
];
const person = (key: string) => PEOPLE.find((p) => p.key === key)!;

/* -------------------------------- services -------------------------------- */

/** Unsplash photo id -> resized image URL (images.unsplash.com is allowed in the client's next.config.ts). */
const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=70`;

type SeedService = {
  key: string; tech: string; title: string; category: ServiceCategory; price: number; duration: string;
  mode: ServiceMode; area: string; image: string; description: string; approval?: ServiceDoc["approvalStatus"];
};

const SERVICES: SeedService[] = [
  { key: "phone-screen", tech: "tech-rafi", title: "Smartphone Screen Replacement", category: "Smartphone", price: 35, duration: "1-2 hours", mode: "Shop Drop-off", area: "Dhanmondi, Dhaka", image: img("photo-1511707171634-5f897ff02aa9"), description: "Cracked or unresponsive screen? I replace it with a high-quality panel and test touch, display and Face ID before you collect it. Most iPhone, Samsung and Xiaomi models in stock." },
  { key: "phone-battery", tech: "tech-rafi", title: "Phone Battery Replacement", category: "Smartphone", price: 20, duration: "45 minutes", mode: "Shop Drop-off", area: "Dhanmondi, Dhaka", image: img("photo-1598327105666-5b89351aff97"), description: "Phone dying before lunch or shutting down at 20%? A new battery with a health check and a 6-month warranty. Your data stays on the phone." },
  { key: "phone-charging", tech: "tech-rafi", title: "Charging Port & Water Damage Repair", category: "Smartphone", price: 25, duration: "Same day", mode: "Home Visit", area: "Dhanmondi & Lalmatia", image: img("photo-1556656793-08538906a9f8"), description: "Loose cable, slow charging or a phone that fell in water. I clean the board, replace the port if needed and give you an honest report of what can be saved." },
  { key: "laptop-service", tech: "tech-rafi", title: "Laptop Cleaning & Thermal Paste", category: "Laptop & PC", price: 30, duration: "2 hours", mode: "Home Visit", area: "Dhanmondi, Dhaka", image: img("photo-1496181133206-80ce9b88a853"), description: "Laptop running hot, loud fan, random shutdowns? Full internal cleaning, fresh thermal paste and a temperature test. Your laptop runs cooler and faster." },
  { key: "laptop-os", tech: "tech-rafi", title: "Windows Reinstall & SSD Upgrade", category: "Laptop & PC", price: 45, duration: "3 hours", mode: "Shop Drop-off", area: "Dhanmondi, Dhaka", image: img("photo-1517336714731-489689fd1ca8"), description: "Slow PC? I move you to an SSD, reinstall Windows with drivers and back up your files first. Price includes labour; the SSD is quoted separately." },
  // FIXED image: white split AC indoor unit (Yucel M, Unsplash)
  { key: "ac-service", tech: "tech-sumaiya", title: "AC General Servicing", category: "AC", price: 25, duration: "1.5 hours", mode: "Home Visit", area: "Mirpur & Pallabi", image: img("photo-1726614846573-c1ac2e6161d1"), description: "Jet wash of the indoor and outdoor units, filter and drain cleaning, and a gas pressure check. Ideal before summer for cooler air and lower bills." },
  { key: "ac-gas", tech: "tech-sumaiya", title: "AC Gas Refill & Leak Fix", category: "AC", price: 55, duration: "2-3 hours", mode: "Home Visit", area: "Mirpur, Dhaka", image: img("photo-1621905251918-48416bd8575a"), description: "AC running but not cooling? I find and seal the leak first, then refill R32/R410 gas to the right pressure. A leak test is included." },
  { key: "fridge-repair", tech: "tech-sumaiya", title: "Refrigerator Cooling Repair", category: "Refrigerator", price: 40, duration: "2 hours", mode: "Home Visit", area: "Mirpur & Kafrul", image: img("photo-1571175443880-49e1d25b2bc5"), description: "Fridge not cooling, freezer icing up or a noisy compressor. Thermostat, fan and relay checks with a written diagnosis before any part is replaced." },
  { key: "fridge-gas", tech: "tech-sumaiya", title: "Fridge Gas Charge & Compressor Check", category: "Refrigerator", price: 50, duration: "3 hours", mode: "Home Visit", area: "Mirpur, Dhaka", image: img("photo-1584568694244-14fbdf83bd30"), description: "Full gas charge with a vacuum and leak test, plus a compressor health check. Works for single and double-door refrigerators of all common brands." },
  { key: "tv-repair", tech: "tech-tanvir", title: "LED TV Display & Board Repair", category: "TV", price: 45, duration: "Same day", mode: "Home Visit", area: "Uttara, Dhaka", image: img("photo-1593359677879-a4bb92f829d1"), description: "No picture, lines on the screen or no power? I repair backlights, power boards and mainboards for Samsung, LG, Sony and Walton TVs." },
  { key: "washer", tech: "tech-tanvir", title: "Washing Machine Repair", category: "Washing Machine", price: 35, duration: "2 hours", mode: "Home Visit", area: "Uttara & Airport", image: img("photo-1626806787461-102c1bfaaea1"), description: "Not draining, not spinning or leaking water? Front and top loaders: pumps, belts, door locks and control boards repaired at your home." },
  { key: "wiring", tech: "tech-sumaiya", title: "Home Wiring & Switchboard Fix", category: "Electrical", price: 20, duration: "1-2 hours", mode: "Home Visit", area: "Mirpur, Dhaka", image: img("photo-1621905252507-b35492cc74b4"), description: "Sparking switches, tripping breakers or new sockets. Safe, tidy wiring work with quality cables. Free safety check of your main board." },
  // FIXED image: ceiling fan (Muhammad Tayyab, Unsplash)
  { key: "fan-light", tech: "tech-sumaiya", title: "Ceiling Fan & Light Installation", category: "Electrical", price: 15, duration: "1 hour", mode: "Home Visit", area: "Mirpur & Pallabi", image: img("photo-1716913015560-a231400ce141"), description: "New fan, light or regulator installed and tested. Bring your own fixtures or I can source them. Old fittings removed for you." },
  { key: "pc-build", tech: "tech-rafi", title: "Desktop PC Troubleshooting", category: "Laptop & PC", price: 30, duration: "2 hours", mode: "Shop Drop-off", area: "Dhanmondi, Dhaka", image: img("photo-1587202372775-e229f172b9d7"), description: "PC not turning on, blue screens or random restarts. Power supply, RAM and storage testing with a clear list of what needs fixing." },
  // FIXED image: white split AC mounted on a wall (Illia Horokhovsky, Unsplash)
  { key: "ac-install", tech: "tech-sumaiya", title: "Split AC Installation", category: "AC", price: 60, duration: "4 hours", mode: "Home Visit", area: "Mirpur, Dhaka", image: img("photo-1759772238012-9d5ad59ae637"), description: "New split AC installed with proper piping, vacuuming and a neat wall finish. Includes the first gas pressure check after one week." },
  // not public: show up in the admin's Service Approval page
  { key: "tv-wallmount", tech: "tech-tanvir", title: "TV Wall Mount Setup", category: "TV", price: 15, duration: "1 hour", mode: "Home Visit", area: "Uttara, Dhaka", image: img("photo-1601944179066-29786cb9d32a"), description: "Wall mount installation for TVs up to 75 inches, with hidden cables and a level check. Bracket can be supplied if you need one.", approval: "pending" },
  { key: "phone-unlock", tech: "tech-rafi", title: "Phone Software Unlock", category: "Smartphone", price: 10, duration: "30 minutes", mode: "Shop Drop-off", area: "Dhanmondi, Dhaka", image: img("photo-1585060544812-6b45742d762f"), description: "Software flashing for phones stuck on the logo screen. Only for phones you own, with proof of purchase required at the shop.", approval: "rejected" },
];

/* -------------------------------- bookings -------------------------------- */

type SeedBooking = {
  key: string; service: string; customer: string; status: BookingStatus; createdDaysAgo: number;
  finalAmount?: number; paidDaysAgo?: number; rating?: number; review?: string; problem: string; address: string;
};

const BOOKINGS: SeedBooking[] = [
  // paid + reviewed (spread over ~6 months for the revenue chart)
  { key: "b1", service: "ac-service", customer: "cust-nusrat", status: "completed", createdDaysAgo: 160, finalAmount: 28, paidDaysAgo: 158, rating: 5, review: "Came on time, cleaned everything and the AC is much colder now. Very professional.", problem: "AC is running but the room does not get cold and water drips from the indoor unit.", address: "House 12, Road 45, Gulshan 2, Dhaka" },
  { key: "b2", service: "phone-screen", customer: "cust-arif", status: "completed", createdDaysAgo: 130, finalAmount: 38, paidDaysAgo: 129, rating: 5, review: "Screen looks like new and the touch works perfectly. Done within an hour.", problem: "Dropped my Samsung A54 and the screen is cracked with a black spot in the corner.", address: "Flat 4B, Tajmahal Road, Mohammadpur, Dhaka" },
  { key: "b3", service: "fridge-repair", customer: "cust-mitu", status: "completed", createdDaysAgo: 100, finalAmount: 45, paidDaysAgo: 98, rating: 4, review: "Fixed the cooling problem. Arrived a bit late but explained everything clearly.", problem: "The fridge stopped cooling two days ago. The light works but the compressor makes a clicking sound.", address: "House 8, Road 11, Banani, Dhaka" },
  { key: "b4", service: "laptop-service", customer: "cust-nusrat", status: "completed", createdDaysAgo: 70, finalAmount: 30, paidDaysAgo: 69, rating: 5, review: "My laptop is silent again and doesn't overheat anymore. Highly recommended.", problem: "Laptop fan is very loud and the laptop gets hot and shuts down during video calls.", address: "House 12, Road 45, Gulshan 2, Dhaka" },
  { key: "b5", service: "washer", customer: "cust-arif", status: "completed", createdDaysAgo: 40, finalAmount: 42, paidDaysAgo: 39, rating: 4, review: "Washing machine drains properly now. Fair price for the pump replacement.", problem: "Top-load washing machine does not drain the water after the wash cycle.", address: "Flat 4B, Tajmahal Road, Mohammadpur, Dhaka" },
  { key: "b6", service: "ac-gas", customer: "cust-mitu", status: "completed", createdDaysAgo: 12, finalAmount: 60, paidDaysAgo: 10, problem: "AC only blows normal air. A previous mechanic said there might be a gas leak.", address: "House 8, Road 11, Banani, Dhaka" },
  // completed but NOT paid -> the customer sees "Pay Now"
  { key: "b7", service: "phone-battery", customer: "cust-nusrat", status: "completed", createdDaysAgo: 4, finalAmount: 22, problem: "iPhone 12 battery health is 71% and the phone turns off at around 20 percent.", address: "House 12, Road 45, Gulshan 2, Dhaka" },
  // in the pipeline
  { key: "b8", service: "tv-repair", customer: "cust-mitu", status: "in-progress", createdDaysAgo: 3, problem: "TV has sound but no picture. Sometimes a faint image appears if I shine a torch.", address: "House 8, Road 11, Banani, Dhaka" },
  { key: "b9", service: "wiring", customer: "cust-arif", status: "accepted", createdDaysAgo: 2, problem: "Two sockets in the kitchen spark when plugging in and the breaker trips at night.", address: "Flat 4B, Tajmahal Road, Mohammadpur, Dhaka" },
  { key: "b10", service: "fridge-gas", customer: "cust-nusrat", status: "requested", createdDaysAgo: 1, problem: "Freezer is fine but the lower part of the fridge is not cold enough for vegetables.", address: "House 12, Road 45, Gulshan 2, Dhaka" },
  { key: "b11", service: "laptop-os", customer: "cust-mitu", status: "requested", createdDaysAgo: 0, problem: "Laptop takes five minutes to start and every program is very slow. Want an SSD.", address: "House 8, Road 11, Banani, Dhaka" },
  // closed without work
  { key: "b12", service: "fan-light", customer: "cust-nusrat", status: "rejected", createdDaysAgo: 20, problem: "Need two ceiling fans installed in the bedrooms on the same day, before 9 am.", address: "House 12, Road 45, Gulshan 2, Dhaka" },
  { key: "b13", service: "pc-build", customer: "cust-arif", status: "cancelled", createdDaysAgo: 15, problem: "Desktop PC restarts while gaming. I think it might be the power supply unit.", address: "Flat 4B, Tajmahal Road, Mohammadpur, Dhaka" },
];

/** The timeline a booking went through to reach its status (Job Timeline Tracker). */
function historyFor(status: BookingStatus, created: Date, paidAt?: Date): StatusHistoryEntry[] {
  const at = (hours: number) => new Date(created.getTime() + hours * 60 * 60 * 1000);
  const path: Record<BookingStatus, BookingStatus[]> = {
    requested: ["requested"],
    accepted: ["requested", "accepted"],
    "in-progress": ["requested", "accepted", "in-progress"],
    completed: ["requested", "accepted", "in-progress", "completed"],
    rejected: ["requested", "rejected"],
    cancelled: ["requested", "cancelled"],
  };
  const history: StatusHistoryEntry[] = path[status].map((s, i) => ({ status: s, changedAt: at(i * 3) }));
  if (paidAt) history.push({ status: "paid", changedAt: paidAt });
  return history;
}

/* ---------------------------------- run ---------------------------------- */

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "";
  if (!adminEmail || !adminPassword || !demoPassword) {
    throw new Error("Add SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD to .env first.");
  }
  if (!strongEnough(adminPassword) || !strongEnough(demoPassword)) {
    throw new Error("Seed passwords need 6+ characters with an uppercase and a lowercase letter.");
  }

  const db = await connectDB();
  const users = db.collection<UserDoc & Document>("user");
  const accounts = db.collection("account");
  const services = db.collection<ServiceDoc>("services");
  const bookings = db.collection<BookingDoc>("bookings");
  const payments = db.collection<PaymentDoc>("payments");

  // Never overwrite a REAL user: stop if a seed email already belongs to someone else
  for (const p of PEOPLE) {
    const existing = await users.findOne({ email: p.email }, { projection: { _id: 1 } });
    if (existing && !existing._id.equals(idFor(`user:${p.key}`))) {
      throw new Error(`${p.email} is already used by a real account. Delete it in Atlas or change the seed email.`);
    }
  }

  /* 1. users + credential accounts */
  for (const p of PEOPLE) {
    const _id = idFor(`user:${p.key}`);
    const created = daysAgo(200);
    await users.replaceOne(
      { _id },
      {
        name: p.name, email: p.email, emailVerified: true, image: null, createdAt: created, updatedAt: new Date(),
        role: p.role, phone: p.phone, area: p.area, bio: p.bio, plan: p.plan ?? "free",
        // seeded Pro plans have no real Stripe subscription; "Cancel Pro" still works (Stripe says not found -> back to Free)
        stripeSubscriptionId: p.plan === "pro" ? `seed_sub_${p.key}` : null,
      } as UserDoc & Document,
      { upsert: true }
    );
    await accounts.replaceOne(
      { _id: idFor(`account:${p.key}`) },
      {
        accountId: _id.toHexString(), providerId: "credential", userId: _id,
        password: await hashPassword(p.role === "admin" ? adminPassword : demoPassword),
        createdAt: created, updatedAt: new Date(),
      },
      { upsert: true }
    );
  }
  console.log(`✅ ${PEOPLE.length} users (1 admin, 3 technicians, 3 customers)`);

  /* 2. services (upsert: a deleted seed service is created again) */
  for (const [i, s] of SERVICES.entries()) {
    const tech = person(s.tech);
    await services.replaceOne(
      { _id: idFor(`service:${s.key}`) },
      {
        title: s.title, category: s.category, description: s.description, image: s.image, basePrice: s.price,
        estimatedDuration: s.duration, serviceMode: s.mode, serviceArea: s.area,
        technicianName: tech.name, technicianEmail: tech.email, technicianPlan: tech.plan ?? "free",
        approvalStatus: s.approval ?? "approved", isAvailable: true,
        createdAt: daysAgo(190 - i * 6), ratingAverage: 0, ratingCount: 0,
      },
      { upsert: true }
    );
  }
  console.log(`✅ ${SERVICES.length} services (${SERVICES.filter((s) => !s.approval).length} approved, 1 pending, 1 rejected)`);

  /* 3. bookings + job payments */
  for (const b of BOOKINGS) {
    const s = SERVICES.find((x) => x.key === b.service)!;
    const tech = person(s.tech);
    const customer = person(b.customer);
    const serviceId = idFor(`service:${s.key}`).toHexString();
    const bookingId = idFor(`booking:${b.key}`);
    const created = daysAgo(b.createdDaysAgo, 9);
    const paidAt = b.paidDaysAgo !== undefined ? daysAgo(b.paidDaysAgo, 15) : undefined;

    await bookings.replaceOne(
      { _id: bookingId },
      {
        serviceId, serviceTitle: s.title, serviceImage: s.image, category: s.category, basePrice: s.price,
        technicianName: tech.name, technicianEmail: tech.email,
        customerName: customer.name, customerEmail: customer.email, customerPhone: customer.phone,
        address: b.address, preferredDate: dateOnly(new Date(created.getTime() + 2 * DAY)), problemDescription: b.problem,
        status: b.status, finalAmount: b.finalAmount ?? 0, paymentStatus: paidAt ? "paid" : "unpaid",
        createdAt: created, statusHistory: historyFor(b.status, created, paidAt),
        ...(b.rating && { rating: b.rating, review: b.review!, reviewedAt: new Date(paidAt!.getTime() + DAY) }),
      },
      { upsert: true }
    );

    if (paidAt) {
      await payments.replaceOne(
        { _id: idFor(`payment:${b.key}`) },
        {
          type: "job", bookingId: bookingId.toHexString(), serviceTitle: s.title,
          customerName: customer.name, customerEmail: customer.email, technicianName: tech.name, technicianEmail: tech.email,
          amount: b.finalAmount!, currency: "usd", transactionId: `pi_seed_${b.key}`, stripeSessionId: `cs_seed_${b.key}`,
          paymentStatus: "paid", paidAt,
        },
        { upsert: true }
      );
    }
  }

  /* 4. one Pro plan payment for each Pro technician */
  for (const p of PEOPLE.filter((x) => x.plan === "pro")) {
    await payments.replaceOne(
      { _id: idFor(`payment:pro:${p.key}`) },
      {
        type: "subscription", serviceTitle: "Pro Technician Plan (1 month)",
        customerName: p.name, customerEmail: p.email, technicianName: p.name, technicianEmail: p.email,
        amount: 9.99, currency: "usd", transactionId: `seed_sub_${p.key}`, stripeSessionId: `in_seed_${p.key}`,
        paymentStatus: "paid", paidAt: daysAgo(20, 12),
      },
      { upsert: true }
    );
  }
  console.log(`✅ ${BOOKINGS.length} bookings in every status, ${BOOKINGS.filter((b) => b.paidDaysAgo !== undefined).length} job payments + 2 Pro plan payments`);

  /* 5. ratings on services (same formula as updateServiceRating) */
  for (const s of SERVICES) {
    const reviewed = BOOKINGS.filter((b) => b.service === s.key && b.rating);
    if (reviewed.length === 0) continue;
    const average = reviewed.reduce((sum, b) => sum + b.rating!, 0) / reviewed.length;
    await services.updateOne(
      { _id: idFor(`service:${s.key}`) },
      { $set: { ratingAverage: Math.round(average * 10) / 10, ratingCount: reviewed.length } }
    );
  }
  console.log(`✅ ${BOOKINGS.filter((b) => b.rating).length} reviews`);

  console.log("\nSign in with:");
  console.log(`  admin       ${adminEmail}  (SEED_ADMIN_PASSWORD)`);
  for (const p of PEOPLE.filter((x) => x.role !== "admin")) console.log(`  ${p.role.padEnd(11)} ${p.email}  (SEED_DEMO_PASSWORD)${p.plan === "pro" ? "  Pro" : ""}`);
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDB());