import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['admin', 'sales', 'stock'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
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
