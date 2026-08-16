import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { dirname, join } from "node:path";
import { MissingPlatformPackageError, UnsupportedPlatformError } from "./errors.js";
import {
  hostPlatform,
  isNativePlatformRequest,
  requiredNativePackages,
  type HostPlatform,
} from "./platform.js";

export type PackageResolver = (request: string) => string;

const hereRequire = createRequire(new URL("../package.json", import.meta.url));

type ResolveFilename = (
  request: string,
  parent: NodeModule | null,
  isMain: boolean,
  options?: { paths?: string[] },
) => string;

let resolveHookInstalled = false;

export function assertNativePackages(
  host: HostPlatform = hostPlatform(),
  resolve: PackageResolver = defaultResolve,
): readonly string[] {
  const requirement = requiredNativePackages(host);
  if (!requirement.ok) {
    throw new UnsupportedPlatformError(requirement.host.id, requirement.reason);
  }

  const missing: string[] = [];
  const resolved = new Map<string, string>();
  for (const name of requirement.packages) {
    try {
      resolved.set(name, resolve(name));
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new MissingPlatformPackageError(missing, requirement.host.id);
  }

  installNativeResolveHook();
  pointLightOcrAtResolved(resolved);
  return requirement.packages;
}

export function installNativeResolveHook(): void {
  if (resolveHookInstalled) {
    return;
  }
  resolveHookInstalled = true;

  const proto = Module as unknown as { _resolveFilename: ResolveFilename };
  const original = proto._resolveFilename.bind(Module);
  proto._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && isNativePlatformRequest(request)) {
      try {
        return hereRequire.resolve(request);
      } catch {
        // Fall through so the facade surfaces its own MODULE_NOT_FOUND.
      }
    }
    return original(request, parent, isMain, options);
  };
}

function defaultResolve(request: string): string {
  let lastError: unknown;
  for (const candidate of resolveCandidates(request)) {
    try {
      return hereRequire.resolve(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to resolve ${request}`);
}

function resolveCandidates(request: string): string[] {
  if (hasPackageSubpath(request)) {
    return [request];
  }
  if (request.startsWith("@img/sharp-libvips-")) {
    return [`${request}/lib`, `${request}/package`, request];
  }
  if (request.startsWith("@img/sharp-")) {
    return [`${request}/sharp.node`, `${request}/package`, request];
  }
  return [request];
}

function hasPackageSubpath(request: string): boolean {
  const parts = request.split("/");
  return request.startsWith("@") ? parts.length > 2 : parts.length > 1;
}

function pointLightOcrAtResolved(resolved: Map<string, string>): void {
  for (const [name, filename] of resolved) {
    if (!name.startsWith("@arcships/light-ocr-") || !existsSync(filename)) {
      continue;
    }
    process.env.LIGHT_OCR_NODE_BINARY = filename;
    process.env.LIGHT_OCR_RUNTIME_DESCRIPTOR = join(dirname(filename), "runtime-descriptor.json");
    return;
  }
}
