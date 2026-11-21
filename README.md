# Tuitora Backend

REST API for **Tuitora** — a tutoring marketplace where tutors post tuition batches, students browse/book them, and admins moderate the platform. Built with Express 5 and MongoDB, with custom JWT authentication and role-based access control that is fully compatible with the Tuitora Next.js frontend.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running the App](#running-the-app)
- [Authentication & Roles](#authentication--roles)
- [API Reference](#api-reference)
- [Demo Data / Seeding](#demo-data--seeding)
- [Notes](#notes)

---

## Features

- **Public course browsing** — server-side search, filtering (subject, class level, mode, fee, days), sorting and pagination with sidebar facet counts.
- **JWT authentication** — dependency-free HS256 tokens verified with Node's built-in `crypto`; the same secret as the frontend so tokens minted there just work here.
- **Role-based access control** — `student`, `tutor` (alias: legacy `teacher`) and `admin` guards on protected routes.
- **Tutor workflow** — tutors create tuitions; identity comes from the verified token. New posts start as `pending` for admin review.
- **Admin moderation** — approve/decline/update/delete tuitions and list all users (passwords excluded).
- **Student favourites** — save/remove/list favourite tuitions.
- **Reviews** — only students with an accepted application can leave a 1–5 star review; one review per tuition per student.
- **Image uploads** — direct base64 image uploads to ImgBB.
- **Connected demo data** — reproducible seed script that links tutors → tuitions → applications → reviews.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js (ES Modules) |
| Framework | Express 5 |
| Database | MongoDB (MongoDB Atlas) |
| Auth | Custom JWT (HS256) via `node:crypto` |
| CORS | `cors` |
| Config | `dotenv` |
| Image hosting | ImgBB API |
| HTTP client | Native `fetch` (Node 18+) |

---

## Project Structure

```
tuitora-backend/
├── index.js                 # Express app, MongoDB connection and all routes
├── middleware/
│   └── auth.js              # JWT verification + role guards
├── lib/
│   └── seed.js              # Shared demo-data seeding logic
├── scripts/
│   ├── seed.mjs             # CLI seed script (npm run seed)
│   └── seed-data.json       # Seed dataset (tutors, students, tuitions, etc.)
├── .env                     # Local environment configuration (not committed)
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js 18+** (for native `fetch` and ES module support)
- **npm**
- A **MongoDB** instance — the defaults target a MongoDB Atlas cluster
- (Optional) An **ImgBB** API key for image uploads

### Installation

```bash
git clone <repository-url>
cd tuitora-backend
npm install
```

### Configuration

Create a `.env` file in the project root (see [Environment Variables](#environment-variables)). The `.env` file is git-ignored and must never be committed.

---

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port the server listens on. Defaults to `5000`. |
| `MONGODB_URI` | No | Full MongoDB connection string. If omitted, one is built from `DB_USER`/`DB_PASSWORD`. |
| `DB_USER` | Yes* | Atlas database username (used when `MONGODB_URI` is not set). |
| `DB_PASSWORD` | Yes* | Atlas database password (used when `MONGODB_URI` is not set). |
| `JWT_SECRET` | Yes | Secret used to sign/verify tokens. **Must match the frontend's secret.** |
| `BETTER_AUTH_SECRET` | No | Fallback secret if `JWT_SECRET` is absent. |
| `IMAGEBB_API_KEY` | For uploads | ImgBB API key used by `POST /api/upload`. |
| `FRONTEND_URL` | No | Allowed CORS origin for the Next.js app. Defaults to `http://localhost:3000`. |

\* Required only when `MONGODB_URI` is not provided.

Example `.env` (use your own values — do not reuse real secrets):

```env
DB_USER=your_atlas_user
DB_PASSWORD=your_atlas_password
JWT_SECRET=replace_with_a_long_random_secret
BETTER_AUTH_SECRET=replace_with_a_long_random_secret
IMAGEBB_API_KEY=your_imgbb_api_key
FRONTEND_URL=http://localhost:3000
PORT=5000
```

> **Important:** `JWT_SECRET` (or `BETTER_AUTH_SECRET`) must be identical to the secret used by the frontend (`tuitora-frontend/lib/jwt.ts`). Otherwise tokens created by the frontend will fail verification here.

---

## Running the App

```bash
# Production-style start
npm start

# Development with auto-reload on file changes
npm run dev

# Seed the database with demo data
npm run seed
```

The server log should print `You successfully connected to MongoDB!` and `Server is running on port 5000`.

Health check:

```bash
curl http://localhost:5000/
```

---

## Authentication & Roles

Protected routes expect a Bearer token:

```
Authorization: Bearer <jwt>
```

The token is an HS256 JWT with claims `{ sub, role, email, iat, exp }`. Signature, expiry and subject are verified before any claim is trusted. Missing, malformed, tampered or expired tokens return **401**; insufficient role returns **403**.

| Role | Allowed actions |
| --- | --- |
| `student` | Browse courses, favourite tuitions, post reviews (accepted applicants only). |
| `tutor` | Everything a student can do, plus create tuitions. |
| `admin` | Everything, plus moderate tuitions and list users. |

`teacher` is treated as a legacy alias of `tutor`.

Useful debug endpoint:

```
GET /me        -> returns the decoded user from a valid token
```

---

## API Reference

Base URL: `http://localhost:5000`

### Public

#### `GET /`
Service info and endpoint list.

#### `GET /courses`
Browse approved, active tuitions.

Supported query parameters:

| Param | Description |
| --- | --- |
| `search`, `q` | Free-text search over title, subject, description and tutor name. |
| `subject` | Filter by subject (`All Subjects` skips filtering). |
| `classLevel` | Filter by level, e.g. `class-1-5`, `class-6-8`, `ssc`, `hsc`, `university`. |
| `mode` | `online` or `offline`. |
| `minFee`, `maxFee` | Numeric fee range. |
| `days` | Number of days per week. |
| `sort` | `oldest`, `fee-asc`, `fee-desc`, `title`, `rating`, `reviews` (default: newest). |
| `status` | Override status filter (default: `approved`). |
| `page`, `limit` | Pagination (`limit` capped at 60, default 12). |

When `page` or `limit` is present, the response includes `pagination` and `facets` metadata.

Example:

```bash
curl "http://localhost:5000/courses?search=math&mode=online&sort=fee-asc&page=1&limit=12"
```

#### `GET /courses/:id`
Fetch a single approved tuition by Mongo `_id` (or string id).

#### `GET /reviews`
List all reviews. Use `?scope=mine` with a Bearer token to list the current student's reviews.

### Protected

#### `POST /courses` — `tutor`, `admin`
Create a tuition. Required fields: `title`, `subject`, `classLevel`, `mode`, `fee`, `days`. The new tuition is created with `status: pending`.

#### `PATCH /courses/:id` — `admin`
Moderate a tuition (e.g. `{ "status": "approved" }`). Setting `status` also updates `approvalStatus`, `reviewedAt` and `reviewedBy`. Fee/day fields are normalised automatically.

#### `DELETE /courses/:id` — `admin`
Delete a tuition.

#### `GET /users` — `admin`
List all users (passwords excluded).

#### `POST /api/upload` — any authenticated user
Upload an image to ImgBB. Send base64 in the `image` (or `base64`) field and an optional `name`. Max size 32 MB. Data-URL prefixes are stripped automatically.

```json
{ "image": "<base64-or-data-url>", "name": "tuition-banner" }
```

Returns `{ url, displayUrl, thumbUrl, name }`.

#### `GET /api/favorites` — `student`
List the current student's favourite tuition ids.

#### `POST /api/favorites` — `student`
Add a favourite. Body: `{ "tuitionId": "..." }`.

#### `DELETE /api/favorites` — `student`
Remove a favourite. Body: `{ "tuitionId": "..." }`.

#### `POST /reviews` — `student`
Create a review. Body: `{ "tuitionId": "...", "rating": 5, "comment": "Great class!" }`.

Requires an accepted/enrolled application for that tuition and no prior review from the student. Rating must be an integer 1–5 and comment at least 3 characters.

#### `POST /api/seed` — `admin`
Run the demo-data seeder against the connected database. Safe to call repeatedly (all writes are upserts).

---

## Demo Data / Seeding

The seeder creates a connected set of records and upserts by stable keys, so re-running it never duplicates data.

```bash
npm run seed
```

Or, with an admin token:

```bash
curl -X POST http://localhost:5000/api/seed \
  -H "Authorization: Bearer <admin-jwt>"
```

The dataset lives in `scripts/seed-data.json` and includes tutors, students, tuitions, application statuses and review comments. It returns a summary like:

```json
{ "ok": true, "users": 12, "tuitions": 10, "applications": 10, "reviews": 5 }
```

---

## Notes

- The app uses **top-level `await`** to connect to MongoDB before defining/starting routes (ES modules).
- CORS allows both `FRONTEND_URL` and `http://localhost:3000` with credentials; allowed headers are `Content-Type` and `Authorization`.
- JSON bodies are accepted up to 40 MB to accommodate base64 images.
- Seed user emails use fixed addresses so tutor posts can be linked by `tutorEmail` even when ids differ.
- Keep `.env` out of version control. Rotate any credentials that were ever committed.
