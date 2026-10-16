import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
test.beforeAll(() => {
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-ar",
    "44100",
    "-ac",
    "2",
    "/tmp/bk-test.wav",
  ]);
});
test("observed word timestamps are reviewed, applied, highlighted and restored", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('.studio[data-ready="true"]')).toBeVisible();
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("/tmp/bk-test.wav");
  await expect(page.locator(".audio-upload b")).toHaveText("bk-test.wav");
  await page.getByLabel("วางเนื้อเพลง").fill("ฉัน รัก เธอ\nเธอ รัก ฉัน");
  await page.getByRole("button", { name: "สร้างท่อนร้อง" }).click();
  await page
    .getByRole("button", { name: "ตรวจคำที่ร้องให้ตรงเนื้อเพลง" })
    .click();
  const words = [
    { word: "ฉัน", start: 0.1, end: 0.3 },
    { word: "รัก", start: 0.5, end: 0.7 },
    { word: "เธอ", start: 0.9, end: 1.3 },
    { word: "เธอ", start: 2, end: 2.2 },
    { word: "รัก", start: 2.5, end: 2.7 },
    { word: "ฉัน", start: 3, end: 3.5 },
  ];
  await page.locator('.sync-panel input[accept=".json"]').setInputFiles({
    name: "actual-transcript-format.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ segments: [{ words }] })),
  });
  await expect(page.locator(".alignment-result")).toHaveCount(2);
  await expect(page.locator(".match-stats")).toContainText("6/6");
  const pinkTextPixels = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 350, canvas.width, 80).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] > 210 &&
            pixels[i + 1] < 100 &&
            pixels[i + 2] > 80 &&
            pixels[i + 2] < 180
          )
            count++;
        return count;
      });
  expect(await pinkTextPixels()).toBe(0);
  // Recognition proposals are not applied silently.
  await page.locator(".alignment-result").first().click();
  await expect(page.getByLabel("เวลาเริ่ม", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("เวลาเริ่มคำ", { exact: true })).toHaveValue(
    "0.1",
  );
  await page.getByLabel("เวลาจบคำ", { exact: true }).fill("0.4");
  await page
    .getByRole("button", { name: "ใช้เวลารายคำกับท่อนนี้", exact: true })
    .click();
  await expect(page.getByLabel("เวลาเริ่ม", { exact: true })).toHaveValue(
    "0.1",
  );
  await expect(page.getByLabel("เวลาจบ", { exact: true })).toHaveValue("1.3");
  await expect.poll(pinkTextPixels).toBeGreaterThan(10);
  await page.getByRole("button", { name: /ใช้เวลาท่อนที่ตรงชัดเจน/ }).click();
  await page
    .getByRole("button", { name: "ฟังเฉพาะคำนี้", exact: true })
    .click();
  await page.waitForTimeout(900);
  await expect(
    page.getByRole("button", { name: "เล่นเพลง", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator(".save-state")).toContainText(
    "บันทึกในเครื่องแล้ว",
  );
  await page.reload();
  await expect(page.locator('.studio[data-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "วิเคราะห์", exact: true }).click();
  await expect(page.locator(".alignment-result")).toHaveCount(2);
  await expect(page.locator(".alignment-result").first()).toContainText(
    "ใช้เวลาแล้ว",
  );
  await page.locator(".alignment-result").first().click();
  await expect(page.getByLabel("เวลาจบคำ", { exact: true })).toHaveValue("0.4");
  await page.screenshot({
    path: "/tmp/bk-artifacts/word-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "ส่งออกวิดีโอ", exact: true }).click();
  await expect(page.getByText("วิดีโอพร้อมแล้ว", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "กลับไปแก้ไข" }).click();
  // Replacing the text invalidates old word spans instead of highlighting stale text.
  await page.getByLabel("แก้ไขท่อนร้อง").fill("เนื้อเพลงใหม่");
  await expect(
    page.getByText("ตรวจคำที่ร้องและเวลารายคำ", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "จับเวลารายคำด้วยตนเอง", exact: true }),
  ).toBeVisible();
});
test("unmatched words have no generated times and block applying the line", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('.studio[data-ready="true"]')).toBeVisible();
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("/tmp/bk-test.wav");
  await expect(page.locator(".audio-upload b")).toHaveText("bk-test.wav");
  await page.getByLabel("วางเนื้อเพลง").fill("hello extraordinary universe");
  await page.getByRole("button", { name: "สร้างท่อนร้อง" }).click();
  await page
    .getByRole("button", { name: "ตรวจคำที่ร้องให้ตรงเนื้อเพลง" })
    .click();
  await page.locator('.sync-panel input[accept=".json"]').setInputFiles({
    name: "incomplete.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ words: [{ text: "hello", start: 1, end: 1.5 }] }),
    ),
  });
  await expect(page.locator(".alignment-result")).toHaveCount(1);
  await page.locator(".alignment-result").click();
  await page.locator(".word-editor .word-chip").nth(1).click();
  await expect(page.getByLabel("เวลาเริ่มคำ", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("เวลาจบคำ", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "ใช้เวลารายคำกับท่อนนี้", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".word-comparison")).toContainText("หาไม่พบ");
});
