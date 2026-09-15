import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ALM-SEC-002 fix: throttle login attempts server-side. Keyed by IP + the
// attempted email (not IP alone), so brute-forcing one specific account from
// one IP is what gets throttled — a shared office IP with several
// legitimate staff logging into their *own* accounts is unaffected, and a
// distributed attacker spreading guesses across many IPs still has each
// individual IP+account pair capped.
//
// `skipSuccessfulRequests` means only genuinely failed attempts count
// against the window — a normal user who mistypes their password a couple
// of times and then gets it right never sees a 429, and a correct login
// doesn't "use up" any of the budget. The window auto-expires (no
// permanent lockout that could itself be abused to lock a legitimate user
// out indefinitely by an attacker who knows their email).
//
// Deliberately generous enough not to interfere with normal mistyped-
// password retries (the assessment's own recommendation: ~5-10 attempts /
// 15 min per IP+email) while still making an online brute-force /
// credential-stuffing run impractical. Configurable via env vars so the
// automated test suite / security retest doesn't have to wait out a real
// 15-minute window.
const windowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const max = Number(process.env.LOGIN_RATE_LIMIT_MAX) || 8;

export const loginRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Deliberately no enumeration signal here: the key only decides which
    // bucket a request counts against, it never appears in any response.
    const email = String(req.body?.email || '').toLowerCase().trim();
    return `${ipKeyGenerator(req.ip)}:${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
  },
});
