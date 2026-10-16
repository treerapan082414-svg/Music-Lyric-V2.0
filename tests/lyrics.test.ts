import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeSegment,
  defaultStyle,
  exportLrc,
  lyricAnalysis,
  parseLyrics,
  suggestTiming,
  validateProject,
  words,
} from "../src/model";
test("plain Thai lyrics keep section labels and divide lines without splitting Thai marks", () => {
  const lines = parseLyrics(
    "[Verse]\nคืนที่มีเรา\nอยู่ใต้แสงดาว\n[Chorus]\nรักยังอยู่",
    30,
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[2].section, "Chorus");
  assert.equal(lines[0].start, 0);
  assert.equal(lines[0].end, 10);
  assert.equal(lines[2].end, 30);
  assert.ok(lines.every((x) => x.source === "estimated"));
  assert.ok(words("คิดถึงเธอทุกวัน").length > 1);
});
test("LRC supports repeated timestamps and roundtrips milliseconds", () => {
  const lines = parseLyrics(
    "[ar:BK]\n[00:01.234][00:05.678]ร้องอีกครั้ง\n[00:09.000]จบ",
    12,
  );
  assert.deepEqual(
    lines.map((x) => x.start),
    [1.234, 5.678, 9],
  );
  assert.equal(lines[0].end, 5.678);
  assert.equal(activeSegment(lines, 1.234)?.text, "ร้องอีกครั้ง");
  assert.equal(activeSegment(lines, 0), undefined);
  assert.equal(activeSegment(lines, 5.678)?.id, lines[1].id);
  assert.deepEqual(
    parseLyrics(exportLrc(lines), 12).map((x) => x.start),
    lines.map((x) => x.start),
  );
});
test("SRT and VTT retain starts and explicit ends, ignore cue settings", () => {
  const s = parseLyrics(
    "1\n00:00:01,200 --> 00:00:02,500\nคำแรก\nอีกบรรทัด\n\n2\n00:00:03,000 --> 00:00:05,000\nคำถัดไป",
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].start, 1.2);
  assert.equal(s[0].end, 2.5);
  assert.equal(s[0].text, "คำแรก\nอีกบรรทัด");
  const v = parseLyrics(
    "WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<b>Hello</b>",
  );
  assert.equal(v[0].text, "Hello");
  assert.equal(v[0].end, 2);
});
test("analysis identifies overlaps, out-of-range times and repetition", () => {
  const l = parseLyrics("เรา\nเรา", 10);
  l[0].end = 8;
  l[1].end = 12;
  const a = lyricAnalysis(l, 10);
  assert.equal(a.repeated[0][1], 2);
  assert.ok(a.issues.some((x) => x.includes("ซ้อน")));
  assert.ok(a.issues.some((x) => x.includes("เกิน")));
});
test("energy suggestions exclude silent edges but stay explicitly estimated", () => {
  const l = parseLyrics("hello\nhello world", 10);
  const suggested = suggestTiming(l, [0, 0, 1, 1, 1, 1, 1, 1, 0, 0], 10);
  assert.equal(suggested[0].start, 2);
  assert.equal(suggested[1].end, 8);
  assert.equal(suggested[0].end, suggested[1].start);
  assert.ok(suggested.every((x) => x.source === "estimated"));
  assert.throws(() => suggestTiming(l, [0, 0, 0], 10));
});
test("project import rejects invalid timings and styles", () => {
  const p = {
    version: 1,
    name: "test",
    lyrics: parseLyrics("เพลง", 10),
    style: defaultStyle,
    audioName: "",
    duration: 10,
  };
  assert.equal(validateProject(p).name, "test");
  assert.throws(() =>
    validateProject({ ...p, lyrics: [{ ...p.lyrics[0], start: -1 }] }),
  );
  assert.throws(() =>
    validateProject({ ...p, style: { ...defaultStyle, ratio: "bad" } }),
  );
});
