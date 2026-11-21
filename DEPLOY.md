# Deploying the Tuitora backend to Vercel

## Files in this repo that make it work

| File | Purpose |
| --- | --- |
| `api/index.js` | Vercel serverless entry point — re-exports the Express `app`. |
| `vercel.json` | Rewrites every incoming path to `/api/index.js`. |
| `index.js` | Express app. `app.listen()` only runs locally (`VERCEL !== "1"`). MongoDB connects lazily on first DB request so a bad connection never crashes the function at load time. |
| `.env.example` | List of environment variables to add in Vercel. |

## One-time Vercel setup

1. Push this repo to GitHub.
2. Vercel → **Add New → Project** → import the repo. Vercel detects the `api/` folder and Node.js automatically. **No build command and no output directory are needed.**
3. **Settings → Environment Variables** — add each key separately, ticking **Production**, **Preview** and **Development**:

   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<real-cluster-host>/?retryWrites=true&w=majority
   JWT_SECRET=<same secret as the frontend>
   BETTER_AUTH_SECRET=<same secret as the frontend>
   IMAGEBB_API_KEY=<key>
   FRONTEND_URL=https://<your-frontend>.vercel.app
   ```

   - Do **not** set `PORT` — Vercel does not use it.
   - Do **not** set `DB_USER` / `DB_PASSWORD` when `MONGODB_URI` is set.
   - `MONGODB_URI` must be a single line copied from Atlas → Connect → Drivers.

4. MongoDB Atlas → **Network Access → Add IP Address → Allow Access from Anywhere (`0.0.0.0/0`) → Confirm**. Vercel's IPs are dynamic.
5. **Deployments → `⋯` → Redeploy** after any env change.

### Optional: push the variables from the local `.env` automatically

Log in and link the repo once:

```bash
npx vercel login
npx vercel link --yes
```

Then push every key (the deployed frontend URL is written into `FRONTEND_URL`, and `MONGODB_URI` is built from the local `DB_USER`/`DB_PASSWORD`):

```bash
npm run setup:vercel -- https://<your-frontend>.vercel.app
npm run setup:vercel -- https://<your-frontend>.vercel.app --dry-run   # preview only, secrets masked
```

`PORT`, `DB_USER` and `DB_PASSWORD` are deliberately skipped. Redeploy afterwards.

## Verify

- `https://<project>.vercel.app/` → `{"service":"Tuitora API","endpoints":[...]}`
- `https://<project>.vercel.app/courses` → JSON list (may be empty until data is seeded).
- Vercel → **Runtime Logs** should contain `You successfully connected to MongoDB!` after the first DB request.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `500 FUNCTION_INVOCATION_FAILED` | Check Runtime Logs. Usually a wrong `MONGODB_URI`, missing env var, or Atlas IP whitelist. |
| `npm warn Unknown env config "cache-dir"` | Harmless Vercel/npm warning — ignore. |
| CORS error in the browser | `FRONTEND_URL` must exactly match the deployed frontend origin. |
| Empty `/courses` | No approved data yet — run `POST /api/seed` with an admin token or `npm run seed`. |
