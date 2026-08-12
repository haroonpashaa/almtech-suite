# Deploying ALM Business Suite to Hostinger

This guide covers deploying to a **Hostinger VPS** running Ubuntu. It is written to be
followed top to bottom by someone who has not seen the codebase.

Hostinger's shared/cPanel hosting is **not** suitable: this application is a long-running
Node.js process, not PHP, and it needs a persistent port and a process manager. Use a VPS
plan (KVM 1 is sufficient for a small business).

**What you end up with:** the application at `https://suite.your-domain.com`, served over
HTTPS, restarting automatically after a crash or reboot, with data in MongoDB Atlas.

---

## Architecture

One Node.js process does both jobs. Express serves the built React application as static
files and answers the API under `/api`:

```
Browser ──HTTPS──> nginx (443) ──proxy──> Node/Express (127.0.0.1:5050) ──> MongoDB Atlas
                                            │
                                            ├── /api/*        the API
                                            └── everything else → frontend/dist
```

There is no separate frontend server and no CDN. `backend/src/app.js` serves
`frontend/dist` when that directory exists, so **the frontend must be built before the
backend is started**.

---

## 1. Node.js version

Both packages declare `"engines": { "node": ">=20" }`.

Use **Node.js 20 LTS or 22 LTS**. Vite requires 18 or 20+ to build; Mongoose requires
16.20+. Node 20 is the safest choice.

```bash
# On the VPS, as a non-root user
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # expect v20.x
```

Do not run the application as `root`. Create a user for it:

```bash
sudo adduser --disabled-password --gecos "" almtech
sudo usermod -aG sudo almtech    # optional
sudo su - almtech
```

---

## 2. MongoDB Atlas

The application **refuses to start in production without a real database**. It never
falls back to the embedded MongoDB used in development — that safeguard is deliberate.

1. Create a free **M0** cluster at <https://www.mongodb.com/cloud/atlas/register>.
   Choose the region closest to your users (Mumbai `ap-south-1` for Pakistan).
2. **Database Access → Add New Database User.** Choose *Password* authentication and
   the built-in role **Read and write to any database**. Autogenerate the password and
   save it.
3. **Network Access → Add IP Address.** Add your VPS's public IPv4 address
   (`curl -4 ifconfig.me` on the VPS). A fixed VPS IP means you do **not** need
   `0.0.0.0/0` — do not use it unless you must.
4. **Database → Connect → Drivers** and copy the connection string:

```
mongodb+srv://almtech:<password>@cluster0.xxxxx.mongodb.net/almtech?retryWrites=true&w=majority
```

Replace `<password>` with the saved password and keep `/almtech` before the `?` — that
names the database. Without it you get a database called `test`.

If the password contains `@ : / ? # [ ] %`, URL-encode those characters.

---

## 3. Get the code onto the VPS

```bash
sudo mkdir -p /var/www/almtech && sudo chown almtech:almtech /var/www/almtech
cd /var/www/almtech
git clone <your-repository-url> .
```

No repository? Upload the project folder with `scp`, **excluding** `node_modules`,
`frontend/dist`, `backend/data`, `backend/data.pre-rebuild-backup` and `backend/.env`.

---

## 4. Environment variables

Create `backend/.env` on the server. It is gitignored and must never be committed.

```bash
cd /var/www/almtech/backend
cp .env.example .env
nano .env
```

### JWT secret

`JWT_SECRET` signs login tokens. `.env.example` ships a **placeholder that is published
in the repository** — if you leave it, anyone who has seen the code can forge a login as
any user, including an administrator. Generate your own:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Changing it later logs everyone out; it does not affect stored data.

### The complete file

```ini
# REQUIRED
NODE_ENV=production
JWT_SECRET=<the 96-character string you just generated>
MONGO_URI=mongodb+srv://almtech:<password>@cluster0.xxxxx.mongodb.net/almtech?retryWrites=true&w=majority
CORS_ORIGIN=https://suite.your-domain.com

# OPTIONAL
PORT=5050
JWT_EXPIRES_IN=12h

# Demo data has publicly-known passwords. Keep this false on a real system.
ENABLE_DEMO_SEED=false

# First administrator — see step 7, then remove these three lines.
BOOTSTRAP_ADMIN_EMAIL=owner@your-domain.com
BOOTSTRAP_ADMIN_PASSWORD=<at least 10 characters>
BOOTSTRAP_ADMIN_NAME=Owner
```

Lock the file down:

```bash
chmod 600 backend/.env
```

### Why `NODE_ENV=production` matters

It is not cosmetic. With `NODE_ENV=production` the server:

* refuses to start unless `MONGO_URI` and `CORS_ORIGIN` are set, instead of quietly
  running on an embedded database;
* never seeds demo accounts automatically;
* stops request logging.

And critically: API error responses include a **stack trace only when `NODE_ENV` is
exactly `development`**. Any other value — including unset — is safe, but setting it
explicitly to `production` is what turns on the other protections.

### CORS

`CORS_ORIGIN` must be the exact origin users type, scheme included and **no trailing
slash**: `https://suite.your-domain.com`. If unset, the API allows any origin. Because
nginx serves the frontend from the same origin in this setup, CORS is not strictly
exercised — set it correctly anyway, so a stolen token cannot be replayed from another
site's page.

---

## 5. Install and build

```bash
cd /var/www/almtech/backend
MONGOMS_DISABLE_POSTINSTALL=1 npm install --omit=dev --no-audit --no-fund

cd ../frontend
npm install --no-audit --no-fund     # dev dependencies are needed to build
npm run build                        # writes frontend/dist
```

`MONGOMS_DISABLE_POSTINSTALL=1` matters. `mongodb-memory-server` is a real dependency —
it powers the offline/local mode — and its install script downloads a ~100 MB MongoDB
binary that production never uses. The variable skips that download. Production is
unaffected because that code path only runs when `NODE_ENV` is not `production`.

Confirm the build exists before continuing:

```bash
ls /var/www/almtech/frontend/dist/index.html
```

If `dist` is missing, Express serves the API only and every page returns 404.

---

## 6. Process management with PM2

```bash
sudo npm install -g pm2
cd /var/www/almtech/backend
pm2 start src/server.js --name almtech-api --time
pm2 save
pm2 startup systemd -u almtech --hp /home/almtech
# run the command PM2 prints, then:
pm2 save
```

Check it came up:

```bash
pm2 status
pm2 logs almtech-api --lines 50
curl -s localhost:5050/api/health
# {"ok":true,"service":"almtech-suite-api","database":"connected"}
```

PM2 does not read `.env` itself — the application loads it via `dotenv`, relative to the
working directory. **Always start PM2 from `/var/www/almtech/backend`**, or the server
exits with `FATAL: cannot start — missing required configuration`.

That fatal error listing your variables is the app working correctly: it refuses to run
half-configured rather than failing later on a screen a user is depending on.

---

## 7. First administrator, then remove the credentials

With `ENABLE_DEMO_SEED=false`, no users exist on a fresh database. On its **first start
against an empty user collection**, the server creates one administrator from
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (minimum 10 characters). The
password is never logged and never returned by any endpoint.

Once you can sign in:

```bash
nano backend/.env       # delete the three BOOTSTRAP_ADMIN_* lines
pm2 restart almtech-api
```

They are ignored once any user exists, but a plaintext password should not sit on disk.
Change the password from **Settings → Users** after first sign-in.

---

## 8. Domain and DNS

In Hostinger's **hPanel → Domains → DNS Zone**, add an `A` record:

| Type | Name    | Points to        | TTL  |
|------|---------|------------------|------|
| A    | `suite` | your VPS IPv4    | 3600 |

That gives `suite.your-domain.com`. Use `@` for the root domain instead. Allow up to an
hour for propagation; check with `dig +short suite.your-domain.com`.

---

## 9. nginx and SSL

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/almtech
```

```nginx
server {
    listen 80;
    server_name suite.your-domain.com;

    # Uploads: the Excel import accepts files up to 5 MB, and nginx defaults to 1 MB.
    client_max_body_size 8M;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # PDF generation and large exports can exceed the 60s default.
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/almtech /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Then issue a certificate:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d suite.your-domain.com
```

Choose redirect HTTP → HTTPS when asked. Certbot installs a renewal timer; verify with
`sudo certbot renew --dry-run`.

Finally, close the application port to the outside world so nginx is the only way in:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status          # 5050 must NOT be listed
```

### API and frontend routing

Everything goes to the single Node process — do not split it. Express routes internally:

* `/api/*` → the API
* `/assets/*`, `/fonts/*`, `/favicon.svg`, logos → static files from `frontend/dist`
* anything else → `frontend/dist/index.html`, so React Router handles deep links such as
  `/invoices/abc123` on a hard refresh.

Adding an nginx `location /api` block is unnecessary and easy to get wrong.

---

## 10. Restarting and updating

```bash
pm2 restart almtech-api          # restart
pm2 logs almtech-api             # follow logs
pm2 stop almtech-api             # stop
```

To deploy a new version:

```bash
cd /var/www/almtech
git pull
cd backend  && MONGOMS_DISABLE_POSTINSTALL=1 npm install --omit=dev --no-audit --no-fund
cd ../frontend && npm install --no-audit --no-fund && npm run build
pm2 restart almtech-api
curl -s localhost:5050/api/health
```

Rebuild the frontend on every update. Skipping it leaves the old interface being served
against a new API.

`start.sh` is the **development** launcher only. It runs the Vite dev server and refuses
to run with `NODE_ENV=production`. Never use it on the VPS.

---

## 11. Backups

Business data lives in **Atlas**, not on the VPS. The VPS holds only code and `.env`.

**Atlas (primary).** M0 includes limited snapshots; a paid tier adds continuous backup.
Take your own dumps regardless, from the VPS or any machine with `mongodump`:

```bash
mongodump --uri="<your MONGO_URI>" --archive=/home/almtech/backups/almtech-$(date +%F).gz --gzip
```

Nightly at 02:00 via `crontab -e`, keeping 30 days:

```cron
0 2 * * * mongodump --uri="<your MONGO_URI>" --archive=/home/almtech/backups/almtech-$(date +\%F).gz --gzip && find /home/almtech/backups -name 'almtech-*.gz' -mtime +30 -delete
```

Copy backups off the VPS — a backup on the same machine is not a backup.

**Restore:**

```bash
mongorestore --uri="<your MONGO_URI>" --archive=/path/to/almtech-2026-08-12.gz --gzip --drop
```

`--drop` replaces existing collections. Restore into a *new* Atlas database first and
point a staging copy at it before overwriting production.

**In-application export.** Admin → Data lets an administrator export products,
customers, suppliers, invoices and more to Excel. That is a convenience and a migration
aid, not a backup: it does not capture the ledger in a restorable form. Use `mongodump`.

Also back up `backend/.env` somewhere safe — losing `JWT_SECRET` only logs everyone out,
but losing `MONGO_URI` loses your connection details.

---

## 12. Post-deployment verification

Work through this list before handing the system over.

**Server**

```bash
pm2 status                                   # almtech-api online
curl -s localhost:5050/api/health            # {"ok":true,...,"database":"connected"}
curl -s -o /dev/null -w '%{http_code}\n' https://suite.your-domain.com/    # 200
curl -sI http://suite.your-domain.com | head -1                            # 301 to HTTPS
```

**Security**

```bash
# No stack traces in production errors:
curl -s https://suite.your-domain.com/api/invoices/not-an-id | grep -c stack   # 0

# Protected endpoints reject anonymous callers:
curl -s -o /dev/null -w '%{http_code}\n' https://suite.your-domain.com/api/accounts   # 401

# The app port is not reachable from outside:
curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://<vps-ip>:5050/api/health   # should fail
```

Confirm `backend/.env` is `-rw-------` (`ls -l`), and that the demo accounts do not
exist: signing in as `admin@almtech.org / admin1234` must fail.

**Application** — in a browser:

1. Sign in as the bootstrap administrator.
2. Dashboard: figures render, charts draw, no console errors (F12).
3. Record a small sale in POS, take a payment, confirm the invoice balance.
4. Open the invoice PDF — it downloads and shows the logo.
5. Reports → Monthly Trends: axis labels read `1.5B`-style, not raw digits.
6. Settings → Users: create a real user for each staff member.
7. On a phone at ~390px: dashboard, POS and Reports are usable and nothing is cut off.
8. Hard-refresh a deep link such as `/invoices` — it must load, not 404.

**Accounting integrity** — as an administrator:

* `/api/accounts/reconcile` → `ok: true`
* `/api/finance/receivables` and `/api/finance/payables` → `reconciled: true`
* `/api/reports/inventory-reconcile` → `ok: true` with empty `overReceived`,
  `negativeStock` and `receiptDrift`

Re-run these after the first week of real use.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `FATAL: cannot start — missing required configuration` | PM2 not started from `backend/`, or a variable is missing. `cd /var/www/almtech/backend && pm2 restart almtech-api --update-env` |
| `FATAL: could not start — the database is unreachable` | VPS IP not in the Atlas allow-list, or a wrong password / unencoded special character in `MONGO_URI` |
| Blank page, API works | `frontend/dist` missing — run `npm run build` in `frontend/` |
| 502 Bad Gateway | Node process down. `pm2 status`, `pm2 logs almtech-api` |
| 413 on Excel import | `client_max_body_size` missing from the nginx block |
| Everyone logged out after a deploy | `JWT_SECRET` changed. Expected; users sign in again |
| Login works, then every request is 401 | Two PM2 instances with different secrets. `pm2 delete all` and start one |
| Fonts look wrong | `frontend/dist/fonts/` missing — rebuild. Fonts are self-hosted; the app needs no internet access |
