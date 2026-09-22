import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Placeholder app icon: a flat dark tile with a white "P". Swap the source SVG
// below (or the exported PNGs) once real artwork exists, then rerun this script.
const SIZE = 1024;
const BG = "#08090b";
const FG = "#ffffff";
const ICO_SIZES = [16, 32, 48, 256];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  <text x="50%" y="54%" font-family="Segoe UI, Arial, sans-serif" font-size="640" font-weight="700"
        fill="${FG}" text-anchor="middle" dominant-baseline="middle">P</text>
</svg>`;

// ICO container built by embedding PNG-compressed entries directly (supported
// since Windows Vista), so no separate BMP/DIB encoder is needed.
function buildIco(sizes, pngBuffers) {
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + sizes.length * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const dirEntries = sizes.map((size, i) => {
    const buf = pngBuffers[i];
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    return entry;
  });

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

async function main() {
  const svgBuffer = Buffer.from(svg);
  const logoPngPath = path.resolve("assets/logo.png");
  const logoIcoPath = path.resolve("assets/logo.ico");
  const buildIcoPath = path.resolve("build/icon.ico");

  await sharp(svgBuffer).resize(SIZE, SIZE).png().toFile(logoPngPath);

  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
  );
  const ico = buildIco(ICO_SIZES, pngBuffers);
  fs.writeFileSync(logoIcoPath, ico);
  fs.writeFileSync(buildIcoPath, ico);

  console.log(`Wrote ${logoPngPath}`);
  console.log(`Wrote ${logoIcoPath}`);
  console.log(`Wrote ${buildIcoPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
