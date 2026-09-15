import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['admin', 'sales', 'stock'];

// ALM-SEC-004: a reasonable server-side strength floor for any newly-set or
// changed password. Length-based, matching the standard this codebase
// already established for a real production admin (the stricter 10-char
// floor `seedData.js`'s `bootstrapAdmin()` already enforces for
// `BOOTSTRAP_ADMIN_PASSWORD` — untouched, and still applies on top of this
// for that specific path) rather than inventing a new character-class
// complexity rule this codebase has no existing precedent for. 8 is
// deliberately chosen over 10 here so the documented demo accounts (e.g.
// "admin1234") keep seeding a fresh dev/demo environment unchanged.
// Checked only when the password path is actually being modified (see the
// schema validator below), never against an already-hashed stored value on
// an unrelated save, so this can never retroactively invalidate an
// existing account just because its current password predates this
// policy.
function isStrongPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: {
      type: String,
      required: true,
      validate: {
        validator: function (value) {
          if (!this.isModified('password')) return true;
          return isStrongPassword(value);
        },
        message: 'Password must be at least 8 characters.',
      },
    },
    role: { type: String, enum: ROLES, default: 'sales' },
    active: { type: Boolean, default: true },
    // ALM-SEC-003: incremented every time the password is actually changed
    // (see the pre('save') hook below — the same one place every
    // password-change path already goes through, self-service or
    // admin-driven). Signed into every JWT at login (auth.controller.js) and
    // checked by `protect` (middleware/auth.js): a token whose embedded
    // version doesn't match the user's *current* version is rejected.
    //
    // A timestamp-based version of this fix ("reject any token issued before
    // passwordChangedAt") was tried first and failed its own retest: a JWT's
    // `iat` claim only has whole-SECOND resolution, so a token issued in the
    // very same wall-clock second as the password change was
    // indistinguishable from one issued a moment earlier — exactly the
    // "login right after changing your password" case this fix must not
    // break (verified live: two tokens issued back-to-back in fast
    // succession were byte-identical, and a strict "before" comparison could
    // not tell old from new when they landed in the same second either way).
    // A version counter has no such ambiguity: a freshly issued token always
    // carries the CURRENT version (read from the database at the moment of
    // signing), so it can never collide with a version bump that already
    // happened by the time that login occurred, at any resolution.
    //
    // Starts at 0 so every already-issued token (which predates this claim
    // existing at all, and is therefore treated as version 0) keeps working
    // until the next real password change — deploying this doesn't
    // retroactively log anyone out.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  this.tokenVersion = (this.tokenVersion || 0) + 1;
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model('User', userSchema);
