// Shared types for the advertorial localization pipeline.

export type IssueType = "translation" | "localization" | "claim";
export type Severity = "high" | "medium" | "low";

export interface Issue {
  type: IssueType;
  severity: Severity;
  note: string;
  suggestion?: string;
}

// One translatable unit extracted from the source HTML.
export interface Segment {
  id: string; // stable id matching a data-loc-id in the working HTML
  source: string; // original text
  translated: string; // translated text (editable by the user)
  context?: string; // where it sits (e.g. "h1", "button", "img:alt")
  issues: Issue[]; // flags raised during translation/audit
}

export interface ImageTextItem {
  text: string; // original text found in the image
  translated: string; // translated text (editable by the user)
  box: [number, number, number, number]; // [x0,y0,x1,y1] in image pixels
  textColor: string; // approx hex of the text
  bgColor: string; // approx hex of the background behind the text
}

export interface ImageItem {
  id: string;
  src: string; // absolute URL
  context: string; // e.g. "<img>", "background"
  hasText: boolean | null; // null = not yet scanned
  scanned?: boolean; // vision scan has run
  width?: number;
  height?: number;
  items?: ImageTextItem[]; // detected + translated text regions
  replacementDataUrl?: string; // user-uploaded or auto-regenerated image (local preview)
  hostedUrl?: string; // final hosted URL (e.g. pasted Funnelish link) used in export
}

export interface ProjectInput {
  competitorUrl: string;
  competitorName: string; // the competitor's product/brand name found in the copy
  yourName: string; // your product name — replaces the competitor's, kept untranslated
  sourceLang: string; // "auto" or an ISO-ish label
  sourceMarket: string;
  targetLang: string;
  targetMarket: string;
  html: string;
}

export interface TranslateResult {
  sourceLangDetected: string;
  segments: Segment[];
  images: ImageItem[];
  workingHtml: string; // source HTML annotated with data-loc-id markers
  strippedCount: number; // number of competitor scripts/trackers removed
  ctaCount: number; // number of links/buttons repointed to #next-step
}
