import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "/tmp/bk-test.wav",
    "/tmp/bk-test.mp3",
  ]);
  mkdirSync("/tmp/bk-artifacts", { recursive: true });
});
test("upload, timeline, editing, save/reload, and two real audiovisual exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("กำลังเปิดสตูดิโอ…")).toHaveCount(0);
  for (const ext of ["mp3", "wav"]) {
    await page
      .locator("input[type=file]")
      .nth(0)
      .setInputFiles(`/tmp/bk-test.${ext}`);
    await expect(page.locator(".audio-upload b")).toHaveText(`bk-test.${ext}`);
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    await page.getByRole("button", { name: "เล่นเพลง", exact: true }).click();
    await page.waitForTimeout(350);
    expect(
      await page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    ).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "หยุดชั่วคราว", exact: true })
      .click();
  }
  await page
    .getByLabel("วางเนื้อเพลง")
    .fill("[Verse]\nทดสอบคำร้องภาษาไทย\nอีกบรรทัดที่มีความหมาย");
  await page.getByRole("button", { name: "สร้างท่อนร้อง" }).click();
  await expect(page.locator(".segment")).toHaveCount(2);
  await expect(page.locator(".clip")).toHaveCount(2);
  await page.getByRole("button", { name: "วิเคราะห์", exact: true }).click();
  await expect(page.locator(".stat-grid b").first()).toHaveText("2");
  await page.getByRole("button", { name: "วิเคราะห์เสียงและเสนอเวลา" }).click();
  await expect(page.getByRole("status")).toContainText("เวลาประมาณ");
  await page.getByRole("button", { name: "เนื้อเพลง", exact: true }).click();
  await page.locator(".segment").first().click();
  await page.getByLabel("แก้ไขท่อนร้อง").fill("คิดถึงเธอทุกวัน");
  await expect(page.locator(".segment p").first()).toHaveText(
    "คิดถึงเธอทุกวัน",
  );
  await page.getByRole("button", { name: "เลิกทำ", exact: true }).click();
  await expect(page.locator(".segment p").first()).toHaveText(
    "ทดสอบคำร้องภาษาไทย",
  );
  await page.getByRole("button", { name: "ทำซ้ำ", exact: true }).click();
  await expect(page.locator(".segment p").first()).toHaveText(
    "คิดถึงเธอทุกวัน",
  );
  const clip = page.locator(".clip").first();
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + 15, { steps: 3 });
  await page.mouse.up();
  expect(
    Number(await page.getByLabel("เวลาเริ่ม", { exact: true }).inputValue()),
  ).toBeGreaterThan(0);
  await page.getByLabel("เวลาเริ่ม", { exact: true }).fill("0");
  await page.getByLabel("เวลาจบ", { exact: true }).fill("2");
  await page.locator(".segment").nth(1).click();
  await page.getByLabel("เวลาเริ่ม", { exact: true }).fill("2");
  await page.getByLabel("เวลาจบ", { exact: true }).fill("4");
  await page.getByRole("button", { name: "ตกแต่ง", exact: true }).click();
  await page.getByLabel("ขนาดข้อความ", { exact: true }).fill("60");
  await page.getByLabel("สีข้อความ", { exact: true }).fill("#ffddee");
  await page.getByLabel("ชื่อโปรเจกต์").fill("BK browser test");
  await expect(page.locator(".save-state")).toContainText(
    "บันทึกในเครื่องแล้ว",
  );
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByLabel("ชื่อโปรเจกต์")).toHaveValue("BK browser test");
  await expect(page.locator(".audio-upload b")).toHaveText("bk-test.wav");
  await expect(page.locator(".segment")).toHaveCount(2);
  await page.getByRole("button", { name: "เล่นเพลง", exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
  for (const ratio of ["16:9", "9:16"]) {
    await page.getByLabel("สัดส่วนวิดีโอ").selectOption(ratio);
    await page
      .getByRole("button", { name: "ส่งออกวิดีโอ", exact: true })
      .click();
    await expect(
      page.getByText("วิดีโอพร้อมแล้ว", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const dl = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "ดาวน์โหลดวิดีโอ", exact: true })
      .click();
    const file = await dl;
    const path = `/tmp/bk-artifacts/export-${ratio.replace(":", "x")}.webm`;
    await file.saveAs(path);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8" },
      ),
    );
    expect(
      probe.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ),
    ).toBeTruthy();
    const video = probe.streams.find(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
    expect(video.width / video.height).toBeCloseTo(
      ratio === "16:9" ? 16 / 9 : 9 / 16,
      2,
    );
    expect(Number(probe.format.duration)).toBeGreaterThan(3.8);
    expect(Number(probe.format.duration)).toBeLessThan(4.6);
    const decoded = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    expect(decoded.status).toBe(0);
    expect(decoded.stderr).toMatch(/mean_volume: -[0-9.]+ dB/);
    expect(decoded.stderr).not.toContain("Unknown-sized");
    await page.getByRole("button", { name: "กลับไปแก้ไข" }).click();
  }
  await page.screenshot({
    path: "/tmp/bk-artifacts/studio-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/bk-artifacts/studio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("LRC import and unsupported encoder error are real", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("กำลังเปิดสตูดิโอ…")).toHaveCount(0);
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("/tmp/bk-test.wav");
  await expect(page.locator(".audio-upload b")).toHaveText("bk-test.wav");
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "song.lrc",
      mimeType: "text/plain",
      buffer: Buffer.from("[00:00.500]hello\n[00:02.000]world"),
    });
  await expect(page.locator(".segment")).toHaveCount(2);
  await page.getByRole("button", { name: "เล่นเพลง", exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.locator(".segment.singing p")).toHaveText("hello");
  await page.getByRole("button", { name: "หยุดชั่วคราว", exact: true }).click();
  await page.evaluate(() => {
    MediaRecorder.isTypeSupported = () => false;
  });
  await page.getByRole("button", { name: "ส่งออกวิดีโอ", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ไม่รองรับ");
  await expect(page.getByText("วิดีโอพร้อมแล้ว", { exact: true })).toHaveCount(
    0,
  );
});
test("manual IN/OUT, tap timing, JSON roundtrip and cancel export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("กำลังเปิดสตูดิโอ…")).toHaveCount(0);
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles("/tmp/bk-test.wav");
  await expect(page.locator(".audio-upload b")).toHaveText("bk-test.wav");
  await page.getByLabel("วางเนื้อเพลง").fill("ร้องท่อนแรก\nร้องท่อนสอง");
  await page.getByRole("button", { name: "สร้างท่อนร้อง" }).click();
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 0.5;
  });
  await page.locator("body").press("i");
  await expect(page.getByLabel("เวลาเริ่ม", { exact: true })).toHaveValue(
    "0.5",
  );
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 1.8;
  });
  await page.locator("body").press("o");
  await expect(page.getByLabel("แก้ไขท่อนร้อง")).toHaveValue("ร้องท่อนสอง");
  await page.getByRole("button", { name: "เปิดโหมดจับเวลาทีละท่อน" }).click();
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 2.2;
  });
  await page.locator("body").press("Space");
  await expect(page.getByLabel("เวลาเริ่ม", { exact: true })).toHaveValue(
    "2.2",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "บันทึกโปรเจกต์", exact: true })
    .click();
  const file = await pending;
  await file.saveAs("/tmp/bk-artifacts/project.bk.json");
  await page.getByRole("button", { name: "ส่งออกวิดีโอ", exact: true }).click();
  await expect(page.getByText("กำลังสร้างวิดีโอของคุณ")).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิกการส่งออก" }).click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("ยกเลิก");
  await page
    .locator("input[type=file]")
    .nth(2)
    .setInputFiles("/tmp/bk-artifacts/project.bk.json");
  await expect(page.getByRole("status")).toContainText("แนบไฟล์เพลงเดิม");
  await expect(page.locator(".segment")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "เล่นเพลง", exact: true }),
  ).toBeDisabled();
});
