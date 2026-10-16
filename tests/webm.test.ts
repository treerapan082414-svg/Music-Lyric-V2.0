import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeWebm } from "../src/webm";
test("WebM duration insertion preserves streaming clusters byte for byte", async () => {
  const cluster = new Uint8Array([
    0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x81, 0, 0xa3, 0x84, 0x81, 0, 0, 0,
  ]);
  const bytes = new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x80,
    0x18,
    0x53,
    0x80,
    0x67,
    0xff,
    0x15,
    0x49,
    0xa9,
    0x66,
    0x87,
    0x2a,
    0xd7,
    0xb1,
    0x83,
    0x0f,
    0x42,
    0x40,
    ...cluster,
  ]);
  const result = new Uint8Array(
    await (
      await finalizeWebm(new Blob([bytes], { type: "video/webm" }), 4000)
    ).arrayBuffer(),
  );
  assert.deepEqual(result.slice(-cluster.length), cluster);
  assert.equal(result[9], 0xff);
  const index = result.findIndex(
    (v, i) => v === 0x44 && result[i + 1] === 0x89 && result[i + 2] === 0x88,
  );
  assert.ok(index > 0);
  assert.equal(new DataView(result.buffer).getFloat64(index + 3), 4000);
});
test("WebM finalizer rejects invalid containers", async () => {
  await assert.rejects(() => finalizeWebm(new Blob(["not a video"]), 4000));
});
