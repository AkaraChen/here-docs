import assert from "node:assert/strict";
import { test } from "node:test";

test("native engines are importable when platform packages are present", async (t) => {
  try {
    await import("@firecrawl/anydoc");
    await import("@firecrawl/pdf-inspector");
    await import("@arcships/light-ocr");
    await import("sharp");
  } catch (error) {
    t.skip(error instanceof Error ? error.message : "native packages unavailable");
    return;
  }
  assert.ok(true);
});
