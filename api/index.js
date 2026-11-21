/* ==========================================================================
   Vercel serverless entry point.

   The Express app, its middleware and the MongoDB connection all live in
   ../index.js.  We simply re-export the app so Vercel can hand every incoming
   request to it.  vercel.json rewrites all paths to this function.
   ========================================================================== */

import { app } from "../index.js";

export default app;
