# Deploying to Fly.io — step-by-step

The project is fully prepared. Follow these 5 steps once and you have a permanent live URL.

---

## Step 0 — What you'll end up with

- A public URL like `https://almtech-suite.fly.dev` (or your custom subdomain `suite.almtech.org`).
- Always on, never sleeps, no cold start delay.
- ₨0 per month forever.
- Staff log in from any device, anywhere in the world.

---

## Step 1 — Sign up for MongoDB Atlas (5 min)

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up with email + password.
3. When prompted to create a cluster, pick **M0 (Free Forever)**.
4. Region: pick **Mumbai** or **Singapore** (closest to Pakistan / UK staff).
5. Cluster name: leave default or call it `almtech`.
6. Once the cluster is ready (~3 min), click **"Connect"** → **"Drivers"** → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Atlas → **Database Access** → make sure the user has read/write permission.
8. Atlas → **Network Access** → click **"Add IP Address"** → choose **"Allow access from anywhere"** (`0.0.0.0/0`). Required so Fly.io can connect.

**Save the connection string somewhere safe — you'll paste it in Step 4.**

---

## Step 2 — Sign up for Fly.io (3 min)

1. Go to https://fly.io/app/sign-up
2. Sign up with email or GitHub.
3. Add a credit/debit card for identity verification. **You will not be charged** as long as you stay within free tier limits — this is just to prove you're a real person.

---

## Step 3 — Install the Fly CLI on your Mac (2 min)

Open Terminal and run:

```bash
curl -L https://fly.io/install.sh | sh
```

Then sign in (opens a browser to confirm):

```bash
flyctl auth login
```

When the browser opens, click Authorize. Close it. Back in Terminal you should see "successfully logged in".

---

## Step 4 — Deploy (5 min)

From Terminal:

```bash
cd /Users/haroon/almtech-business-suite

# Create the app (only needed once)
flyctl apps create almtech-suite --org personal

# Set the MongoDB connection string + a JWT secret as environment variables
flyctl secrets set \
  MONGO_URI='paste-your-atlas-connection-string-here' \
  JWT_SECRET='a-very-long-random-string-at-least-32-chars'

# Deploy
flyctl deploy
```

**Replace:**
- `paste-your-atlas-connection-string-here` with the URI from Step 1 (keep the single quotes around it because passwords can have special characters)
- `a-very-long-random-string-at-least-32-chars` with any random text 32+ chars

The first deploy takes about 3–5 minutes (downloads images, builds, pushes). Subsequent deploys are faster.

When it finishes, Fly will print your URL:
```
https://almtech-suite.fly.dev
```

---

## Step 5 — Verify and share with staff

1. Open the URL in your browser.
2. Log in as admin:
   - Email: `admin@almtech.org`
   - Password: `admin1234`
3. **Change the admin password immediately** (Settings — coming, or use the API).
4. Sidebar → Users → create a login for your friend and each staff member.
5. Send them the URL + their login + the user guide PDF.

Done.

---

## (Optional) Step 6 — Add a custom domain

If you want `suite.almtech.org` instead of `almtech-suite.fly.dev`:

```bash
flyctl certs create suite.almtech.org
```

Fly will print DNS instructions. Add the records in your Hostinger DNS panel (hPanel → Domains → DNS Zone Editor). Typically:
- An `A` record pointing `suite` to Fly's IPv4
- An `AAAA` record pointing `suite` to Fly's IPv6

Wait 10–30 min for DNS propagation. Then `https://suite.almtech.org` works with auto SSL.

---

## Maintenance commands you might need

| What you want | Command |
|---|---|
| View live server logs | `flyctl logs` |
| Restart the app | `flyctl apps restart almtech-suite` |
| Open the app in browser | `flyctl open` |
| Update env var | `flyctl secrets set KEY=value` |
| Redeploy after code changes | `flyctl deploy` |
| Check app status | `flyctl status` |
| Open a shell on the server | `flyctl ssh console` |

---

## Troubleshooting

**Build fails on Fly during deploy**
- Check `flyctl logs` for the error.
- Most common: `MONGO_URI` not set. Run `flyctl secrets list` to verify.

**App boots but login fails**
- The seed runs on first boot only if the DB is empty. Check `flyctl logs` for "Seeded demo data".
- If your Atlas DB already has data, the seed is skipped — you'll need to create a user manually via Atlas's data explorer.

**"MONGO_URI must be a real connection string in production"**
- You haven't set the secret yet. Re-run `flyctl secrets set MONGO_URI='...'`.

**Atlas connection times out**
- Network Access in Atlas → make sure `0.0.0.0/0` is allowed. Without this, Fly can't reach Atlas.

---

## Cost reminder

- MongoDB Atlas M0: **₨0 forever**, up to 512 MB.
- Fly.io Hobby plan: **₨0 forever**, includes 3 small VMs (we use 1).
- Total monthly cost: **₨0**.

You'd only pay if you scale way past free tier limits (years away for this business).
