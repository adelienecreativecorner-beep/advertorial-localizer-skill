// prepare.ts — clean the competitor HTML and extract what needs translating.
// Usage: node --experimental-strip-types prepare.ts <input.html> <workDir> [baseUrl]
// Writes into <workDir>: working.html, segments.json, images.json
import fs from "node:fs";
import path from "node:path";
import { prepareHtml } from "./html.ts";

const [inputPath, workDir, baseUrl] = process.argv.slice(2);
if (!inputPath || !workDir) {
  console.error("Usage: prepare.ts <input.html> <workDir> [baseUrl]");
  process.exit(1);
}
fs.mkdirSync(workDir, { recursive: true });

const rawHtml = fs.readFileSync(inputPath, "utf8");
const prep = prepareHtml(rawHtml, baseUrl || undefined);

fs.writeFileSync(path.join(workDir, "working.html"), prep.workingHtml);
fs.writeFileSync(
  path.join(workDir, "segments.json"),
  JSON.stringify(prep.segments.map((s) => ({ id: s.id, context: s.context, source: s.source })), null, 2)
);
fs.writeFileSync(path.join(workDir, "images.json"), JSON.stringify(prep.images, null, 2));

const withText = prep.images.length;
console.log(
  JSON.stringify(
    {
      ok: true,
      segments: prep.segments.length,
      images: withText,
      strippedTrackers: prep.strippedCount,
      ctasRepointed: prep.ctaCount,
      wrote: ["working.html", "segments.json", "images.json"].map((f) => path.join(workDir, f)),
    },
    null,
    2
  )
);
