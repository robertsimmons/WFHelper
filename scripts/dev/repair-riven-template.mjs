import sharp from "sharp";

// Run against the pristine template, not the committed one: the lift is not
// idempotent. `git show <rev>:assets/RivenTemplate.webp` recovers the source.
const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error("usage: repair-riven-template.mjs <source> <dest>");

// The stat panel: dead flat black in the shipped art, and the region the Rivens
// view prints a riven's stats over, so it has to stay dark and stay put.
const PANEL_TOP = 194;
const PANEL_BOTTOM = 328;
const TOP_FILL = [64, 55, 92];
const BOTTOM_FILL = [36, 31, 54];
/** Above this the pixel is frame or artwork, and is left alone. */
const DARK_CUTOFF = 42;

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.from(data);
const centre = (width - 1) / 2;

for (let y = PANEL_TOP; y < PANEL_BOTTOM; y += 1) {
  const ramp = (y - PANEL_TOP) / (PANEL_BOTTOM - PANEL_TOP);
  // Feather the first and last rows so the panel meets the art without a seam.
  const edge = Math.min(1, (y - PANEL_TOP) / 8, (PANEL_BOTTOM - 1 - y) / 8);
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * channels;
    if (data[i + 3] === 0) continue;
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const blend = Math.max(0, Math.min(1, (DARK_CUTOFF - lum) / DARK_CUTOFF)) * edge;
    if (blend <= 0) continue;
    // Lit from the middle, as the card's own artwork is, so the panel reads as
    // material rather than as a rectangle laid over one.
    const across = 1 - (0.35 * Math.abs(x - centre)) / centre;
    for (let c = 0; c < 3; c += 1) {
      const fill = (TOP_FILL[c] + (BOTTOM_FILL[c] - TOP_FILL[c]) * ramp) * across;
      // Keeping the original value on top of the fill keeps the faint texture.
      const lifted = Math.min(255, fill + data[i + c]);
      out[i + c] = Math.round(data[i + c] * (1 - blend) + lifted * blend);
    }
  }
}

await sharp(out, { raw: { width, height, channels } })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(dst);
console.log("wrote", dst, width, height);
