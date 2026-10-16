import { mkdir, copyFile } from "node:fs/promises";
const target = new URL("../public/onnx/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
])
  await copyFile(
    new URL(`../node_modules/onnxruntime-web/dist/${name}`, import.meta.url),
    new URL(name, target),
  );
