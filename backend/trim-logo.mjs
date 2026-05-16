import sharp from 'sharp';

const SRC = '/Users/haroon/almtech-business-suite/frontend/public/almtech-logo.png';
const OUT_TIGHT = '/Users/haroon/almtech-business-suite/frontend/public/almtech-logo-tight.png';
const OUT_WHITE = '/Users/haroon/almtech-business-suite/frontend/public/almtech-logo-white.png';

const meta = await sharp(SRC).metadata();
const W = meta.width, H = meta.height;
const raw = await sharp(SRC).ensureAlpha().raw().toBuffer();
const ch = 4;

// Find bounding box of "blue-ish" pixels — these are the wordmark.
function isLogoPixel(r, g, b) {
  return b > 80 && b > r + 30 && b > g - 10;
}

let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * ch;
    if (isLogoPixel(raw[i], raw[i + 1], raw[i + 2])) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      count++;
    }
  }
}
console.log(`Logo bounds: x ${minX}-${maxX}, y ${minY}-${maxY} (${count} pixels)`);

const PAD = 6;
const left = Math.max(0, minX - PAD);
const top = Math.max(0, minY - PAD);
const width = Math.min(W - left, maxX - minX + 1 + PAD * 2);
const height = Math.min(H - top, maxY - minY + 1 + PAD * 2);
console.log(`Cropping to ${width}x${height} at (${left},${top})`);

const cropped = await sharp(SRC).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();

// Whitepixels → transparent. Smooth edge.
const out = Buffer.from(cropped);
for (let i = 0; i < cropped.length; i += ch) {
  const r = cropped[i], g = cropped[i + 1], b = cropped[i + 2];
  const minDist = Math.min(255 - r, 255 - g, 255 - b);
  if (minDist < 8) out[i + 3] = 0;
  else if (minDist < 30) out[i + 3] = Math.min(255, Math.round((minDist - 8) * (255 / 22)));
  else out[i + 3] = 255;
}

await sharp(out, { raw: { width, height, channels: ch } }).png().toFile(OUT_TIGHT);
console.log(`Tight transparent logo: → ${OUT_TIGHT}`);

const white = Buffer.from(out);
for (let i = 0; i < white.length; i += ch) {
  if (white[i + 3] > 0) {
    white[i] = 255;
    white[i + 1] = 255;
    white[i + 2] = 255;
  }
}
await sharp(white, { raw: { width, height, channels: ch } }).png().toFile(OUT_WHITE);
console.log(`White logo: → ${OUT_WHITE}`);
