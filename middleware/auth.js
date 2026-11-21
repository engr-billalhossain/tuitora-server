/* ==========================================================================
   Custom JWT + role middlewares for the Express API.

   The token format matches the one minted by the Next.js app
   (`tuitora-frontend/lib/jwt.ts`): HS256, base64url header/payload/signature,
   claims { sub, role, email, iat, exp }. No extra dependency is needed —
   Node's built-in crypto verifies the exact same signature the frontend
   creates with `createHmac('sha256', secret)`.

   Usage:
     app.get('/me', verifyToken, handler)
     app.post('/courses', verifyToken, verifyTutor, handler)
     app.get('/users', verifyToken, verifyAdmin, handler)
   ========================================================================== */

import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.BETTER_AUTH_SECRET ||
  "mentorlagbe-dev-jwt-secret";

/** `teacher` is a legacy alias for `tutor` across the whole project. */
export function normalizeRole(role) {
  const value = String(role || "student").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "tutor" || value === "teacher") return "tutor";
  return "student";
}

function sign(data) {
  return createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function unauthorized(res, message) {
  return res.status(401).json({ error: message });
}

function forbidden(res, message) {
  return res.status(403).json({ error: message });
}

/**
 * Verifies the Bearer JWT, checks `exp`, and attaches the decoded identity to
 * `req.user` ({ id, role, email }). Rejects with 401 when the token is missing,
 * malformed, tampered with or expired.
 */
export function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (!/^Bearer$/i.test(scheme || "") || !token || rest.length) {
    return unauthorized(res, "Authorization bearer token is required");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return unauthorized(res, "Invalid authentication token");
  }
  const [encodedHeader, encodedPayload, signature] = parts;

  // Verify the signature before trusting any claim in the payload.
  const expected = sign(`${encodedHeader}.${encodedPayload}`);
  if (!constantTimeEqual(expected, signature)) {
    return unauthorized(res, "Invalid authentication token signature");
  }

  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      )
    );
  } catch {
    return unauthorized(res, "Malformed authentication token");
  }

  if (!claims || !claims.sub) {
    return unauthorized(res, "Authentication token has no subject");
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) {
    return unauthorized(res, "Authentication token has expired");
  }

  req.user = {
    id: String(claims.sub),
    role: normalizeRole(claims.role),
    email: claims.email ? String(claims.email) : undefined,
    claims,
  };
  return next();
}

/** Generic role guard — `verifyRole("tutor", "admin")`. */
export function verifyRole(...allowed) {
  const roles = allowed.map(normalizeRole);
  return (req, res, next) => {
    if (!req.user) return unauthorized(res, "Authentication required");
    if (!roles.includes(req.user.role)) {
      return forbidden(res, "You do not have permission to perform this action");
    }
    return next();
  };
}

export const verifyStudent = verifyRole("student");
export const verifyTutor = verifyRole("tutor");
export const verifyAdmin = verifyRole("admin");
