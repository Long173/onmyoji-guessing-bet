// tools/png.ts — minimal, dependency-free PNG codec for Node scripts and tests.
//
// Decodes 8-bit greyscale / grey+alpha / RGB / RGBA / palette PNGs (non-interlaced) to RGBA,
// and encodes RGBA to PNG. Enough for game screenshots and the soul-icon reference crops;
// the browser never uses this (it decodes through <canvas>).
import zlib from "node:zlib";

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): RgbaImage {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!b.subarray(0, 8).equals(SIG)) throw new Error("not a PNG file");
  let off = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    const body = b.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= channels ? px[dst + x - channels] : 0;
      const up = y > 0 ? px[dst - stride + x] : 0;
      const c = y > 0 && x >= channels ? px[dst - stride + x - channels] : 0;
      let r: number;
      switch (ft) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + up; break;
        case 3: r = v + ((a + up) >> 1); break;
        case 4: r = v + paeth(a, up, c); break;
        default: throw new Error(`bad PNG filter ${ft}`);
      }
      px[dst + x] = r & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    if (ctype === 6) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = px[s + 3]; }
    else if (ctype === 2) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = 255; }
    else if (ctype === 0) { data[d] = data[d + 1] = data[d + 2] = px[s]; data[d + 3] = 255; }
    else if (ctype === 4) { data[d] = data[d + 1] = data[d + 2] = px[s]; data[d + 3] = px[s + 1]; }
    else {
      const k = px[s];
      if (!palette) throw new Error("palette PNG without PLTE");
      data[d] = palette[k * 3]; data[d + 1] = palette[k * 3 + 1]; data[d + 2] = palette[k * 3 + 2];
      data[d + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, data };
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

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const v of bytes) c = CRC_TABLE[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
