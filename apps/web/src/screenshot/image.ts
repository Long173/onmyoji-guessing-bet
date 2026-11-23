// screenshot/image.ts — tiny raster helpers shared by the browser and Node tests.
// Everything works on plain RGBA buffers (ImageData-compatible), no DOM required.

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }
export interface Rect { x: number; y: number; w: number; h: number }

export function lumAt(img: RgbaImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}

export function rgbAt(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function clampRect(r: Rect, img: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(img.width - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(r.y)));
  const w = Math.max(1, Math.min(img.width - x, Math.round(r.w)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(r.h)));
  return { x, y, w, h };
}

export function crop(img: RgbaImage, r: Rect): RgbaImage {
  const c = clampRect(r, img);
  const out = new Uint8ClampedArray(c.w * c.h * 4);
  for (let y = 0; y < c.h; y++) {
    const s = ((c.y + y) * img.width + c.x) * 4;
    out.set(img.data.subarray(s, s + c.w * 4), y * c.w * 4);
  }
  return { width: c.w, height: c.h, data: out };
}

/** Area-averaging resample (good for downscaling icons); bilinear-ish for upscaling. */
export function resize(img: RgbaImage, w: number, h: number): RgbaImage {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = Math.max(y0 + 1e-6, (y + 1) * sy);
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = Math.max(x0 + 1e-6, (x + 1) * sx);
      let r = 0, g = 0, b = 0, a = 0, wt = 0;
      if (sx <= 1 && sy <= 1) {
        // upscaling: bilinear sample at the pixel centre
        const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const dx = fx - ix, dy = fy - iy;
        const ix1 = Math.min(img.width - 1, ix + 1), iy1 = Math.min(img.height - 1, iy + 1);
        const pts: Array<[number, number, number]> = [[ix, iy, (1 - dx) * (1 - dy)], [ix1, iy, dx * (1 - dy)], [ix, iy1, (1 - dx) * dy], [ix1, iy1, dx * dy]];
        for (const [px, py, k] of pts) {
          const i = (py * img.width + px) * 4;
          r += img.data[i] * k; g += img.data[i + 1] * k; b += img.data[i + 2] * k; a += img.data[i + 3] * k; wt += k;
        }
      } else {
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const ky = Math.min(y1, yy + 1) - Math.max(y0, yy);
          if (ky <= 0 || yy >= img.height) continue;
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const kx = Math.min(x1, xx + 1) - Math.max(x0, xx);
            if (kx <= 0 || xx >= img.width) continue;
            const k = kx * ky, i = (yy * img.width + xx) * 4;
            r += img.data[i] * k; g += img.data[i + 1] * k; b += img.data[i + 2] * k; a += img.data[i + 3] * k; wt += k;
          }
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / wt; out[o + 1] = g / wt; out[o + 2] = b / wt; out[o + 3] = a / wt;
    }
  }
  return { width: w, height: h, data: out };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Greyscale mask image (0 = ink, 255 = paper) → 8-bit greyscale BMP bytes, which Tesseract reads directly. */
export function encodeBmpGray(mask: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = (width * 3 + 3) & ~3;
  const size = 54 + rowBytes * height;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true); dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, rowBytes * height, true);
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x];
      buf[row + x * 3] = v; buf[row + x * 3 + 1] = v; buf[row + x * 3 + 2] = v;
    }
  }
  return buf;
}
