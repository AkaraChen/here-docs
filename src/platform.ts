import { readFileSync } from "node:fs";

export const ENGINE_VERSIONS = {
  lightOcr: "0.5.7",
  anydoc: "0.1.9",
  pdfInspector: "1.14.2",
  sharp: "0.34.5",
  sharpLibvips: "1.2.4",
} as const;

/** Every official optional platform package the four engines publish, pinned to ENGINE_VERSIONS. */
export const OFFICIAL_OPTIONAL_DEPENDENCIES: Record<string, string> = {
  "@arcships/light-ocr-darwin-arm64": ENGINE_VERSIONS.lightOcr,
  "@arcships/light-ocr-darwin-x64": ENGINE_VERSIONS.lightOcr,
  "@arcships/light-ocr-linux-arm64-gnu": ENGINE_VERSIONS.lightOcr,
  "@arcships/light-ocr-linux-x64-gnu": ENGINE_VERSIONS.lightOcr,
  "@arcships/light-ocr-win32-arm64": ENGINE_VERSIONS.lightOcr,
  "@arcships/light-ocr-win32-x64": ENGINE_VERSIONS.lightOcr,
  "@firecrawl/anydoc-darwin-arm64": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-darwin-x64": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-linux-arm64-gnu": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-linux-arm64-musl": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-linux-x64-gnu": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-linux-x64-musl": ENGINE_VERSIONS.anydoc,
  "@firecrawl/anydoc-win32-x64-msvc": ENGINE_VERSIONS.anydoc,
  "@firecrawl/pdf-inspector-darwin-arm64": ENGINE_VERSIONS.pdfInspector,
  "@firecrawl/pdf-inspector-linux-arm64-gnu": ENGINE_VERSIONS.pdfInspector,
  "@firecrawl/pdf-inspector-linux-arm64-musl": ENGINE_VERSIONS.pdfInspector,
  "@firecrawl/pdf-inspector-linux-x64-gnu": ENGINE_VERSIONS.pdfInspector,
  "@firecrawl/pdf-inspector-linux-x64-musl": ENGINE_VERSIONS.pdfInspector,
  "@firecrawl/pdf-inspector-win32-x64-msvc": ENGINE_VERSIONS.pdfInspector,
  "@img/sharp-darwin-arm64": ENGINE_VERSIONS.sharp,
  "@img/sharp-darwin-x64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-arm": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-arm64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-ppc64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-riscv64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-s390x": ENGINE_VERSIONS.sharp,
  "@img/sharp-linux-x64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linuxmusl-arm64": ENGINE_VERSIONS.sharp,
  "@img/sharp-linuxmusl-x64": ENGINE_VERSIONS.sharp,
  "@img/sharp-wasm32": ENGINE_VERSIONS.sharp,
  "@img/sharp-win32-arm64": ENGINE_VERSIONS.sharp,
  "@img/sharp-win32-ia32": ENGINE_VERSIONS.sharp,
  "@img/sharp-win32-x64": ENGINE_VERSIONS.sharp,
  "@img/sharp-libvips-darwin-arm64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-darwin-x64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-arm": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-arm64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-ppc64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-riscv64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-s390x": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linux-x64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linuxmusl-arm64": ENGINE_VERSIONS.sharpLibvips,
  "@img/sharp-libvips-linuxmusl-x64": ENGINE_VERSIONS.sharpLibvips,
};

export const SUPPORTED_HOST_IDS = [
  "darwin-arm64",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "win32-x64",
] as const;

export type SupportedHostId = (typeof SUPPORTED_HOST_IDS)[number];

export type HostLibc = "gnu" | "musl";

export interface HostPlatform {
  os: string;
  arch: string;
  libc?: HostLibc;
  id: string;
}

export interface NativeRequirement {
  ok: true;
  host: HostPlatform;
  packages: readonly string[];
}

export interface UnsupportedNativeRequirement {
  ok: false;
  host: HostPlatform;
  reason: string;
}

const REQUIRED_BY_HOST: Record<SupportedHostId, readonly string[]> = {
  "darwin-arm64": [
    "@arcships/light-ocr-darwin-arm64",
    "@firecrawl/anydoc-darwin-arm64",
    "@firecrawl/pdf-inspector-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64",
  ],
  "linux-arm64-gnu": [
    "@arcships/light-ocr-linux-arm64-gnu",
    "@firecrawl/anydoc-linux-arm64-gnu",
    "@firecrawl/pdf-inspector-linux-arm64-gnu",
    "@img/sharp-linux-arm64",
    "@img/sharp-libvips-linux-arm64",
  ],
  "linux-x64-gnu": [
    "@arcships/light-ocr-linux-x64-gnu",
    "@firecrawl/anydoc-linux-x64-gnu",
    "@firecrawl/pdf-inspector-linux-x64-gnu",
    "@img/sharp-linux-x64",
    "@img/sharp-libvips-linux-x64",
  ],
  "win32-x64": [
    "@arcships/light-ocr-win32-x64",
    "@firecrawl/anydoc-win32-x64-msvc",
    "@firecrawl/pdf-inspector-win32-x64-msvc",
    "@img/sharp-win32-x64",
  ],
};

const UPSTREAM_GAPS: Record<string, string> = {
  "darwin-x64": "@firecrawl/pdf-inspector does not publish a darwin-x64 binary",
  "linux-arm64-musl": "@arcships/light-ocr does not publish a musl Linux binary",
  "linux-x64-musl": "@arcships/light-ocr does not publish a musl Linux binary",
  "win32-arm64":
    "@firecrawl/anydoc and @firecrawl/pdf-inspector do not publish win32-arm64 binaries",
};

export interface HostProbe {
  platform?: string;
  arch?: string;
  libc?: HostLibc;
  report?: { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] };
  ldd?: string | null;
}

export function hostPlatform(probe: HostProbe = {}): HostPlatform {
  const os = probe.platform ?? process.platform;
  const arch = probe.arch ?? process.arch;
  const libc = os === "linux" ? (probe.libc ?? detectLinuxLibc(probe)) : undefined;
  const id = os === "linux" ? `${os}-${arch}-${libc}` : `${os}-${arch}`;
  return { os, arch, libc, id };
}

export function requiredNativePackages(
  host: HostPlatform = hostPlatform(),
): NativeRequirement | UnsupportedNativeRequirement {
  if (isSupportedHostId(host.id)) {
    return { ok: true, host, packages: REQUIRED_BY_HOST[host.id] };
  }
  return {
    ok: false,
    host,
    reason:
      UPSTREAM_GAPS[host.id] ??
      `supported hosts are ${SUPPORTED_HOST_IDS.join(", ")}`,
  };
}

export function isNativePlatformRequest(request: string): boolean {
  return (
    request.startsWith("@arcships/light-ocr-") ||
    request.startsWith("@firecrawl/anydoc-") ||
    request.startsWith("@firecrawl/pdf-inspector-") ||
    request.startsWith("@img/sharp-")
  );
}

function isSupportedHostId(id: string): id is SupportedHostId {
  return (SUPPORTED_HOST_IDS as readonly string[]).includes(id);
}

function detectLinuxLibc(probe: HostProbe): HostLibc {
  const report = probe.report ?? readProcessReport();
  if (report?.header?.glibcVersionRuntime) {
    return "gnu";
  }
  if (report?.sharedObjects?.some((entry) => entry.includes("musl"))) {
    return "musl";
  }
  if (probe.ldd !== undefined) {
    return probe.ldd?.includes("musl") ? "musl" : "gnu";
  }
  return readLdd() ?? "gnu";
}

function readProcessReport(): HostProbe["report"] {
  try {
    const report = process.report?.getReport?.();
    if (report && typeof report === "object") {
      return report as HostProbe["report"];
    }
  } catch {
    // getReport can throw in restricted environments
  }
  return undefined;
}

function readLdd(): HostLibc | undefined {
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl") ? "musl" : "gnu";
  } catch {
    return undefined;
  }
}
