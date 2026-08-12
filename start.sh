#!/usr/bin/env bash
# ALMTech Business Suite — LOCAL DEVELOPMENT launcher.
#
# This starts the Vite development server and is not a way to run the product for
# real use. To deploy, follow HOSTINGER_DEPLOY.md.
#
# Uses the portable Node bundled under .tools/node — no global install needed.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/.tools/node/bin:$PATH"

# Refuse to be the production start command. Running the dev server against a live
# database would serve unminified code, enable verbose errors and ignore the built
# frontend entirely.
if [ "$NODE_ENV" = "production" ]; then
  echo "start.sh is the development launcher and will not run with NODE_ENV=production."
  echo "See HOSTINGER_DEPLOY.md for the deployment procedure."
  exit 1
fi

cd "$HERE/backend"

if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install --no-audit --no-fund
fi

if [ ! -f .env ]; then
  cp .env.example .env
  # .env.example ships a placeholder secret, which is published in the repository —
  # anyone could forge a login token with it. Every machine gets its own.
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
  if [ -n "$SECRET" ]; then
    node -e '
      const fs = require("fs");
      const f = process.argv[1], secret = process.argv[2];
      fs.writeFileSync(f, fs.readFileSync(f, "utf8")
        .replace(/^JWT_SECRET=.*$/m, "JWT_SECRET=" + secret));
    ' .env "$SECRET"
    echo "Created backend/.env with a freshly generated JWT_SECRET"
  else
    echo "Created backend/.env — set JWT_SECRET before signing in"
  fi
fi

cd "$HERE/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install --no-audit --no-fund
fi

echo ""
echo "=========================================="
echo "  ALMTech Business Suite — DEVELOPMENT"
echo "=========================================="
echo ""
echo "  Backend API : http://localhost:5050"
echo "  Web app    : http://localhost:5174"
echo ""

# The demo accounts have publicly-known passwords. They are only created when demo
# seeding is on, so they are only ever printed when they actually exist — never on an
# installation carrying real business data.
DEMO_OFF="$(grep -E '^ENABLE_DEMO_SEED=false' "$HERE/backend/.env" 2>/dev/null || true)"
if [ -z "$DEMO_OFF" ]; then
  echo "  Demo login (development data only — never use these on a live system):"
  echo "    admin@almtech.org / admin1234"
  echo "    sales@almtech.org / sales1234"
  echo "    stock@almtech.org / stock1234"
  echo ""
fi

echo "  Press Ctrl+C to stop."
echo "=========================================="
echo ""

# Start backend in background, frontend in foreground
cd "$HERE/backend"
node src/server.js &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "Stopping servers..."
  kill $BACKEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

cd "$HERE/frontend"
npm run dev
