export interface Warning {
  code: string;
  message: string;
}

export interface ConvertResult {
  markdown: string;
  warnings: Warning[];
}

export interface ConvertOptions {
  filename?: string;
  engine: ConvertEngine;
  /** Aborting rejects the call (or the next iterator step) with `signal.reason`. */
  signal?: AbortSignal;
}

/**
 * Where a part's Markdown came from: the document's own text (`text`), OCR (`ocr`), the document's text with OCR
 * text of its embedded images spliced in (`mixed`), or nowhere because nothing could be converted (`none`).
 */
export type PartSource = "text" | "ocr" | "mixed" | "none";

/**
 * Why a PDF page was OCR'd instead of extracted: the whole document was classified as scanned or image-based
 * (`scanned-document`), the page's text layer does not decode (`garbled-text`), the classifier or the page
 * extractor flagged the page for another reason (`page-flagged`), or structured extraction failed (`extraction-failed`).
 */
export type OcrReason = "scanned-document" | "garbled-text" | "page-flagged" | "extraction-failed";

/** One unit of a manuscript yielded by `convertPages()`. */
export interface ConvertPart {
  /** 1-based page number for paged inputs (PDF); null for inputs converted as a whole. */
  page: number | null;
  /** Page count of the whole document when known; null otherwise. */
  pageCount: number | null;
  /** Markdown for this part, without a trailing newline. May be empty. */
  markdown: string;
  warnings: Warning[];
  source: PartSource;
  /** Set on PDF pages that were routed to OCR, whether or not OCR succeeded; null otherwise. */
  ocrReason: OcrReason | null;
}

export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "tiff" | "heic";

export type DetectedKind =
  | { kind: "image"; format: ImageFormat }
  | { kind: "pdf" }
  | { kind: "office"; format: string }
  | { kind: "unknown" };

export interface OcrLine {
  text: string;
  /** Corners in rendered-page pixels, origin top left. Absent for engines that do not report boxes. */
  box?: ReadonlyArray<{ x: number; y: number }>;
}

/** How an OCR'd PDF page was rendered: its crop box in PDF points, `/Rotate`, and pixels per point. */
export interface OcrPdfRender {
  rotation: number;
  cropBox: { x: number; y: number; width: number; height: number };
  scale: number;
}

export interface OcrPage {
  index: number;
  lines: readonly OcrLine[];
  /** Present for pages rendered from a PDF. */
  render?: OcrPdfRender;
}

export interface OcrPort {
  recognizeEncoded(
    bytes: Uint8Array,
    options?: { signal?: AbortSignal },
  ): Promise<{ lines: readonly OcrLine[] }>;
  /** `dpi` is the PDF render resolution; omit it for the engine's default. */
  recognizeDocument(
    bytes: Uint8Array,
    options?: { pageRange?: { start: number; end: number }; dpi?: number; signal?: AbortSignal },
  ): AsyncIterable<OcrPage>;
  close(): Promise<void>;
}

export interface AnydocAsset {
  id: number;
  mediaType: string;
  originPart: string;
  data: Uint8Array;
}

export interface AnydocStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

export interface AnydocImageSource {
  kind: "external" | "asset" | "unavailable";
  url?: string;
  assetId?: number;
}

export interface AnydocLinkTarget {
  kind: "external" | "relative" | "anchor";
  value: string;
}

export interface AnydocInline {
  kind: "text" | "link" | "image" | "anchor" | "noteRef" | "lineBreak";
  text?: string;
  style?: AnydocStyle;
  content?: AnydocInline[];
  target?: AnydocLinkTarget;
  alt?: string;
  source?: AnydocImageSource;
  anchor?: string;
  noteId?: string;
}

export interface AnydocListItem {
  blocks: AnydocBlock[];
  checked?: boolean;
  markerLabel?: string;
}

export interface AnydocList {
  marker: "bullet" | "decimal" | "lowerAlpha" | "upperAlpha" | "lowerRoman" | "upperRoman";
  start: number;
  items: AnydocListItem[];
}

export interface AnydocCell {
  blocks: AnydocBlock[];
  colSpan: number;
  rowSpan: number;
}

export interface AnydocCellSlot {
  kind: "origin" | "covered";
  cell?: AnydocCell;
}

export interface AnydocTable {
  grid: AnydocCellSlot[][];
  headerRows: number;
  kind: "data" | "layout";
}

export interface AnydocBlock {
  kind: "heading" | "paragraph" | "list" | "table" | "blockQuote" | "codeBlock" | "rule";
  level?: number;
  anchor?: string;
  content?: AnydocInline[];
  list?: AnydocList;
  table?: AnydocTable;
  blocks?: AnydocBlock[];
  lang?: string;
  text?: string;
}

export interface AnydocNote {
  id: string;
  kind: "footnote" | "endnote";
  blocks: AnydocBlock[];
}

export interface AnydocDocument {
  blocks: AnydocBlock[];
  notes: AnydocNote[];
  assets: AnydocAsset[];
}

export interface AnydocPort {
  formatFromBytes(bytes: Uint8Array): string | null;
  formatFromExtension(extension: string): string | null;
  toDocument(bytes: Uint8Array, format?: string | null): Promise<AnydocDocument>;
}

export interface PdfClassification {
  pdfType: string;
  pageCount: number;
  pagesNeedingOcr: number[];
}

export interface PdfProcessResult extends PdfClassification {
  markdown: string | null;
}

export interface ExtractedPdfPage {
  markdown: string;
  page?: number;
  needsOcr?: boolean;
  /** The extractor's machine-readable reason, such as `suspected_garbled_text`, when it knows one. */
  ocrReason?: string;
}

/** A positioned item on a PDF page. Bounds are PDF points with the origin at the page's bottom left. */
export interface PdfPageItem {
  /** 0-based page index. */
  page: number;
  kind: "text" | "link" | "image";
  /** The run's text for text items. */
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The link target for link items. */
  url?: string;
}

/** The OCR text found inside one image of a PDF text page. */
export interface ImageText {
  image: PdfPageItem;
  markdown: string;
}

export interface PdfInspectorPort {
  classify(bytes: Uint8Array): Promise<PdfClassification>;
  process(bytes: Uint8Array): Promise<PdfProcessResult>;
  /** `pages` are 0-based indexes; omit for every page. */
  extractPagesMarkdown(bytes: Uint8Array, pages?: number[]): Promise<ExtractedPdfPage[] | null>;
  /** Positioned text, link, and image items of the given 0-based pages. Absent when the engine cannot report them. */
  pageItems?(bytes: Uint8Array, pages: number[]): Promise<PdfPageItem[]>;
}

export interface ImageNormalizerPort {
  toPng(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface ConvertDeps {
  anydoc: AnydocPort;
  ocr: OcrPort;
  pdf: PdfInspectorPort;
  images: ImageNormalizerPort;
}

export interface ConvertEngine extends ConvertDeps {
  close(): Promise<void>;
}
