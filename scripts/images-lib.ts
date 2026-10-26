// Image text-overlay rendering for the advertorial-localizer skill.
// No API calls — the translations + boxes are supplied by Claude (who reads the
// image in-session). This just composites the translated text onto the image.
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ImageTextItem } from "./types.ts";

// Point fontconfig at the bundled font (resolved relative to this script, so it
// works no matter the current working directory).
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fontDir = path.join(here, "..", "fonts");
  if (!process.env.FONTCONFIG_PATH && fs.existsSync(path.join(fontDir, "fonts.conf"))) {
    process.env.FONTCONFIG_PATH = fontDir;
  }
} catch {
  /* ignore */
}

const MAX_EDGE = 1600;

export interface FetchedImage {
  png: Buffer;
  width: number;
  height: number;
}

export async function fetchImageAsPng(url: string): Promise<FetchedImage> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" } });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  let img = sharp(raw, { failOn: "none" });
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (Math.max(w, h) > MAX_EDGE) img = img.resize({ width: w >= h ? MAX_EDGE : undefined, height: h > w ? MAX_EDGE : undefined });
  const png = await img.png().toBuffer();
  const outMeta = await sharp(png).metadata();
  return { png, width: outMeta.width || w, height: outMeta.height || h };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fitFont(text: string, w: number, h: number): number {
  const byWidth = w / (0.56 * Math.max(text.length, 1));
  const byHeight = h * 0.82;
  return Math.max(8, Math.min(byWidth, byHeight));
}

export interface OutputOptions {
  format?: "webp" | "png";
  quality?: number;
}

export const OUTPUT_MIME: Record<"webp" | "png", string> = {
  webp: "image/webp",
  png: "image/png",
};

const RTL_RE = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

export async function regenerateImage(
  img: FetchedImage,
  items: ImageTextItem[],
  out: OutputOptions = {}
): Promise<Buffer> {
  const parts: string[] = [];
  for (const it of items) {
    const [x0, y0, x1, y1] = it.box;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    const value = (it.translated || it.text).trim();
    if (!value) continue;
    const vertical = h > w * 2 && value.length > 2;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    parts.push(
      `<rect x="${x0 - 2}" y="${y0 - 2}" width="${w + 4}" height="${h + 4}" fill="${it.bgColor || "#ffffff"}"/>`
    );
    const size = vertical ? fitFont(value, h, w) : fitFont(value, w, h);
    const transform = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : "";
    const dir = RTL_RE.test(value) ? ' direction="rtl"' : "";
    parts.push(
      `<text x="${cx}" y="${cy}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size.toFixed(1)}" fill="${it.textColor || "#222222"}" text-anchor="middle" dominant-baseline="central"${dir}${transform}>${esc(value)}</text>`
    );
  }
  const svg = `<svg width="${img.width}" height="${img.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
  const composed = sharp(img.png).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  const format = out.format || "webp";
  const quality = Math.min(100, Math.max(1, out.quality ?? 80));
  return format === "png" ? composed.png().toBuffer() : composed.webp({ quality, effort: 4 }).toBuffer();
}
