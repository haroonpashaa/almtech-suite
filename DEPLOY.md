# Deploying to Vercel — step-by-step

The project is fully prepared for Vercel. Follow these steps once and your app is live.

---

## Step 0 — What you'll end up with

- A public URL like `https://almtech-suite.vercel.app` (Vercel-provided) or `https://suite.almtech.org` (your subdomain).
- Always available — Vercel serverless functions are very fast (~1 sec cold start, then warm).
- ₨0 per month forever on Vercel's Hobby tier.
- Staff log in from any device, anywhere in the world.

---

## Step 1 — Sign up for MongoDB Atlas (5 min)

1. Open https://www.mongodb.com/cloud/atlas/register
2. Sign up with email + password.
3. When prompted, create an **M0 (Free Forever)** cluster.
4. Region: pick **Mumbai (ap-south-1)** or Singapore.
5. Cluster name: leave default or call it `almtech`.
6. After ~3 min, the cluster is ready.
7. Atlas → **Database Access** → **Add New Database User**:
   - Username: `almtech` (or anything)
   - Password: click "Autogenerate" → **copy and save it somewhere**
   - Built-in role: **Read and write to any database**
8. Atlas → **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`). Required because Vercel's IPs change.
9. Atlas → **Database** → **Connect** → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://almtech:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
   Replace `<password>` with the password you saved in step 7.

**Save the final connection string** — you'll paste it in Step 3.

---

## Step 2 — Sign up for Vercel (2 min)

1. Open https://vercel.com/signup
2. Sign in with **GitHub** (recommended — makes deploying changes easier).
3. If you don't have a GitHub account: sign up at https://github.com first (free), then come back.

---

## Step 3 — Deploy

You have two paths. **Pick one.**

### Option A — Deploy from local Mac (no GitHub required)

```bash
# Install Vercel CLI (one-time, no sudo)
npm install -g vercel

# Login
vercel login

# Deploy from project folder
cd /Users/haroon/almtech-business-suite
vercel
```

Vercel will ask:
- **Set up and deploy?** → Yes
- **Which scope?** → your account
- **Link to existing project?** → No
- **Project name?** → `almtech-suite` (or anything)
- **Directory?** → `./` (current)
- **Override settings?** → No (it reads `vercel.json`)

After deploy, you'll get a preview URL. Now set environment variables:

```bash
vercel env add MONGO_URI production
# Paste the Atlas connection string when prompted

vercel env add JWT_SECRET production
# Paste any long random string (32+ chars). Example:
# k4j2h3kj4h2k3j4h2kj3h4k2jh3k4j2h3kj4h2k3j

vercel env add NODE_ENV production
# Type: production

# Promote to production with the env vars applied
vercel --prod
```

### Option B — Deploy via GitHub (easier for ongoing updates)

1. Create a private repo on https://github.com/new (any name).
2. Push the project:
   ```bash
   cd /Users/haroon/almtech-business-suite
   git remote add origin https://github.com/YOUR-USERNAME/almtech-suite.git
   git push -u origin main
   ```
3. On https://vercel.com → **Add New Project** → import the GitHub repo.
4. **Framework Preset:** Other (or leave as detected).
5. **Build settings:** leave defaults (already configured via `vercel.json`).
6. **Environment Variables** → add:
   - `MONGO_URI` = (Atlas connection string from Step 1)
   - `JWT_SECRET` = any long random string, 32+ chars
   - `NODE_ENV` = `production`
7. Click **Deploy**.

After ~3 min you get a live URL.

---

## Step 4 — Verify

1. Open your Vercel URL in a browser.
2. Log in:
   - Email: `admin@almtech.org`
   - Password: `admin1234`
3. The first request might take ~3 sec (cold start + first DB connection + seed). Subsequent requests are instant.
4. Once you're in, go to **Users** and create accounts for staff. Send them the URL + their credentials + the user guide PDF (`docs/USER_GUIDE.md` or the desktop HTML version).

---

## Step 5 — (Optional) Custom domain `suite.almtech.org`

1. Vercel dashboard → **Project → Settings → Domains** → add `suite.almtech.org`.
2. Vercel shows DNS instructions (usually a CNAME or A record).
3. In Hostinger hPanel → **Domains → Manage → DNS Zone Editor** → add the record Vercel asks for.
4. Wait 5–30 min for DNS to propagate. Vercel auto-issues an SSL cert.

---

## Common commands you might need later

| What | Command |
|---|---|
| Redeploy after code changes (CLI) | `vercel --prod` |
| Redeploy via GitHub | Just `git push` — auto-deploys |
| View live logs | `vercel logs <url>` |
| Update an env var | `vercel env rm KEY production` then `vercel env add KEY production` |
| Open the deployed app | `vercel open` |

---

## Troubleshooting

### "Server initialization failed: MONGO_URI must be a real connection string"
You haven't set the env var. Run `vercel env add MONGO_URI production` and paste the Atlas string.

### Atlas connection times out
Atlas → **Network Access** → make sure `0.0.0.0/0` is in the allow list. Without this, Vercel can't reach your database.

### "Module not found" during Vercel build
The root `package.json` lists backend deps for the serverless function. If you added a new dep, also add it to the root `package.json`.

### Login works locally but not on Vercel
Set `NODE_ENV=production` and `JWT_SECRET` in Vercel's env vars. Without `JWT_SECRET`, tokens fail to verify.

### First request after 15+ min is slow
That's a cold start. Vercel functions go idle, but they wake up in ~1 sec — not 30 sec like other free tiers. Acceptable for an internal business tool.

---

## Cost reminder

- MongoDB Atlas M0: **₨0 forever**, 512 MB storage.
- Vercel Hobby tier: **₨0 forever** for personal/non-commercial. *Technically Vercel asks commercial projects to upgrade to Pro ($20/mo); for internal tools used by your friend's small business this is generally fine but check their terms if you scale.*
- Total monthly cost: **₨0** for normal use.

---

## What's deployed and how it fits together

```
suite.almtech.org (or *.vercel.app)
            │
            ▼
   ┌────────────────────┐
   │  Vercel CDN        │  ← serves the React UI (HTML/CSS/JS)
   └────────┬───────────┘
            │ (browser calls /api/*)
            ▼
   ┌────────────────────┐
   │  Vercel Function   │  ← runs the Express backend on-demand
   │  api/index.js      │
   └────────┬───────────┘
            │
            ▼
   ┌────────────────────┐
   │  MongoDB Atlas     │  ← stores all the data
   └────────────────────┘
```

Everything stateless. Everything free. Set it and forget it.
