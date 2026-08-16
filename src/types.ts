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
}

export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "tiff" | "heic";

export type DetectedKind =
  | { kind: "image"; format: ImageFormat }
  | { kind: "pdf" }
  | { kind: "office"; format: string }
  | { kind: "unknown" };

export interface OcrLine {
  text: string;
}

export interface OcrPage {
  index: number;
  lines: readonly OcrLine[];
}

export interface OcrPort {
  recognizeEncoded(bytes: Uint8Array): Promise<{ lines: readonly OcrLine[] }>;
  recognizeDocument(
    bytes: Uint8Array,
    options?: { pageRange?: { start: number; end: number } },
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
  hasEncodingIssues?: boolean;
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
  extractPagesMarkdown(bytes: Uint8Array): Promise<ExtractedPdfPage[] | null>;
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
