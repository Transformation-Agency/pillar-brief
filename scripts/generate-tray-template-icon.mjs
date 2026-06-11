import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "src-tauri", "icons");

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawLine(alpha, size, x1, y1, x2, y2, width) {
  const radius = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - radius - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + radius + 1);
  const minY = Math.floor(Math.min(y1, y2) - radius - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + radius + 1);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      if (Math.hypot(px - cx, py - cy) <= radius) alpha[y * size + x] = 255;
    }
  }
}

function fillRect(alpha, size, x, y, width, height) {
  for (let row = Math.floor(y); row < Math.ceil(y + height); row += 1) {
    for (let col = Math.floor(x); col < Math.ceil(x + width); col += 1) {
      if (col >= 0 && row >= 0 && col < size && row < size) alpha[row * size + col] = 255;
    }
  }
}

function downsample(alpha, highSize, size) {
  const scale = highSize / size;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
          sum += alpha[(y * scale + yy) * highSize + x * scale + xx];
        }
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = Math.round(sum / (scale * scale));
    }
  }
  return rgba;
}

function render(size) {
  const scale = 4;
  const highSize = size * scale;
  const alpha = new Uint8Array(highSize * highSize);
  const s = scale;

  // Document outline with folded corner.
  drawLine(alpha, highSize, 4 * s, 3 * s, 11.5 * s, 3 * s, 2 * s);
  drawLine(alpha, highSize, 11.5 * s, 3 * s, 15 * s, 6.5 * s, 2 * s);
  drawLine(alpha, highSize, 15 * s, 6.5 * s, 15 * s, 15 * s, 2 * s);
  drawLine(alpha, highSize, 15 * s, 15 * s, 4 * s, 15 * s, 2 * s);
  drawLine(alpha, highSize, 4 * s, 15 * s, 4 * s, 3 * s, 2 * s);
  drawLine(alpha, highSize, 11.5 * s, 3.5 * s, 11.5 * s, 6.5 * s, 1.5 * s);
  drawLine(alpha, highSize, 11.5 * s, 6.5 * s, 14.5 * s, 6.5 * s, 1.5 * s);

  // Pillar mark, intentionally chunky for menu-bar scale.
  fillRect(alpha, highSize, 6.5 * s, 5.5 * s, 5.5 * s, 1.5 * s);
  fillRect(alpha, highSize, 7.5 * s, 7.5 * s, 3.5 * s, 1.5 * s);
  fillRect(alpha, highSize, 7.5 * s, 9.5 * s, 1.3 * s, 3.5 * s);
  fillRect(alpha, highSize, 10 * s, 9.5 * s, 1.3 * s, 3.5 * s);
  fillRect(alpha, highSize, 7 * s, 13 * s, 5 * s, 1.3 * s);

  return png(size, size, downsample(alpha, highSize, size));
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "tray-template@1x.png"), render(18));
fs.writeFileSync(path.join(outputDir, "tray-template.png"), render(36));
