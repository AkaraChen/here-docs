import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { convert, createEngine } from "../src/index.js";
import { assertNativePackages } from "../src/natives.js";
import { requiredNativePackages } from "../src/platform.js";

function skipOrThrow(t: { skip: (message: string) => void }, error: unknown): void {
  const message = error instanceof Error ? error.message : "native packages unavailable";
  if (process.env.CI) {
    throw error instanceof Error ? error : new Error(message);
  }
  t.skip(message);
}

const png1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

test("resolve hook exposes platform packages to an isolated CJS facade", async (t) => {
  try {
    assertNativePackages();
  } catch (error) {
    skipOrThrow(t, error);
    return;
  }
  const requirement = requiredNativePackages();
  if (!requirement.ok) {
    skipOrThrow(t, new Error(requirement.reason));
    return;
  }
  const isolated = createRequire(join(tmpdir(), "here-docs-isolated-facade", "index.js"));
  for (const name of requirement.packages) {
    const request = name.startsWith("@img/sharp-libvips-")
      ? `${name}/lib`
      : name.startsWith("@img/sharp-")
        ? `${name}/sharp.node`
        : name;
    assert.ok(isolated.resolve(request), request);
  }
});

test("createEngine loads natives and convert does not close the engine early", async (t) => {
  let engine: Awaited<ReturnType<typeof createEngine>>;
  try {
    engine = await createEngine();
  } catch (error) {
    skipOrThrow(t, error);
    return;
  }

  try {
    const result = await convert(png1x1, { filename: "pixel.png", engine });
    assert.equal(typeof result.markdown, "string");
    assert.ok(Array.isArray(result.warnings));
    assert.equal(
      result.warnings.some((warning) => warning.message.includes("Engine is closed")),
      false,
    );
  } finally {
    await engine.close();
  }
});
