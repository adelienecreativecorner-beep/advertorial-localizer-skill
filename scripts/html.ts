import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import postcss from "postcss";
import rtlcss from "rtlcss";
import type { ImageItem, Segment } from "./types";

const SCOPE = ".adv-loc";

export { absolutize };

// Tags whose content we never translate.
const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);

// Phrasing content that appears mid-sentence; its text is folded into the phrase.
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "del", "em", "font",
  "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small", "span", "strong",
  "sub", "sup", "time", "tt", "u", "var", "wbr",
]);
const VOID_TAGS = new Set(["br", "wbr", "img", "input", "area", "hr", "embed", "source"]);

// Token markers for inline tags inside a phrase (unlikely to occur in real copy).
const OPEN = (i: number) => `⟦${i}⟧`; // ⟦i⟧
const CLOSE = (i: number) => `⟦/${i}⟧`; // ⟦/i⟧
const TOKEN_RE = /⟦(\/?)(\d+)⟧/g;

function hasMeaningfulText(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

// Map a language name (or code) to an ISO 639-1 code for the <html lang> attr.
const LANG_CODES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", dutch: "nl", polish: "pl", swedish: "sv", danish: "da",
  norwegian: "no", finnish: "fi", japanese: "ja", korean: "ko", arabic: "ar",
  turkish: "tr", greek: "el", czech: "cs", romanian: "ro", hungarian: "hu",
  hebrew: "he", persian: "fa", farsi: "fa", urdu: "ur", yiddish: "yi",
};
function langCode(lang: string): string | null {
  const key = lang.trim().toLowerCase();
  if (LANG_CODES[key]) return LANG_CODES[key];
  if (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(lang.trim())) return lang.trim().toLowerCase();
  return null;
}

// Right-to-left languages (by name or code).
const RTL_CODES = new Set(["he", "ar", "fa", "ur", "yi", "ps", "sd", "dv", "ckb"]);
export function isRtlLang(lang: string): boolean {
  if (!lang) return false;
  const code = langCode(lang) || lang.trim().toLowerCase();
  return RTL_CODES.has(code);
}

// Flip left/right directional properties in an inline style string for RTL,
// reusing rtlcss (wrap as a rule, flip, unwrap) so the logic matches stylesheet
// flipping exactly and handles edge cases correctly.
function flipInlineStyle(style: string): string {
  if (!/left|right|margin|padding|float|text-align/i.test(style)) return style;
  try {
    const flipped = rtlcss.process(`.x{${style}}`);
    const m = flipped.match(/\{([\s\S]*)\}\s*$/);
    return m ? m[1].trim() : style;
  } catch {
    return style;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function absolutize(url: string, base?: string): string {
  if (!url) return url;
  let u = url.trim();
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) return u;
  if (base) {
    try {
      return new URL(u, base).href;
    } catch {
      return u;
    }
  }
  return u;
}

interface NodeLike {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: AnyNode[];
  parent?: { name?: string };
}

interface TagEntry {
  open: string;
  close: string;
  isVoid: boolean;
}

interface Phrase {
  nodes: AnyNode[]; // consecutive sibling nodes making up this run
  context: string; // parent tag name
  lead: string; // leading whitespace of the run
  trail: string; // trailing whitespace of the run
  core: string; // tokenized source (no outer whitespace)
  table: TagEntry[]; // inline tag table referenced by the tokens
}

function isInlineOrText(node: AnyNode): boolean {
  const n = node as unknown as NodeLike;
  if (n.type === "text") return true;
  if (n.type === "tag") return INLINE_TAGS.has((n.name || "").toLowerCase());
  return false;
}

function textOf(node: AnyNode): string {
  const n = node as unknown as NodeLike;
  if (n.type === "text") return n.data || "";
  if (n.type === "tag") return (n.children || []).map(textOf).join("");
  return "";
}

function serializeAttribs(attribs?: Record<string, string>): string {
  if (!attribs) return "";
  return Object.entries(attribs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v ?? "")}"`)
    .join("");
}

// Turn a run of inline/text nodes into a tokenized string + tag table.
function tokenize(run: AnyNode[]): { s: string; table: TagEntry[] } {
  const table: TagEntry[] = [];
  let s = "";
  const emit = (node: AnyNode) => {
    const n = node as unknown as NodeLike;
    if (n.type === "text") {
      s += n.data || "";
      return;
    }
    if (n.type !== "tag") return;
    const name = (n.name || "").toLowerCase();
    const isVoid = VOID_TAGS.has(name);
    const idx = table.length;
    table.push({ open: `<${name}${serializeAttribs(n.attribs)}>`, close: `</${name}>`, isVoid });
    if (isVoid) {
      s += OPEN(idx);
    } else {
      s += OPEN(idx);
      for (const c of n.children || []) emit(c);
      s += CLOSE(idx);
    }
  };
  for (const node of run) emit(node);
  return { s, table };
}

// Rebuild an HTML fragment from a tokenized string + its tag table.
function buildHtml(tokenized: string, table: TagEntry[]): string {
  let html = "";
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(tokenized))) {
    html += escapeHtml(tokenized.slice(last, m.index));
    const slash = m[1];
    const idx = Number(m[2]);
    const entry = table[idx];
    if (entry) {
      if (entry.isVoid) html += entry.open;
      else html += slash ? entry.close : entry.open;
    }
    last = m.index + m[0].length;
  }
  html += escapeHtml(tokenized.slice(last));
  return html;
}

// Deterministic collection of translatable phrases (runs of inline/text content,
// split by block elements). Same order in extract + apply is the contract.
function collectPhrases($: CheerioAPI): Phrase[] {
  const phrases: Phrase[] = [];

  const walk = (parent: AnyNode) => {
    const pn = parent as unknown as NodeLike;
    const children = pn.children || [];
    const parentName = (pn.name || "text").toLowerCase();
    let i = 0;
    while (i < children.length) {
      const node = children[i];
      if (isInlineOrText(node)) {
        // Gather a maximal run of consecutive inline/text siblings.
        const run: AnyNode[] = [];
        while (i < children.length && isInlineOrText(children[i])) {
          run.push(children[i]);
          i++;
        }
        const full = run.map(textOf).join("");
        if (hasMeaningfulText(full)) {
          const { s, table } = tokenize(run);
          const lead = s.match(/^\s*/)?.[0] ?? "";
          const trail = s.match(/\s*$/)?.[0] ?? "";
          const core = s.slice(lead.length, s.length - trail.length);
          phrases.push({ nodes: run, context: parentName, lead, trail, core, table });
        }
        continue;
      }
      // Block (or other) node: recurse into it unless it's skippable.
      const n = node as unknown as NodeLike;
      if (n.type === "tag" && !SKIP_TAGS.has((n.name || "").toLowerCase())) walk(node);
      i++;
    }
  };

  walk($.root()[0] as unknown as AnyNode);
  return phrases;
}

export interface PreparedHtml {
  workingHtml: string;
  segments: Segment[];
  images: ImageItem[];
  strippedCount: number;
  ctaCount: number;
}

/**
 * Clean the competitor HTML (strip their tracking + repoint CTAs to #next-step),
 * then extract translatable phrases (inline formatting preserved as tokens) and
 * the image inventory.
 */
export function prepareHtml(rawHtml: string, base?: string): PreparedHtml {
  const $ = cheerio.load(rawHtml);

  // 1. Strip the competitor's scripts / pixels / cart logic.
  let strippedCount = 0;
  $("script").each((_, el) => {
    strippedCount++;
    $(el).remove();
  });
  $(
    'iframe[src*="facebook"], img[src*="facebook.com/tr"], iframe[src*="googletagmanager"], iframe[src*="doubleclick"]'
  ).each((_, el) => {
    strippedCount++;
    $(el).remove();
  });

  // 2. Repoint every CTA to the funnel's next step. The competitor relies on JS
  // (Alpine x-on:click, etc.) we strip, and uses dead placeholder hrefs like
  // "#0" — so every image link, button and dead/outbound link must be made a
  // plain anchor to #next-step. Genuine in-page anchors (#faq, #next-step) stay.
  let ctaCount = 0;
  const CLICK_ATTRS = ["onclick", "x-on:click", "@click", "v-on:click", "data-on:click"];
  const isDeadHref = (h: string) => h === "" || h === "#" || h === "#0" || h === "#!" || h === "#none" || h.startsWith("javascript:");
  $("a").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") || "").trim();
    const hasImg = $el.find("img").length > 0;
    const hasClick = CLICK_ATTRS.some((a) => $el.attr(a) != null);
    const external = href !== "" && !href.startsWith("#");
    if (external || isDeadHref(href) || hasImg || hasClick) {
      $el.attr("href", "#next-step").attr("target", "_self");
      ctaCount++;
    }
    // Drop framework click handlers so the plain href drives navigation.
    for (const a of CLICK_ATTRS) $el.removeAttr(a);
    $el.removeAttr("x-data");
  });
  $("form").each((_, el) => {
    $(el).attr("action", "#next-step").attr("method", "get");
    ctaCount++;
  });
  // Buttons can't carry an href, so convert them to navigable anchor-buttons
  // (keeping their classes/styles) pointed at #next-step.
  $("button").each((_, el) => {
    const $el = $(el);
    const a = $("<a></a>").attr("href", "#next-step").attr("target", "_self");
    const cls = $el.attr("class");
    const style = $el.attr("style");
    if (cls) a.attr("class", cls);
    if (style) a.attr("style", style);
    a.html($el.html() || "");
    $el.replaceWith(a);
    ctaCount++;
  });

  // 2b. Make images load eagerly. Lazy images rely on JS we strip, so they'd
  // render as blank gaps; promote any deferred real URL into src/srcset.
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") || "";
    const dataSrc = $el.attr("data-src");
    const isPlaceholder = !src || src.startsWith("data:image/svg") || src.startsWith("data:image/gif") || src.length < 40;
    if (dataSrc && isPlaceholder) $el.attr("src", dataSrc);
    const dataSrcset = $el.attr("data-srcset");
    if (dataSrcset && !$el.attr("srcset")) $el.attr("srcset", dataSrcset);
    $el.removeAttr("loading").removeAttr("data-src").removeAttr("data-srcset");
  });

  // 3. Extract translatable phrases (in document order).
  const segments: Segment[] = collectPhrases($).map((p, i) => ({
    id: `s${i}`,
    source: p.core,
    translated: "",
    context: p.context,
    issues: [],
  }));

  // 4. Inventory images (<img> + CSS background-image).
  const images: ImageItem[] = [];
  const seen = new Set<string>();
  const pushImage = (src: string, context: string) => {
    const abs = absolutize(src, base);
    if (!abs || abs.startsWith("data:") || seen.has(abs)) return;
    seen.add(abs);
    images.push({ id: `img${images.length}`, src: abs, context, hasText: null });
  };
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src) pushImage(src, "<img>");
  });
  $("[style*='url(']").each((_, el) => {
    const style = $(el).attr("style") || "";
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    if (m && m[2]) pushImage(m[2], "background");
  });

  return { workingHtml: $.html(), segments, images, strippedCount, ctaCount };
}

/**
 * Re-insert translated phrases into the cleaned HTML. Rebuilds each phrase's
 * inline tags from its tokens, preserving leading/trailing whitespace and
 * overall structure. Processes in reverse so earlier node refs stay valid.
 */
export function applyTranslations(
  workingHtml: string,
  segments: Segment[],
  targetLang?: string
): string {
  const $ = cheerio.load(workingHtml);
  if (targetLang) {
    const code = langCode(targetLang);
    if (code) $("html").attr("lang", code);
  }

  const phrases = collectPhrases($);
  for (let i = phrases.length - 1; i >= 0; i--) {
    const p = phrases[i];
    const seg = segments[i];
    if (!seg || p.nodes.length === 0) continue;
    const core = seg.translated && seg.translated.trim().length ? seg.translated.trim() : p.core;
    const html = buildHtml(p.lead + core + p.trail, p.table);
    // Replace the run: swap the first node for the rebuilt fragment, drop the rest.
    $(p.nodes[0] as AnyNode).replaceWith(html);
    for (let k = 1; k < p.nodes.length; k++) $(p.nodes[k] as AnyNode).remove();
  }
  return $.html();
}

export interface FinalizeOptions {
  mode?: "content" | "full"; // "content" = just the advertorial, for Funnelish
  sticky?: { text: string }; // inject a fixed bottom CTA
  rtl?: boolean; // mirror the page to right-to-left (Hebrew, Arabic, …)
  maxWidth?: number; // center the content in a column this many px wide (0/undefined = full width)
}

// Flip left/right directional properties in every inline style for RTL.
function flipInlineStylesRtl($: CheerioAPI): void {
  $("[style]").each((_, el) => {
    const s = $(el).attr("style") || "";
    if (/left|right|margin|padding|float|text-align/i.test(s)) $(el).attr("style", flipInlineStyle(s));
  });
}

// An in-flow CTA button (NOT position:fixed — a fixed element would float over
// and break the Funnelish editor). For a true floating sticky, use Funnelish's
// own sticky-bar element pointed at #next-step.
function ctaButtonHtml(text: string): string {
  return (
    `<a href="#next-step" style="display:block;box-sizing:border-box;width:100%;` +
    `margin:28px auto 8px;max-width:680px;padding:18px 20px;border-radius:8px;` +
    `background:#1E5A96;color:#fff;text-align:center;text-decoration:none;` +
    `font:700 18px/1.25 Arial,Helvetica,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.12)">` +
    `${escapeHtml(text)}</a>`
  );
}

// Prefix one selector so it only matches inside the scope container. Type
// selectors html/body/:root are redirected to the scope itself; everything
// else is made a descendant of the scope. Class/id names are never rewritten.
function scopeSelector(sel: string, scope: string): string {
  let s = sel.trim();
  if (!s) return sel;
  // Leave :not()/::before etc. that start with pseudo as descendants.
  if (/^(:root|html|body)([^\w-]|$)/i.test(s)) {
    s = s.replace(/^(:root|html|body)/i, scope);
    return s; // e.g. ".adv-loc", ".adv-loc .x", ".adv-loc.foo"
  }
  return `${scope} ${s}`;
}

// Rewrite a CSS string so every rule only applies inside the scope container,
// keeping @media/@supports (recursed), @keyframes/@font-face (left intact).
function scopeStyles(css: string, scope: string): string {
  try {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      const parent = rule.parent as { type?: string; name?: string } | undefined;
      if (parent && parent.type === "atrule" && /keyframes/i.test(parent.name || "")) return;
      rule.selectors = rule.selectors.map((s) => scopeSelector(s, scope));
    });
    // Fixed/sticky elements escape the scope container and float over the host
    // editor — demote them so nothing covers the Funnelish toolbar.
    root.walkDecls("position", (decl) => {
      if (/^\s*(fixed|sticky)\s*$/i.test(decl.value)) decl.value = "static";
    });
    return root.toString();
  } catch {
    return ""; // drop CSS we can't safely parse rather than risk the host page
  }
}

// Demote inline position:fixed / position:sticky to static so no element
// escapes the container to overlay the host editor.
function neutralizeInlinePositions($: CheerioAPI): void {
  $("[style]").each((_, el) => {
    const s = $(el).attr("style") || "";
    if (/position\s*:\s*(fixed|sticky)/i.test(s)) {
      $(el).attr("style", s.replace(/position\s*:\s*(fixed|sticky)/gi, "position:static"));
    }
  });
}

/**
 * Produce the final export. In "content" mode (default) it keeps only the main
 * advertorial container plus the page's <style> blocks — dropping the Shopify
 * header/nav/footer/cart/popups that break Funnelish and create the big top gap.
 * Optionally injects a sticky bottom CTA (the competitor's was JS-driven).
 */
export function finalizeExport(fullHtml: string, opts: FinalizeOptions = {}): string {
  const mode = opts.mode || "content";
  const rtl = !!opts.rtl;
  const cta = opts.sticky?.text ? ctaButtonHtml(opts.sticky.text) : "";
  const flipCss = (css: string) => {
    if (!rtl || !css) return css;
    try {
      return rtlcss.process(css);
    } catch {
      return css;
    }
  };

  if (mode === "full") {
    if (!cta && !rtl) return fullHtml;
    const $ = cheerio.load(fullHtml);
    if (rtl) {
      $("html").attr("dir", "rtl");
      flipInlineStylesRtl($);
      $("style").each((_, el) => {
        $(el).replaceWith(`<style>${flipCss($(el).html() || "")}</style>`);
      });
    }
    if (cta) $("body").append(cta);
    return $.html();
  }

  const $ = cheerio.load(fullHtml);
  // Demote any fixed/sticky content so nothing overlays the host editor.
  neutralizeInlinePositions($);
  if (rtl) flipInlineStylesRtl($);

  // Collect, SCOPE, and (for RTL) flip all CSS so it can't leak into the host page.
  const rawCss = $("style")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");
  // Remove @import rules (external, unscopable — fonts fall back gracefully).
  const scopedCss = flipCss(scopeStyles(rawCss, SCOPE)).replace(/@import[^;]+;/gi, "");
  // Drop the ORIGINAL <style> blocks so the content carries only our scoped copy.
  // (Builders like Replo embed <style> inside the content, which would otherwise
  // ship unscoped global rules — e.g. body{} — that break the host editor.)
  $("style").remove();

  // Pick the content root: #MainContent, then <main>, else the largest text block.
  let root: AnyNode | undefined = ($("#MainContent")[0] || $("main")[0]) as AnyNode | undefined;
  if (!root) {
    let bestLen = 0;
    $("section, article, div").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim().length;
      if (t > bestLen) {
        bestLen = t;
        root = el as unknown as AnyNode;
      }
    });
  }
  const content = root ? $.html(root) : $("body").html() || "";
  // Everything lives inside the scope container (position:relative contains any
  // absolutely-positioned children so they can't escape over the host editor).
  const dirAttr = rtl ? ' dir="rtl"' : "";
  let wrapperStyle = rtl ? "position:relative;text-align:right" : "position:relative";
  if (opts.maxWidth && opts.maxWidth > 0) {
    wrapperStyle += `;max-width:${Math.round(opts.maxWidth)}px;margin-left:auto;margin-right:auto`;
  }
  return (
    `<style>${scopedCss}</style>\n` +
    `<div class="adv-loc"${dirAttr} style="${wrapperStyle}">${content}\n${cta}</div>`
  ).trim();
}

/**
 * Swap image sources for user-provided replacements (uploaded or regenerated).
 * Matches on the absolute URL recorded during extraction.
 */
export function applyImages(html: string, images: ImageItem[], base?: string): string {
  const replacements = new Map<string, string>();
  for (const im of images) {
    // Prefer a hosted URL (e.g. a pasted Funnelish link) over the inline data URL.
    const rep = im.hostedUrl || im.replacementDataUrl;
    if (rep) replacements.set(im.src, rep);
  }
  if (replacements.size === 0) return html;

  const $ = cheerio.load(html);
  $("img").each((_, el) => {
    const src = absolutize($(el).attr("src") || $(el).attr("data-src") || "", base);
    const rep = replacements.get(src);
    if (rep) {
      $(el).attr("src", rep).removeAttr("srcset").removeAttr("data-src").removeAttr("data-srcset");
    }
  });
  // <picture><source srcset> siblings would otherwise win over the replaced
  // <img> (e.g. a desktop "min-width" media query), so repoint matching sources.
  $("source").each((_, el) => {
    const ss = $(el).attr("srcset") || $(el).attr("data-srcset") || "";
    const first = ss.split(",")[0]?.trim().split(/\s+/)[0] || "";
    if (!first) return;
    const rep = replacements.get(absolutize(first, base));
    if (rep) $(el).attr("srcset", rep).removeAttr("data-srcset");
  });
  $("[style*='url(']").each((_, el) => {
    const style = $(el).attr("style") || "";
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    if (m && m[2]) {
      const abs = absolutize(m[2], base);
      const rep = replacements.get(abs);
      if (rep) $(el).attr("style", style.replace(m[0], `url("${rep}")`));
    }
  });
  return $.html();
}
