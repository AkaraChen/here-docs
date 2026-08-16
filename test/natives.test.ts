import assert from "node:assert/strict";
import { test } from "node:test";
import { MissingPlatformPackageError, UnsupportedPlatformError } from "../src/errors.js";
import { assertNativePackages } from "../src/natives.js";
import { hostPlatform } from "../src/platform.js";

test("assertNativePackages throws UnsupportedPlatformError off the supported matrix", () => {
  assert.throws(
    () => assertNativePackages(hostPlatform({ platform: "darwin", arch: "x64" })),
    (error: unknown) =>
      error instanceof UnsupportedPlatformError &&
      error.code === "unsupported-platform" &&
      error.message.includes("pdf-inspector"),
  );
});

test("assertNativePackages throws MissingPlatformPackageError for every unresolved addon", () => {
  const host = hostPlatform({ platform: "linux", arch: "x64", libc: "gnu" });
  const present = new Set(["@img/sharp-linux-x64"]);
  assert.throws(
    () =>
      assertNativePackages(host, (request) => {
        if (present.has(request)) {
          return `/tmp/${request}`;
        }
        throw new Error("not found");
      }),
    (error: unknown) => {
      if (!(error instanceof MissingPlatformPackageError)) {
        return false;
      }
      assert.equal(error.code, "missing-platform-package");
      assert.deepEqual(error.packages, [
        "@arcships/light-ocr-linux-x64-gnu",
        "@firecrawl/anydoc-linux-x64-gnu",
        "@firecrawl/pdf-inspector-linux-x64-gnu",
        "@img/sharp-libvips-linux-x64",
      ]);
      assert.match(error.message, /--omit=optional/);
      return true;
    },
  );
});

test("scoped sharp package names are not treated as already-resolved subpaths", async () => {
  const { assertNativePackages } = await import("../src/natives.js");
  const host = hostPlatform({ platform: "darwin", arch: "arm64" });
  const seen: string[] = [];
  assertNativePackages(host, (request) => {
    seen.push(request);
    return `/resolved/${request}`;
  });
  assert.deepEqual(seen, [
    "@arcships/light-ocr-darwin-arm64",
    "@firecrawl/anydoc-darwin-arm64",
    "@firecrawl/pdf-inspector-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64",
  ]);
});

test("default resolver accepts sharp packages that only export subpaths", () => {
  const host = hostPlatform({ platform: "darwin", arch: "arm64" });
  const resolved = new Map<string, string>([
    ["@arcships/light-ocr-darwin-arm64", "/tmp/light-ocr.node"],
    ["@firecrawl/anydoc-darwin-arm64", "/tmp/anydoc.node"],
    ["@firecrawl/pdf-inspector-darwin-arm64", "/tmp/pdf.node"],
    ["@img/sharp-darwin-arm64/sharp.node", "/tmp/sharp.node"],
    ["@img/sharp-libvips-darwin-arm64/lib", "/tmp/libvips.js"],
  ]);
  const packages = assertNativePackages(host, (request) => {
    const hit =
      resolved.get(request) ??
      resolved.get(`${request}/sharp.node`) ??
      resolved.get(`${request}/lib`);
    if (!hit) {
      throw new Error(request);
    }
    return hit;
  });
  assert.deepEqual(packages, [
    "@arcships/light-ocr-darwin-arm64",
    "@firecrawl/anydoc-darwin-arm64",
    "@firecrawl/pdf-inspector-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64",
  ]);
});

test("assertNativePackages accepts a complete set for each supported host", () => {
  const hosts = [
    hostPlatform({ platform: "darwin", arch: "arm64" }),
    hostPlatform({ platform: "linux", arch: "x64", libc: "gnu" }),
    hostPlatform({ platform: "linux", arch: "arm64", libc: "gnu" }),
    hostPlatform({ platform: "win32", arch: "x64" }),
  ];
  for (const host of hosts) {
    const resolved = assertNativePackages(host, (request) => `/resolved/${request}`);
    assert.ok(resolved.length >= 4, host.id);
    assert.ok(resolved.every((name) => name.includes(host.os) || name.includes("msvc")), host.id);
  }
});
