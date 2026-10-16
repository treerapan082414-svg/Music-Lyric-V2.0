// Optional real-model smoke test. Start `npm run preview -- --port 4173` first.
// node scripts/check-asr.mjs AUDIO_FILE REFERENCE_TEXT_FILE [thai|english] [small|base|tiny]
import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const [audio, reference, language = "thai", model = "small"] =
  process.argv.slice(2);
if (!audio || !reference)
  throw new Error(
    "Usage: node scripts/check-asr.mjs AUDIO_FILE REFERENCE_TEXT_FILE [LANGUAGE] [MODEL]",
  );
const options = {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
};
if (process.env.HTTPS_PROXY)
  options.proxy = {
    server: process.env.HTTPS_PROXY,
    bypass: "127.0.0.1,localhost",
  };
const context = await chromium.launchPersistentContext(
  "/tmp/bk-asr-smoke-cache",
  options,
);
const page = await context.newPage();
const start = Date.now();
let timer;
try {
  await page.goto(process.env.ASR_TEST_URL || "http://127.0.0.1:4173/");
  await page.locator('.studio[data-ready="true"]').waitFor();
  await page.locator("input[type=file]").nth(0).setInputFiles(audio);
  await page.locator(".modal-backdrop").waitFor({ state: "hidden" });
  await page
    .getByLabel("วางเนื้อเพลง")
    .fill((await readFile(reference, "utf8")).trim());
  await page
    .getByRole("button", { name: "สร้างท่อนร้อง", exact: true })
    .click();
  await page.getByRole("button", { name: "วิเคราะห์", exact: true }).click();
  await page.getByLabel("ภาษาเพลง").selectOption(language);
  await page.getByLabel("โมเดลตรวจคำร้อง").selectOption(model);
  await page
    .getByRole("button", { name: "ฟังเสียงและเทียบคำร้อง", exact: true })
    .click();
  let previous = "";
  timer = setInterval(async () => {
    try {
      const message = await page
        .locator(".sync-progress p[role=status]")
        .textContent();
      if (message !== previous) {
        previous = message;
        console.log(message);
      }
    } catch {}
  }, 5000);
  await page.waitForFunction(
    () =>
      document.querySelector(".alignment-result") ||
      document.querySelector(".message.error"),
    undefined,
    { timeout: 600000 },
  );
  clearInterval(timer);
  if (await page.locator(".message.error").count())
    throw new Error(await page.locator(".message.error").innerText());
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "บันทึกโปรเจกต์", exact: true })
    .click();
  const file = await pending;
  await mkdir("/tmp/bk-artifacts", { recursive: true });
  await file.saveAs("/tmp/bk-artifacts/asr-result.json");
  const data = JSON.parse(
    await readFile("/tmp/bk-artifacts/asr-result.json", "utf8"),
  );
  if (!data.transcript?.words?.length)
    throw new Error("No timestamped words returned");
  const words = data.lyrics.flatMap((s) => s.alignment?.words ?? []);
  console.log(
    JSON.stringify({
      model: data.transcript.model,
      language,
      audioSeconds: data.duration,
      elapsedSeconds: (Date.now() - start) / 1000,
      expectedWords: words.length,
      textExact: words.filter((w) => w.match === "exact").length,
      needsReview: words.filter(
        (w) => w.match === "missing" || w.match === "close" || w.shared,
      ).length,
    }),
  );
  await page.screenshot({
    path: "/tmp/bk-artifacts/asr-result.png",
    fullPage: true,
  });
} finally {
  clearInterval(timer);
  await context.close();
}
