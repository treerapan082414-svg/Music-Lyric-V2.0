import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignLyrics,
  applyAlignment,
  lineCanApply,
  measuredChunks,
  normalize,
  parseTranscript,
  shiftSegment,
  splitWords,
  type Transcript,
} from "../src/alignment";
import { parseLyrics, validateProject, defaultStyle } from "../src/model";
const transcript = (words: Transcript["words"]): Transcript => ({
  model: "test observed word timestamps",
  language: "thai",
  text: words.map((w) => w.text).join(""),
  words,
});
test("matches Thai without relying on spaces and preserves observed uneven timestamps", () => {
  const lyrics = parseLyrics("ฉัน รัก เธอ\nเธอ รัก ฉัน", 20);
  const t = transcript([
    { text: "ฉัน", start: 2, end: 2.3 },
    { text: "รัก", start: 3.1, end: 3.5 },
    { text: "เธอ", start: 4.2, end: 6 },
    { text: "เธอ", start: 10, end: 10.2 },
    { text: "รัก", start: 12, end: 12.7 },
    { text: "ฉัน", start: 14, end: 15 },
  ]);
  const aligned = alignLyrics(lyrics, t);
  assert.deepEqual(
    aligned[0].alignment!.words.map((w) => w.start),
    [2, 3.1, 4.2],
  );
  assert.equal(aligned[1].alignment!.words[0].start, 10);
  assert.equal(aligned[0].text, lyrics[0].text);
  assert.ok(
    aligned.every((s) => s.alignment!.words.every((w) => w.match === "exact")),
  );
  const applied = applyAlignment(aligned[0]);
  assert.equal(applied.start, 2);
  assert.equal(applied.end, 6);
  assert.equal(applied.source, "recognized");
  assert.equal(applied.alignment?.status, "applied");
});
test("unheard lyric words remain untimed and cannot be applied as a complete line", () => {
  const aligned = alignLyrics(
    parseLyrics("hello extraordinary universe", 10),
    transcript([{ text: "hello", start: 1, end: 1.5 }]),
  );
  assert.ok(
    aligned[0]
      .alignment!.words.slice(1)
      .every(
        (w) => w.start === null && w.end === null && w.match === "missing",
      ),
  );
  assert.equal(lineCanApply(aligned[0].alignment!), false);
  assert.throws(() => applyAlignment(aligned[0]));
});
test("different Thai token boundaries expose shared timing without fake interpolation", () => {
  const aligned = alignLyrics(
    parseLyrics("ฉัน รัก เธอ", 10),
    transcript([{ text: "ฉันรักเธอ", start: 2, end: 5 }]),
  );
  assert.ok(aligned[0].alignment!.words.every((w) => w.shared));
  assert.deepEqual(
    aligned[0].alignment!.words.map((w) => [w.start, w.end]),
    [
      [2, 5],
      [2, 5],
      [2, 5],
    ],
  );
});
test("repeated choruses map monotonically rather than reusing first occurrence", () => {
  const aligned = alignLyrics(
    parseLyrics("hello world\ngoodbye moon\nhello world", 30),
    transcript([
      { text: "hello", start: 1, end: 2 },
      { text: "world", start: 3, end: 4 },
      { text: "goodbye", start: 10, end: 11 },
      { text: "moon", start: 12, end: 13 },
      { text: "hello", start: 20, end: 21 },
      { text: "world", start: 22, end: 23 },
    ]),
  );
  assert.equal(aligned[0].alignment!.words[0].start, 1);
  assert.equal(aligned[2].alignment!.words[0].start, 20);
});
test("silences do not get stretched into lyrics and unrelated text is flagged", () => {
  const aligned = alignLyrics(
    parseLyrics("hello world", 40),
    transcript([
      { text: "hello", start: 2, end: 3 },
      { text: "world", start: 30, end: 31 },
    ]),
  );
  assert.ok(aligned[0].alignment?.warning);
  assert.equal(lineCanApply(aligned[0].alignment!), false);
  const wrong = alignLyrics(
    parseLyrics("แมว", 5),
    transcript([{ text: "dog", start: 1, end: 2 }]),
  );
  assert.equal(wrong[0].alignment!.words[0].match, "missing");
  assert.equal(wrong[0].alignment!.words[0].start, null);
});
test("timestamp import accepts Whisper formats but rejects invalid and shuffled times", () => {
  assert.deepEqual(
    parseTranscript(
      { segments: [{ words: [{ word: " hello", start: 1, end: 2 }] }] },
      5,
    ),
    [{ text: " hello", start: 1, end: 2 }],
  );
  assert.equal(
    parseTranscript({ chunks: [{ text: "hello", timestamp: [1, 2] }] }, 5)
      .length,
    1,
  );
  assert.throws(() =>
    parseTranscript({ words: [{ text: "bad", start: 2, end: 1 }] }, 5),
  );
  assert.throws(() =>
    parseTranscript({ words: [{ text: "bad", start: 1, end: 10 }] }, 5),
  );
  assert.throws(() =>
    parseTranscript(
      {
        words: [
          { text: "b", start: 2, end: 3 },
          { text: "a", start: 0, end: 1 },
        ],
      },
      5,
    ),
  );
});
test("word timestamps survive project JSON and offsets, tampered spans are rejected", () => {
  const [s] = alignLyrics(
    parseLyrics("hello", 10),
    transcript([{ text: "hello", start: 2, end: 3 }]),
  );
  const applied = applyAlignment(s);
  const shifted = shiftSegment(applied, 1.5);
  assert.equal(shifted.alignment!.words[0].start, 3.5);
  const p = {
    version: 1,
    name: "test",
    style: defaultStyle,
    lyrics: [shifted],
    audioName: "song",
    duration: 10,
  };
  assert.equal(
    validateProject(JSON.parse(JSON.stringify(p))).lyrics[0].alignment!.words[0]
      .end,
    4.5,
  );
  assert.throws(() =>
    validateProject({
      ...p,
      lyrics: [
        {
          ...shifted,
          alignment: {
            ...shifted.alignment,
            words: [{ ...shifted.alignment!.words[0], from: 999 }],
          },
        },
      ],
    }),
  );
});
test("Thai combining marks remain significant in text matching", () => {
  assert.notEqual(normalize("ป่า"), normalize("ปา"));
  assert.equal(normalize(" HELLO! "), "hello");
  for (const w of splitWords("คิดถึงเธอทุกวัน")) assert.ok(w.to > w.from);
});
test("zero-duration Thai vowels and tone marks are retained with coarse timing", () => {
  const w = measuredChunks(
    [
      { text: "ค", timestamp: [1, 1.2] },
      { text: "ุ", timestamp: [1.2, 1.2] },
      { text: "ณ", timestamp: [1.2, 1.4] },
    ],
    0,
    3,
  );
  assert.equal(w.map((x) => x.text).join(""), "คุณ");
  assert.equal(w[0].coarse, true);
  assert.equal(w[0].end, 1.2);
  const a = alignLyrics(parseLyrics("คุณ", 3), transcript(w));
  assert.equal(a[0].alignment!.words[0].match, "exact");
  assert.equal(a[0].alignment!.words[0].shared, true);
});
