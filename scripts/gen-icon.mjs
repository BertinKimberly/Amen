// Generates a 1024x1024 PNG app icon (violet gradient rounded square + play glyph)
// using only Node built-ins (zlib) so there are zero dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src-tauri", "icons");
const outPng = join(outDir, "icon.png");
mkdirSync(outDir, { recursive: true });

// ---- RGBA pixel buffer ----
const px = new Uint8Array(SIZE * SIZE * 4);

// Base gradient colors (top-left -> bottom-right)
const cTop = [99, 102, 241]; // indigo-500
const cBottom = [168, 85, 247]; // purple-500
const cAccent = [236, 72, 153]; // pink-500

function lerp(a, b, t) {
   return a + (b - a) * t;
}

function lerpColor(a, b, t) {
   return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Rounded-rect signed distance (approximation) with smooth edge
function roundedRectSDF(x, y, cx, cy, hw, hh, r) {
   const qx = Math.abs(x - cx) - (hw - r);
   const qy = Math.abs(y - cy) - (hh - r);
   const ox = Math.max(qx, 0);
   const oy = Math.max(qy, 0);
   return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const r = 230; // corner radius
const hw = SIZE * 0.5 - 40;
const hh = SIZE * 0.5 - 40;
const cx = SIZE / 2;
const cy = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
   for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const t = (x + y) / (2 * SIZE); // diagonal gradient
      let col = lerpColor(cTop, cBottom, t);

      const dist = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, hw, hh, r);
      const aa = Math.min(Math.max(dist + 0.5, 0), 1); // 0 inside, 1 outside

      // subtle radial highlight near top-left
      const hx = x - SIZE * 0.32;
      const hy = y - SIZE * 0.28;
      const hd = Math.sqrt(hx * hx + hy * hy) / (SIZE * 0.85);
      if (hd < 1) {
         col = lerpColor(col, [255, 255, 255], (1 - hd) * 0.08);
      }

      // play triangle
      // triangle vertices (centered-ish, slightly right)
      const tx = cx + SIZE * 0.06;
      const ty = cy;
      const pt = [
         [tx - SIZE * 0.2, ty - SIZE * 0.28],
         [tx - SIZE * 0.2, ty + SIZE * 0.28],
         [tx + SIZE * 0.26, ty],
      ];
      // inside test via barycentric
      const sign = (p1, p2, p3) =>
         (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
      const b1 = sign([x + 0.5, y + 0.5], pt[0], pt[1]);
      const b2 = sign([x + 0.5, y + 0.5], pt[1], pt[2]);
      const b3 = sign([x + 0.5, y + 0.5], pt[2], pt[0]);
      const hasNeg = b1 < 0 || b2 < 0 || b3 < 0;
      const hasPos = b1 > 0 || b2 > 0 || b3 > 0;
      const inside = !(hasNeg && hasPos);

      if (inside && aa < 1) {
         col = lerpColor(col, [255, 255, 255], 0.94);
      }

      // apply alpha (feather the very edge)
      const alpha = Math.min(Math.max(1 - aa, 0), 1) * 255;
      px[i] = Math.round(col[0]);
      px[i + 1] = Math.round(col[1]);
      px[i + 2] = Math.round(col[2]);
      px[i + 3] = Math.round(alpha);
   }
}

// ---- PNG encoding ----
function chunk(type, data) {
   const len = Buffer.alloc(4);
   len.writeUInt32BE(data.length);
   const typeBuf = Buffer.from(type, "ascii");
   const crcBuf = Buffer.alloc(4);
   crcBuf.writeUInt32BE(crc32(typeBuf, data));
   return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
   const t = new Uint32Array(256);
   for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
   }
   return t;
})();

function crc32(typeBuf, data) {
   let c = 0xffffffff;
   const all = Buffer.concat([typeBuf, data]);
   for (const b of all) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
   return (c ^ 0xffffffff) >>> 0;
}

// Build scanlines with filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
   raw[y * (SIZE * 4 + 1)] = 0;
   px.subarray(y * SIZE * 4, (y + 1) * SIZE * 4).forEach(
      (v, j) => (raw[y * (SIZE * 4 + 1) + 1 + j] = v),
   );
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
   Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
   chunk("IHDR", ihdr),
   chunk("IDAT", deflateSync(raw, { level: 9 })),
   chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(outPng, png);
console.log(`Wrote ${outPng} (${png.length} bytes)`);
