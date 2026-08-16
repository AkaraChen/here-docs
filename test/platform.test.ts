import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ENGINE_VERSIONS,
  OFFICIAL_OPTIONAL_DEPENDENCIES,
  hostPlatform,
  isNativePlatformRequest,
  requiredNativePackages,
} from "../src/platform.js";

test("every supported host requires addons from all four engines", () => {
  const hosts = [
    hostPlatform({ platform: "darwin", arch: "arm64" }),
    hostPlatform({ platform: "linux", arch: "x64", libc: "gnu" }),
    hostPlatform({ platform: "linux", arch: "arm64", libc: "gnu" }),
    hostPlatform({ platform: "win32", arch: "x64" }),
  ];

  for (const host of hosts) {
    const requirement = requiredNativePackages(host);
    assert.equal(requirement.ok, true, host.id);
    if (!requirement.ok) {
      continue;
    }
    const names = requirement.packages.join("\n");
    assert.match(names, /@arcships\/light-ocr-/);
    assert.match(names, /@firecrawl\/anydoc-/);
    assert.match(names, /@firecrawl\/pdf-inspector-/);
    assert.match(names, /@img\/sharp-/);
  }
});

test("linux host ids include libc so gnu and musl are not confused", () => {
  assert.equal(hostPlatform({ platform: "linux", arch: "x64", libc: "gnu" }).id, "linux-x64-gnu");
  assert.equal(hostPlatform({ platform: "linux", arch: "x64", libc: "musl" }).id, "linux-x64-musl");
  assert.equal(hostPlatform({ platform: "linux", arch: "arm64", libc: "musl" }).id, "linux-arm64-musl");
});

test("unsupported hosts fail closed with the upstream gap named", () => {
  const cases = [
    {
      host: hostPlatform({ platform: "darwin", arch: "x64" }),
      fragment: "pdf-inspector",
    },
    {
      host: hostPlatform({ platform: "linux", arch: "x64", libc: "musl" }),
      fragment: "light-ocr",
    },
    {
      host: hostPlatform({ platform: "linux", arch: "arm64", libc: "musl" }),
      fragment: "light-ocr",
    },
    {
      host: hostPlatform({ platform: "win32", arch: "arm64" }),
      fragment: "win32-arm64",
    },
    {
      host: hostPlatform({ platform: "freebsd", arch: "x64" }),
      fragment: "supported hosts",
    },
  ];

  for (const { host, fragment } of cases) {
    const requirement = requiredNativePackages(host);
    assert.equal(requirement.ok, false, host.id);
    if (requirement.ok) {
      continue;
    }
    assert.match(requirement.reason, new RegExp(fragment));
  }
});

test("linux libc probe prefers glibc report over ldd", () => {
  const host = hostPlatform({
    platform: "linux",
    arch: "x64",
    report: { header: { glibcVersionRuntime: "2.39" }, sharedObjects: ["libc.musl-x86_64.so.1"] },
    ldd: "musl libc",
  });
  assert.equal(host.id, "linux-x64-gnu");
});

test("linux libc probe treats musl shared objects as musl", () => {
  const host = hostPlatform({
    platform: "linux",
    arch: "arm64",
    report: { sharedObjects: ["/lib/ld-musl-aarch64.so.1"] },
  });
  assert.equal(host.id, "linux-arm64-musl");
});

test("native resolve hook matches every official platform package name", () => {
  for (const name of Object.keys(OFFICIAL_OPTIONAL_DEPENDENCIES)) {
    assert.equal(isNativePlatformRequest(name), true, name);
    assert.equal(isNativePlatformRequest(`${name}/sharp.node`), true, `${name} subpath`);
  }
  assert.equal(isNativePlatformRequest("@arcships/light-ocr"), false);
  assert.equal(isNativePlatformRequest("@firecrawl/anydoc"), false);
  assert.equal(isNativePlatformRequest("sharp"), false);
});

test("package.json optionalDependencies stay locked to the official catalog", async () => {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
  };

  assert.equal(pkg.dependencies["@arcships/light-ocr"], ENGINE_VERSIONS.lightOcr);
  assert.equal(pkg.dependencies["@firecrawl/anydoc"], ENGINE_VERSIONS.anydoc);
  assert.equal(pkg.dependencies["@firecrawl/pdf-inspector"], ENGINE_VERSIONS.pdfInspector);
  assert.equal(pkg.dependencies.sharp, ENGINE_VERSIONS.sharp);
  assert.deepEqual(pkg.optionalDependencies, OFFICIAL_OPTIONAL_DEPENDENCIES);
});
