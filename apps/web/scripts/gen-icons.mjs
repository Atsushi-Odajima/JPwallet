// PWA 用の PNG アイコンを依存なしで生成する（ブランド色の角丸背景 + 白い円）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const bg = [0x1e, 0x3a, 0x8a]; // brand-800
  const fg = [0xff, 0xff, 0xff];
  const accent = [0xfb, 0xbf, 0x24]; // amber-400（デモ表示と同じ色）
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      // 角丸判定
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const inside = dx * dx + dy * dy <= radius * radius;
      let px = [0, 0, 0, 0];
      if (inside) {
        px = [...bg, 255];
        // 「P」を意識した白い円と縦棒
        const rOuter = size * 0.22;
        const rInner = size * 0.11;
        const ox = cx + size * 0.04;
        const oy = cy - size * 0.08;
        const d2 = (x - ox) ** 2 + (y - oy) ** 2;
        const inRing = d2 <= rOuter * rOuter && d2 >= rInner * rInner;
        const inBar = x >= cx - size * 0.24 && x <= cx - size * 0.13 && y >= cy - size * 0.3 && y <= cy + size * 0.3;
        if (inRing || inBar) px = [...fg, 255];
        // 右下に小さなアクセント点
        const ad2 = (x - (cx + size * 0.28)) ** 2 + (y - (cy + size * 0.28)) ** 2;
        if (ad2 <= (size * 0.06) ** 2) px = [...accent, 255];
      }
      row.set(px, 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size));
  console.log(`generated icon-${size}.png`);
}
