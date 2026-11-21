/* ==========================================================================
   Tuitora REST API (Express + MongoDB)

   - Public:    GET /courses (server-side search, filter, sort & pagination)
   - JWT:       every write / private route is guarded by verifyToken plus a
                role middleware (verifyStudent / verifyTutor / verifyAdmin).
   - Media:     POST /api/upload uploads an image file straight to ImgBB.
   - Optional:  favourites, accepted-student reviews and admin data seeding.
   ========================================================================== */

import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient } from "mongodb";

import {
  verifyToken,
  verifyStudent,
  verifyTutor,
  verifyAdmin,
} from "./middleware/auth.js";
import { seedDemoData } from "./lib/seed.js";

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";

/* ------------------------------- middleware ------------------------------ */
app.use(
  cors({
    origin: [CLIENT_ORIGIN, "http://localhost:3000"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "40mb" }));

/* --------------------------------- mongo --------------------------------- */
// LAZY CONNECTION (important for Vercel):
// A top-level `await connectToMongoDB()` used to throw at module load whenever
// Atlas was unreachable, which made Vercel return a generic
// 500 FUNCTION_INVOCATION_FAILED. Now the client is created once per serverless
// container and connects on the first request that actually needs the DB.
const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${encodeURIComponent(process.env.DB_USER || "")}:${encodeURIComponent(process.env.DB_PASSWORD || "")}@cluster0.xdlqhda.mongodb.net/?retryWrites=true&w=majority`;

let client;
let dbPromise;

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      console.log("You successfully connected to MongoDB!");
      const database = client.db("tuitoradb");
      await database
        .collection("favorites")
        .createIndex({ userId: 1, tuitionId: 1 }, { unique: true });
      return database;
    })().catch((err) => {
      dbPromise = null; // allow a retry on the next request
      console.error("MongoDB connection failed:", err);
      throw err;
    });
  }
  return dbPromise;
}

/* -------------------------------- helpers -------------------------------- */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regex(value) {
  return new RegExp(escapeRegex(value), "i");
}

const LEVEL_TOKENS = {
  "class-1-5": ["class 1", "class 1 – 5", "class 1-5"],
  "class-6-8": ["class 6", "6 – 8", "6-8"],
  ssc: ["ssc", "class 9", "9 – 10", "9-10"],
  hsc: ["hsc", "class 11", "11 – 12", "11-12"],
  university: ["univers", "admission", "ielts"],
};

function classLevelMatch(key) {
  const tokens = LEVEL_TOKENS[key];
  if (!tokens) return null;
  return { $or: tokens.map((token) => ({ classLevel: regex(token) })) };
}

function numeric(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Builds the MongoDB filter used by the public browse endpoint. */
export function buildCourseFilter(query = {}) {
  const filter = {
    status: query.status || "approved",
    isActive: { $ne: false },
  };
  const and = [];

  // Search by tuition title OR subject (plus tutor/description as a bonus).
  const search = String(query.search || query.q || "").trim();
  if (search) {
    and.push({
      $or: ["title", "subject", "description", "tutorName"].map((field) => ({
        [field]: regex(search),
      })),
    });
  }
  if (query.subject && query.subject !== "All Subjects") {
    and.push({ subject: regex(query.subject) });
  }
  if (query.classLevel && query.classLevel !== "All Class Levels") {
    const match = classLevelMatch(query.classLevel);
    if (match) and.push(match);
    else and.push({ classLevel: regex(query.classLevel) });
  }
  const mode = String(query.mode || "")
    .trim()
    .toLowerCase();
  if (mode === "online" || mode === "offline") {
    and.push({ mode: regex(mode) });
  }
  if (query.minFee !== undefined || query.maxFee !== undefined) {
    const fee = {};
    if (query.minFee !== undefined) fee.$gte = numeric(query.minFee);
    if (query.maxFee !== undefined) fee.$lte = numeric(query.maxFee);
    and.push({
      $or: [
        { feeValue: fee },
        {
          $and: [
            { feeValue: { $exists: false } },
            { monthlyFee: { $regex: /^\d/ } },
          ],
        },
      ],
    });
  }
  if (query.days && /^\d+$/.test(String(query.days))) {
    and.push({
      $or: [
        { daysValue: Number(query.days) },
        { days: regex(`${query.days} Days`) },
        { daysPerWeek: regex(`${query.days} Days`) },
      ],
    });
  }
  if (and.length) filter.$and = and;
  return filter;
}

const SORT_MAP = {
  oldest: { createdAt: 1 },
  "fee-asc": { feeValue: 1, createdAt: -1 },
  "fee-desc": { feeValue: -1, createdAt: -1 },
  title: { title: 1 },
  rating: { rating: -1, createdAt: -1 },
  reviews: { reviews: -1, createdAt: -1 },
};

/* --------------------------------- routes -------------------------------- */
app.get("/", (_req, res) => {
  res.json({
    service: "Tuitora API",
    endpoints: ["/courses", "/courses/:id", "/me", "/api/upload"],
  });
});

/** Handy endpoint to confirm a JWT works and see the role the middleware read. */
app.get("/me", verifyToken, (req, res) => {
  res.json({ user: req.user });
});

/**
 * GET /courses — server-side search, filter, sort and pagination.
 * ?search=&subject=&classLevel=&mode=&status=&sort=&page=1&limit=12
 */
app.get("/courses", async (req, res) => {
  try {
    const db = await getDb();
    const courses = db.collection("courses");
    const filter = buildCourseFilter(req.query);
    const wantsPagination =
      req.query.page !== undefined || req.query.limit !== undefined;

    const sort = SORT_MAP[req.query.sort] || { createdAt: -1 };
    const cursor = courses.find(filter).sort(sort);

    if (!wantsPagination) {
      const result = await cursor.toArray();
      return res.json({ tuitions: result, data: result, total: result.length });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      60,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 12),
    );
    const total = await courses.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const tuitions = await cursor
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    // Facet counts for the sidebar are computed from the status filter only,
    // so they stay stable while other filters change.
    const base = { status: filter.status, isActive: { $ne: false } };
    const [online, offline, ...levelCounts] = await Promise.all([
      courses.countDocuments({ ...base, mode: regex("online") }),
      courses.countDocuments({ ...base, mode: regex("offline") }),
      ...Object.keys(LEVEL_TOKENS).map((key) =>
        courses.countDocuments({ ...base, ...classLevelMatch(key) }),
      ),
    ]);

    return res.json({
      tuitions,
      data: tuitions,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prev: page > 1 ? page - 1 : null,
        next: page < totalPages ? page + 1 : null,
      },
      facets: {
        modes: { online, offline },
        levels: Object.fromEntries(
          Object.keys(LEVEL_TOKENS).map((key, index) => [
            key,
            levelCounts[index],
          ]),
        ),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/courses/:id", async (req, res) => {
  try {
    const db = await getDb();
    const courses = db.collection("courses");
    const { id } = req.params;
    const query = { $or: [{ _id: id }] };
    const { ObjectId } = await import("mongodb");
    if (ObjectId.isValid(id)) query.$or.push({ _id: new ObjectId(id) });
    const tuition = await courses.findOne({ ...query, status: "approved" });
    if (!tuition) return res.status(404).json({ error: "Tuition not found" });
    return res.json({ tuition });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /courses — tutors/admin only; identity comes from the verified token. */
app.post("/courses", verifyToken, verifyTutor, async (req, res) => {
  try {
    const db = await getDb();
    const courses = db.collection("courses");
    const body = req.body || {};
    for (const key of [
      "title",
      "subject",
      "classLevel",
      "mode",
      "fee",
      "days",
    ]) {
      if (!String(body[key] ?? "").trim()) {
        return res
          .status(400)
          .json({ error: `Missing required field: ${key}` });
      }
    }
    const doc = {
      ...body,
      fee: String(body.fee),
      monthlyFee: String(body.fee),
      feeValue: numeric(body.fee),
      days: String(body.days),
      daysPerWeek: String(body.days),
      daysValue: numeric(body.days),
      status: "pending",
      approvalStatus: "pending",
      isActive: true,
      tutorId: req.user.id,
      tutorEmail: req.user.email || body.tutorEmail || "",
      tutorName: body.tutorName || req.user.claims?.name || "Tutor",
      createdAt: new Date().toISOString(),
    };
    const result = await courses.insertOne(doc);
    return res
      .status(201)
      .json({ insertedId: result.insertedId, tuition: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** Admin moderation. */
app.patch("/courses/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const courses = db.collection("courses");
    const { id } = req.params;
    const { ObjectId } = await import("mongodb");
    const query = { $or: [{ _id: id }] };
    if (ObjectId.isValid(id)) query.$or.push({ _id: new ObjectId(id) });

    const update = { ...(req.body || {}) };
    if (update.status) {
      update.approvalStatus =
        update.status === "declined" ? "rejected" : update.status;
      update.reviewedAt = new Date().toISOString();
      update.reviewedBy = req.user.id;
    }
    if (update.fee !== undefined) {
      update.monthlyFee = String(update.fee);
      update.feeValue = numeric(update.fee);
    }
    if (update.days !== undefined) {
      update.daysPerWeek = String(update.days);
      update.daysValue = numeric(update.days);
    }
    const result = await courses.findOneAndUpdate(
      query,
      { $set: update },
      { returnDocument: "after" },
    );
    if (!result) return res.status(404).json({ error: "Tuition not found" });
    return res.json({ tuition: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/courses/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const courses = db.collection("courses");
    const { id } = req.params;
    const { ObjectId } = await import("mongodb");
    const query = { $or: [{ _id: id }] };
    if (ObjectId.isValid(id)) query.$or.push({ _id: new ObjectId(id) });
    const result = await courses.deleteOne(query);
    if (!result.deletedCount)
      return res.status(404).json({ error: "Tuition not found" });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** User directory — admin only. */
app.get("/users", verifyToken, verifyAdmin, async (_req, res) => {
  try {
    const db = await getDb();
    const users = db.collection("user");
    const result = await users
      .find({}, { projection: { password: 0 } })
      .toArray();
    return res.json({ users: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ------------------------- ImgBB direct file upload ---------------------- */
app.post("/api/upload", verifyToken, async (req, res) => {
  try {
    const apiKey = process.env.IMAGEBB_API_KEY;
    if (!apiKey)
      return res.status(500).json({ error: "IMAGEBB_API_KEY is not set" });

    const { image, name, base64 } = req.body || {};
    const raw = image || base64;
    if (typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({
        error: "Send the image as a base64 string in the `image` field",
      });
    }
    const clean = raw.includes(",") ? raw.split(",").slice(1).join(",") : raw;
    const bytes = Buffer.from(clean, "base64");
    if (!bytes.length || bytes.length > 32 * 1024 * 1024) {
      return res
        .status(400)
        .json({ error: "Image must be smaller than 32 MB" });
    }

    const form = new FormData();
    form.append("key", apiKey);
    form.append("image", bytes.toString("base64"));
    form.append("name", String(name || "tuition-image"));

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!payload.success || !payload.data?.url) {
      return res
        .status(502)
        .json({ error: payload.error?.message || "ImgBB upload failed" });
    }
    return res.json({
      url: payload.data.url,
      displayUrl: payload.data.display_url,
      thumbUrl: payload.data.thumb?.url || payload.data.url,
      name: String(name || "tuition-image"),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* --------------------------- student favourites -------------------------- */
app.get("/api/favorites", verifyStudent, async (req, res) => {
  try {
    const db = await getDb();
    const favorites = db.collection("favorites");
    const items = await favorites
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ tuitionIds: items.map((item) => item.tuitionId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/favorites", verifyStudent, async (req, res) => {
  try {
    const db = await getDb();
    const favorites = db.collection("favorites");
    const tuitionId = String(req.body?.tuitionId || "").trim();
    if (!tuitionId)
      return res.status(400).json({ error: "tuitionId is required" });
    await favorites.updateOne(
      { userId: req.user.id, tuitionId },
      { $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true },
    );
    return res.status(201).json({ saved: true, tuitionId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/favorites", verifyStudent, async (req, res) => {
  try {
    const db = await getDb();
    const favorites = db.collection("favorites");
    const tuitionId = String(req.body?.tuitionId || "").trim();
    if (!tuitionId)
      return res.status(400).json({ error: "tuitionId is required" });
    await favorites.deleteOne({ userId: req.user.id, tuitionId });
    return res.json({ saved: false, tuitionId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------- accepted-student reviews (bonus feature) --------------- */
app.get("/reviews", async (req, res) => {
  try {
    const db = await getDb();
    const reviews = db.collection("reviews");
    const query = {};
    if (req.query.scope === "mine") {
      if (!req.headers.authorization) {
        return res.status(401).json({ error: "Authorization required" });
      }
      // Re-use the token guard for the "mine" scope.
      return verifyToken(req, res, async () => {
        query.studentId = req.user.id;
        const result = await reviews
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        return res.json({ reviews: result });
      });
    }
    const result = await reviews.find(query).sort({ createdAt: -1 }).toArray();
    return res.json({ reviews: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/reviews", verifyToken, verifyStudent, async (req, res) => {
  try {
    const db = await getDb();
    const reviews = db.collection("reviews");
    const bookings = db.collection("bookings");
    const { tuitionId, rating, comment } = req.body || {};
    const stars = Number(rating);
    const text = String(comment || "").trim();
    if (
      !tuitionId ||
      !Number.isInteger(stars) ||
      stars < 1 ||
      stars > 5 ||
      text.length < 3
    ) {
      return res
        .status(400)
        .json({ error: "Provide a tuition, a 1–5 rating and a comment" });
    }
    const accepted = await bookings.findOne({
      tuitionId: String(tuitionId),
      studentId: req.user.id,
      status: { $in: ["accepted", "enrolled"] },
    });
    if (!accepted) {
      return res.status(403).json({
        error: "Only students with an accepted application can review",
      });
    }
    const existing = await reviews.findOne({
      tuitionId: String(tuitionId),
      studentId: req.user.id,
    });
    if (existing)
      return res
        .status(409)
        .json({ error: "You already reviewed this tuition" });

    const doc = {
      tuitionId: String(tuitionId),
      studentId: req.user.id,
      studentName: req.user.claims?.name || "Student",
      rating: stars,
      comment: text.slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    const result = await reviews.insertOne(doc);
    return res.status(201).json({ review: { ...doc, _id: result.insertedId } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ------------------- admin-only demo data seeding endpoint --------------- */
app.post("/api/seed", verifyToken, verifyAdmin, async (_req, res) => {
  try {
    const summary = await seedDemoData(await getDb());
    return res.json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* --------------------------------- start --------------------------------- */
// Vercel imports the exported app and invokes it as a serverless function, so
// opening a local HTTP server there would be pointless (and can break the
// deployment). Locally — `npm start` / `npm run dev` — we still listen normally.
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
export { app, getDb, client };
