// export.ts — build the final Funnelish-ready HTML from the translation.
// Usage: node --experimental-strip-types export.ts <workDir>
// Reads from <workDir>: working.html, segments.json, translated.json, config.json
// Writes:  <workDir>/final.html
//
// config.json shape (all optional except targetLang):
// {
//   "targetLang": "German",
//   "mode": "content" | "full",        // default "content" (Funnelish)
//   "stickyText": "VERFÜGBARKEIT PRÜFEN →",   // omit for none
//   "maxWidth": 720,                    // omit/0 for full width
//   "baseUrl": "https://competitor.com/pages/x",
//   "images": { "<originalSrcUrl>": "<hostedUrl or data: URL>" }   // replacements
// }
import fs from "node:fs";
import path from "node:path";
import { applyTranslations, applyImages, finalizeExport, isRtlLang } from "./html.ts";

const workDir = process.argv[2];
if (!workDir) {
  console.error("Usage: export.ts <workDir>");
  process.exit(1);
}
const read = (f: string) => fs.readFileSync(path.join(workDir, f), "utf8");

const workingHtml = read("working.html");
const segs = JSON.parse(read("segments.json")) as { id: string; source: string; context: string }[];
const translated = JSON.parse(read("translated.json")) as { id: string; translated: string }[];
const config = JSON.parse(fs.existsSync(path.join(workDir, "config.json")) ? read("config.json") : "{}");

const tById = new Map(translated.map((t) => [t.id, t.translated]));
const segments = segs.map((s) => ({
  id: s.id,
  source: s.source,
  context: s.context,
  translated: tById.get(s.id) ?? "",
  issues: [],
}));

let html = applyTranslations(workingHtml, segments, config.targetLang);

const images = config.images && typeof config.images === "object" ? config.images : null;
if (images) {
  const imageItems = Object.entries(images).map(([src, rep], i) => ({
    id: `img${i}`,
    src,
    context: "<img>",
    hasText: null as null,
    hostedUrl: rep as string,
  }));
  html = applyImages(html, imageItems, config.baseUrl || undefined);
}

html = finalizeExport(html, {
  mode: config.mode === "full" ? "full" : "content",
  rtl: isRtlLang(config.targetLang || ""),
  sticky: config.stickyText && String(config.stickyText).trim() ? { text: String(config.stickyText).trim() } : undefined,
  maxWidth: typeof config.maxWidth === "number" && config.maxWidth > 0 ? config.maxWidth : undefined,
});

const out = path.join(workDir, "final.html");
fs.writeFileSync(out, html);
console.log(JSON.stringify({ ok: true, wrote: out, sizeKB: Math.round(html.length / 1024) }, null, 2));
