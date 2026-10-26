---
name: advertorial-localizer
description: >-
  Clone a competitor advertorial / listicle sales page into a new language and
  market, swap the competitor's product name for the user's, flag risky health/
  income claims, localize the images, and output Funnelish-ready HTML. Use when
  the user wants to translate, localize, clone, or "rip" a competitor advertorial
  or sales page (ClickFunnels/Funnelish/Shopify listicle) into another language
  (e.g. German, Hebrew, Dutch, Arabic) — including right-to-left pages. Does the
  AI work in-session (no paid API), with local scripts for the deterministic
  HTML/CSS/image processing.
---

# Advertorial Localizer

Localize a competitor advertorial into a new market as **Funnelish-ready HTML**.
You (Claude) do the translation, claim-flagging and image reading in-session —
that is covered by the user's Claude subscription, so there is **no per-page API
cost**. Local Node scripts do the deterministic HTML/CSS/image work.

**Scripts live in this skill's `scripts/` folder.** Run them with
`node --experimental-strip-types <skillDir>/scripts/<name>.ts ...` (Node 22.6+).

## 0. One-time setup (first run only)
If `scripts/node_modules` does not exist, install the script deps once:
```bash
cd "<skillDir>/scripts" && npm install
```
(Takes ~30s. cheerio, postcss, rtlcss, sharp.)

## 1. Gather inputs
Ask for (or accept from the message):
- **Competitor advertorial** — a URL, or pasted "View Page Source" HTML.
- **Competitor's product name** (e.g. "Elastin Peptide") — the name in their copy.
- **Your product name** (e.g. "Vitalisse") — replaces the competitor's everywhere.
- **Target language** and **target market** (e.g. German / Germany, Hebrew / Israel).

Make a work directory for this job, e.g. `mkdir -p ./adv-work` (use the user's
project dir or a temp dir). All intermediate files go there.

## 2. Get the HTML
- If a **URL**: fetch it (`curl -sL "<url>" -o ./adv-work/source.html`, or WebFetch).
  If the page is JS-rendered/bot-protected and comes back thin, ask the user to
  paste the View-Source HTML instead.
- If **pasted HTML**: write it to `./adv-work/source.html`.

## 3. Prepare (clean + extract)
```bash
node --experimental-strip-types "<skillDir>/scripts/prepare.ts" ./adv-work/source.html ./adv-work "<competitorUrl-or-blank>"
```
This strips the competitor's trackers/scripts and repoints **every CTA** to
`#next-step` — all buttons, all image links, and dead placeholder links like
`#0` / `javascript:` (the competitor's JS click handlers are removed so the
plain anchor drives navigation). It also un-lazies images and writes
`working.html`, `segments.json`, `images.json`.
Report the counts (segments, images, trackers stripped, CTAs repointed).

## 4. Translate (you do this — no API)
Read `./adv-work/segments.json` (array of `{id, context, source}`). Produce
`./adv-work/translated.json` = array of `{id, translated, issues}` following
these rules **exactly**:

- **Translate faithfully and persuasively** into the target language/market —
  keep the marketing punch (scarcity, urgency, discounts, guarantees, bold
  claims). Natural for a native reader, not word-for-word.
- **Brand swap:** replace EVERY mention of the competitor's product/brand with
  the user's product name. Keep the user's name untranslated, verbatim.
- **Output is final published copy.** NEVER write instructions, notes or
  placeholders into `translated` (never "use a local name", "mention the terms",
  etc.). If a claim worries you, put that ONLY in `issues`, never in `translated`.
- **Personal names** in testimonials/reviews → replace with a realistic name
  that fits the target market (keep any age). An actual name, never an instruction.
- **Inline markers:** some `source` strings contain markers like `⟦0⟧…⟦/0⟧`
  (or self-contained `⟦2⟧`). They represent inline formatting (bold, links,
  `<br>`). Keep EVERY marker exactly, moving each pair to wrap the equivalent
  translated words. Never translate, renumber, add, drop, or reorder them.
- **Keep proper names** verbatim (e.g. "National Library of Medicine").
- **Guarantees → 30 days.** Normalize any money-back / guarantee period to
  **30 days** (e.g. a "90-day guarantee" becomes 30), in the copy and in any
  regenerated image, unless the user specifies a different length.
- **Flag risky claims:** for each segment add `issues` ONLY when something needs
  human attention — `{type, severity, note, suggestion}`:
  - `"claim"` — health/medical/efficacy/income claims that may breach ad rules in
    the target market (disease claims, "guaranteed", "cure", unverifiable results).
  - `"localization"` — currency, units (lb/kg, °F/°C), dates, payment/shipping
    terms left unadapted.
  - `"translation"` — ambiguity/wordplay where meaning risks being lost.
  Most segments have `issues: []`.

Return the translation for EVERY id. After writing `translated.json`, briefly
tell the user how many **claim** flags you raised and summarize the high-severity
ones (these are the ad-compliance risks that get accounts banned).

## 5. Images (optional — ask the user)
`images.json` lists every image URL. Photos (people, product shots) need no
change — they keep the competitor's URL. Only **graphics with baked-in text**
(charts, timelines, badges, callouts) need regenerating.

For each image the user wants localized:
1. View the image (read the URL) to see its text.
2. Write `./adv-work/img-<n>.json`:
   ```json
   { "src": "<imageUrl>", "items": [
     { "translated": "<translated text>", "box": [x0,y0,x1,y1],
       "textColor": "#hex", "bgColor": "#hex" } ] }
   ```
   **`box` values are FRACTIONS 0..1** of width/height (left, top, right, bottom).
   Apply the same brand-swap + faithful-translation rules to image text.
3. Render it:
   ```bash
   node --experimental-strip-types "<skillDir>/scripts/regen-image.ts" ./adv-work/img-<n>.json ./adv-work/img-<n>.webp
   ```
4. Show the user the `.webp` and keep only the ones that look right (text on a
   solid/near-solid background works best; text over photos may need a manual
   image instead).

**RTL before/after images:** for a right-to-left target, a side-by-side
before/after composite reads backwards — the "before" must be on the **right**
and the "after" on the **left**. Swap the two halves of the image (split at the
midline, put the right half on the left and vice-versa) and swap any stage
labels (WEEK 1 / WEEK 4 → שבוע 1 on the right, שבוע 4 on the left) so each label
stays with its photo.

**Hosting:** regenerated images must live somewhere with a URL. Tell the user to
upload the `.webp` files to Funnelish's media library (or Shopify), then give you
the URLs. Put them in the `images` map in step 6 (`originalSrc → hostedUrl`).
Images you don't localize stay on the competitor's URL automatically.

## 6. Export (build the final HTML)
Write `./adv-work/config.json`:
```json
{
  "targetLang": "German",
  "mode": "content",
  "stickyText": "VERFÜGBARKEIT PRÜFEN →",
  "maxWidth": 0,
  "baseUrl": "<competitorUrl-or-blank>",
  "images": { "<originalSrcUrl>": "<hostedUrl>" }
}
```
- `mode`: `"content"` (default — just the advertorial + scoped styles, for
  pasting into a Funnelish Custom HTML element) or `"full"` (whole page).
- `stickyText`: a bottom CTA button (in-flow, links to `#next-step`); omit/empty
  for none. Use the target-language wording.
- `maxWidth`: px to center the body column (e.g. 720), or `0` for full width.
- RTL is automatic for Hebrew/Arabic/Persian/Urdu (dir=rtl + CSS flipping).
- `images`: only the ones you hosted; omit the key if none.

Then:
```bash
node --experimental-strip-types "<skillDir>/scripts/export.ts" ./adv-work
```
Produces `./adv-work/final.html`.

## 7. Hand off
Give the user `final.html` (and the regenerated `.webp` files). Tell them to
paste `final.html`'s contents into a Funnelish **Custom HTML / Code** element.
Remind them: photos stay on the competitor CDN (swap later if needed), and the
claim flags from step 4 are the compliance risks to review before launch.

## Notes
- **Cost:** translation/flagging/image-reading = your Claude subscription (no API
  key, no per-page charge). Only local compute for the scripts.
- The HTML/CSS behavior (CSS scoping so Funnelish's editor isn't broken, removing
  builder-embedded `<style>` globals, neutralizing fixed/sticky, RTL flipping) is
  identical to the hosted app — handled by `scripts/html.ts`.
- If a script errors with a missing module, run the step-0 `npm install`.
