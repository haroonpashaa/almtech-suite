#!/usr/bin/env bash
# ALMTech Business Suite launcher.
# Uses the portable Node bundled under .tools/node — no global install needed.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/.tools/node/bin:$PATH"

cd "$HERE/backend"

if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install --no-audit --no-fund
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created backend/.env"
fi

cd "$HERE/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install --no-audit --no-fund
fi

echo ""
echo "=========================================="
echo "  Starting ALMTech Business Suite"
echo "=========================================="
echo ""
echo "  Backend API : http://localhost:5050"
echo "  Web app    : http://localhost:5174"
echo ""
echo "  Login:"
echo "    admin@almtech.org / admin1234"
echo "    sales@almtech.org / sales1234"
echo "    stock@almtech.org / stock1234"
echo ""
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
