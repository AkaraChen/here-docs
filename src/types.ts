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

/** One unit of a manuscript yielded by `convertPages()`. */
export interface ConvertPart {
  /** 1-based page number for paged inputs (PDF); null for inputs converted as a whole. */
  page: number | null;
  /** Page count of the whole document when known; null otherwise. */
  pageCount: number | null;
  /** Markdown for this part, without a trailing newline. May be empty. */
  markdown: string;
  warnings: Warning[];
}

export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "tiff" | "heic" | "avif" | "svg" | "bmp";

export type TextFormat = "plain" | "markdown";

export type MessageFormat = "eml" | "mhtml" | "msg";

export type DetectedKind =
  | { kind: "image"; format: ImageFormat }
  | { kind: "pdf" }
  | { kind: "office"; format: string }
  | { kind: "text"; format: TextFormat }
  | { kind: "html" }
  | { kind: "message"; format: MessageFormat }
  | { kind: "ofd" }
  | { kind: "notebook" }
  | { kind: "unknown" };

export interface OcrLine {
  text: string;
}

export interface OcrPage {
  index: number;
  lines: readonly OcrLine[];
}

export interface OcrPort {
  recognizeEncoded(
    bytes: Uint8Array,
    options?: { signal?: AbortSignal },
  ): Promise<{ lines: readonly OcrLine[] }>;
  recognizeDocument(
    bytes: Uint8Array,
    options?: { pageRange?: { start: number; end: number }; signal?: AbortSignal },
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
}

export interface PdfInspectorPort {
  classify(bytes: Uint8Array): Promise<PdfClassification>;
  process(bytes: Uint8Array): Promise<PdfProcessResult>;
  /** `pages` are 0-based indexes; omit for every page. */
  extractPagesMarkdown(bytes: Uint8Array, pages?: number[]): Promise<ExtractedPdfPage[] | null>;
}

export interface ImageNormalizerPort {
  /** Decodes `page` (0-based, default 0) of the image and encodes it as PNG. */
  toPng(bytes: Uint8Array, page?: number): Promise<Uint8Array>;
  /** Number of pages in a multi-page image (TIFF). Absent or 1 means a single image. */
  pageCount?(bytes: Uint8Array): Promise<number>;
  /** Shrinks an image to within the OCR engine's size limits, as PNG. */
  fitForOcr?(bytes: Uint8Array): Promise<Uint8Array>;
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

/** Converts a file carried inside another one (an e-mail attachment) through the full routing. */
export type NestedConvert = (bytes: Uint8Array, filename: string | undefined) => AsyncGenerator<ConvertPart>;
