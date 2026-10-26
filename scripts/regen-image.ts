// regen-image.ts — render translated text onto one image (WebP out).
// Usage: node --experimental-strip-types regen-image.ts <items.json> <out.webp> [quality]
//
// items.json shape — boxes are FRACTIONS of width/height (0..1), so they don't
// depend on the image's pixel size:
// {
//   "src": "https://.../chart.png",
//   "items": [
//     { "translated": "VERBESSERUNG (%)", "box": [0.05,0.37,0.08,0.62],
//       "textColor": "#111111", "bgColor": "#f8f9f9" }
//   ]
// }
import fs from "node:fs";
import { fetchImageAsPng, regenerateImage } from "./images-lib.ts";
import type { ImageTextItem } from "./types.ts";

const [itemsPath, outPath, qualityArg] = process.argv.slice(2);
if (!itemsPath || !outPath) {
  console.error("Usage: regen-image.ts <items.json> <out.webp> [quality]");
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(itemsPath, "utf8")) as {
  src: string;
  items: { translated: string; text?: string; box: number[]; textColor?: string; bgColor?: string }[];
};

const img = await fetchImageAsPng(spec.src);

// Convert fractional boxes (0..1) to pixels in the fetched image's space.
const items: ImageTextItem[] = spec.items.map((it) => {
  const [fx0, fy0, fx1, fy1] = it.box;
  const px = (f: number, dim: number) => Math.round((f <= 1 ? f * dim : f));
  return {
    text: it.text || "",
    translated: it.translated,
    box: [px(fx0, img.width), px(fy0, img.height), px(fx1, img.width), px(fy1, img.height)] as [
      number,
      number,
      number,
      number,
    ],
    textColor: it.textColor || "#222222",
    bgColor: it.bgColor || "#ffffff",
  };
});

const buf = await regenerateImage(img, items, { format: "webp", quality: qualityArg ? Number(qualityArg) : 80 });
fs.writeFileSync(outPath, buf);
console.log(JSON.stringify({ ok: true, wrote: outPath, sizeKB: Math.round(buf.length / 1024), dims: `${img.width}x${img.height}` }, null, 2));
