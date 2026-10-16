import type { Segment } from "./model";

export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
  coarse?: boolean;
};
export type AlignedWord = {
  text: string;
  from: number;
  to: number;
  heard: string;
  start: number | null;
  end: number | null;
  match: "exact" | "close" | "missing" | "manual";
  similarity: number;
  shared: boolean;
};
export type LineAlignment = {
  model: string;
  language: string;
  words: AlignedWord[];
  status: "proposed" | "applied";
  warning?: string;
};
export type Transcript = {
  model: string;
  language: string;
  text: string;
  words: TranscriptWord[];
  audioFingerprint?: string;
};
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}
export function splitWords(text: string) {
  return [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)]
    .filter((x) => x.isWordLike)
    .map((x) => ({
      text: x.segment,
      from: x.index,
      to: x.index + x.segment.length,
    }));
}
/** Whisper may give Thai combining marks a zero-duration token. Preserve those
 * characters by grouping with an adjacent measured interval, explicitly coarse.
 * Do not manufacture a duration or drop the vowel/tone mark from the text. */
export function measuredChunks(
  chunks: { text: string; timestamp: [number | null, number | null] }[],
  offset: number,
  duration: number,
): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let pending = "";
  let pendingTime: number | null = null;
  for (const c of chunks) {
    const [a, b] = c.timestamp;
    if (
      a === null ||
      b === null ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      b < a
    )
      continue;
    const start = Math.max(0, a + offset),
      end = Math.min(duration, b + offset);
    if (end < start) continue;
    if (end === start) {
      const last = words[words.length - 1];
      if (last && Math.abs(last.end - start) <= 0.04) {
        last.text += c.text;
        last.coarse = true;
      } else {
        pending += c.text;
        pendingTime = start;
      }
      continue;
    }
    const attach =
      !!pending &&
      pendingTime !== null &&
      Math.abs(start - pendingTime) <= 0.04;
    words.push({
      text: (attach ? pending : "") + c.text,
      start,
      end,
      ...(attach ? { coarse: true } : {}),
    });
    pending = "";
    pendingTime = null;
  }
  return words;
}
export function parseTranscript(
  raw: unknown,
  duration: number,
): TranscriptWord[] {
  const p = raw as {
    words?: unknown[];
    chunks?: unknown[];
    segments?: { words?: unknown[] }[];
  };
  const list = Array.isArray(raw)
    ? raw
    : (p?.words ?? p?.chunks ?? p?.segments?.flatMap((s) => s.words ?? []));
  if (!Array.isArray(list) || list.length > 30000)
    throw new Error(
      "ต้องใช้ JSON ที่มี words[{word/start/end}] หรือ chunks[{text/timestamp}] ระดับคำ",
    );
  const result = list
    .map((raw) => {
      const v = raw as {
        text?: string;
        word?: string;
        start?: number;
        end?: number;
        timestamp?: [number, number];
      };
      const text = v.text ?? v.word;
      const start = v.start ?? v.timestamp?.[0];
      const end = v.end ?? v.timestamp?.[1];
      if (
        typeof text !== "string" ||
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        end > duration + 0.1
      )
        throw new Error(
          "เวลาในไฟล์ถอดเสียงไม่ถูกต้องหรือเกินความยาวเพลง ต้องเป็นวินาที",
        );
      return { text, start, end };
    })
    .filter((w) => normalize(w.text));
  if (!result.length) throw new Error("ไม่พบคำที่มีเวลาในผลถอดเสียง");
  if (result.some((w, i) => i > 0 && w.start < result[i - 1].start))
    throw new Error("คำในผลถอดเสียงต้องเรียงตามเวลา");
  return result;
}

/** Monotonic character alignment tolerates different Thai word boundaries.
 * It transfers only observed ASR intervals; unmatched words never get invented times.
 * Scores measure text similarity, not acoustic confidence. */
export function alignLyrics(
  lyrics: Segment[],
  transcript: Transcript,
): Segment[] {
  const expected: { chars: string[]; segment: number; word: number }[] = [];
  const originals = lyrics.map((s, segment) =>
    splitWords(s.text).map((w, word) => {
      expected.push({ chars: Array.from(normalize(w.text)), segment, word });
      return w;
    }),
  );
  const a = expected.flatMap((w) =>
    w.chars.map((char, position) => ({
      char,
      position,
      segment: w.segment,
      word: w.word,
    })),
  );
  const b = transcript.words.flatMap((w, chunk) =>
    Array.from(normalize(w.text)).map((char) => ({ char, chunk })),
  );
  if (!a.length || !b.length) throw new Error("ไม่พบข้อความสำหรับเทียบคำร้อง");
  const cols = b.length + 1;
  if ((a.length + 1) * cols > 30000000)
    throw new Error(
      "ข้อความยาวเกินการเทียบครั้งเดียว กรุณาวิเคราะห์ช่วงสั้นลงหรือแบ่งเนื้อเพลง",
    );
  // Prefer complete exact word anchors over equally-scored scattered letters,
  // especially when long stretches of lyrics were not recognized at all.
  const bText = b.map((c) => c.char).join("");
  const offsets = new Map<number, number>();
  let offset = 0;
  b.forEach((c, i) => {
    offsets.set(offset, i);
    offset += c.char.length;
  });
  const anchors = new Map<string, Set<number>>();
  expected.forEach((w) => {
    const word = w.chars.join("");
    const starts = new Set<number>();
    if (word)
      for (
        let p = bText.indexOf(word);
        p !== -1;
        p = bText.indexOf(word, p + 1)
      ) {
        const index = offsets.get(p);
        if (index !== undefined) starts.add(index);
      }
    anchors.set(`${w.segment}:${w.word}`, starts);
  });
  const anchorSets = a.map(
    (char) => anchors.get(`${char.segment}:${char.word}`)!,
  );
  const path = new Uint8Array((a.length + 1) * cols);
  let prev = new Float32Array(cols);
  let current = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    prev[j] = j;
    path[j] = 2;
  }
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    path[i * cols] = 1;
    for (let j = 1; j < cols; j++) {
      const same = a[i - 1].char === b[j - 1].char;
      const anchored = same && anchorSets[i - 1].has(j - 1 - a[i - 1].position);
      const diagonal = prev[j - 1] + (same ? (anchored ? -0.08 : 0) : 1.25);
      const drop = prev[j] + 1;
      const insert = current[j - 1] + 1;
      const best = Math.min(diagonal, drop, insert);
      current[j] = best;
      path[i * cols + j] = best === diagonal ? 0 : best === drop ? 1 : 2;
    }
    [prev, current] = [current, prev];
  }
  const mapping = new Map<number, number>();
  let i = a.length,
    j = b.length;
  while (i || j) {
    const dir = path[i * cols + j];
    if (i && j && dir === 0) {
      mapping.set(i - 1, j - 1);
      i--;
      j--;
    } else if (i && (dir === 1 || !j)) i--;
    else j--;
  }
  const grouped = new Map<
    string,
    { indices: number[]; exact: number; length: number }
  >();
  a.forEach((char, index) => {
    const key = `${char.segment}:${char.word}`;
    const item = grouped.get(key) ?? { indices: [], exact: 0, length: 0 };
    item.length++;
    const target = mapping.get(index);
    if (target !== undefined) {
      item.indices.push(target);
      if (char.char === b[target].char) item.exact++;
    }
    grouped.set(key, item);
  });
  const uses = new Map<number, number>();
  const result = lyrics.map((s, segment) => {
    const words: AlignedWord[] = originals[segment].map((w, word) => {
      const item = grouped.get(`${segment}:${word}`)!;
      const similarity =
        item.exact /
        Math.max(
          1,
          item.length,
          item.indices.length
            ? Math.max(...item.indices) - Math.min(...item.indices) + 1
            : 0,
        );
      const indices = item.indices;
      const chunks = indices.length
        ? [
            ...new Set(
              b
                .slice(Math.min(...indices), Math.max(...indices) + 1)
                .map((c) => c.chunk),
            ),
          ]
        : [];
      const observed = chunks.map((c) => transcript.words[c]);
      const plausible =
        similarity >= 0.6 &&
        observed.length > 0 &&
        observed[observed.length - 1].end - observed[0].start <
          Math.max(4, w.text.length * 0.7);
      if (plausible) chunks.forEach((c) => uses.set(c, (uses.get(c) ?? 0) + 1));
      return {
        ...w,
        heard: plausible
          ? observed
              .map((x) => x.text)
              .join("")
              .trim()
          : "",
        start: plausible ? observed[0].start : null,
        end: plausible ? observed[observed.length - 1].end : null,
        match:
          similarity === 1 && plausible
            ? "exact"
            : plausible
              ? "close"
              : "missing",
        similarity,
        shared: false,
      };
    });
    return {
      ...s,
      alignment: {
        model: transcript.model,
        language: transcript.language,
        words,
        status: "proposed" as const,
      },
    };
  });
  // Several lyric words may map to a single ASR chunk. Expose its coarse interval;
  // do not divide it evenly and present those divisions as measured word timing.
  result.forEach((s) => {
    s.alignment.words.forEach((w) => {
      if (w.start !== null)
        w.shared = transcript.words.some(
          (t, c) =>
            ((uses.get(c) ?? 0) > 1 || t.coarse) &&
            w.start! < t.end &&
            t.start < w.end!,
        );
    });
    const timed = s.alignment.words.filter((w) => w.start !== null);
    if (timed.some((w, i) => i > 0 && w.start! - timed[i - 1].end! > 5))
      Object.assign(s.alignment, {
        warning: "คำที่พบอยู่ห่างกันมาก อาจจับคู่ผิดท่อน กรุณาฟังตรวจ",
      });
  });
  return result;
}
export function lineCanApply(a: LineAlignment): boolean {
  if (!a.words.length || a.warning) return false;
  return a.words.every(
    (w, i) =>
      w.start !== null &&
      w.end !== null &&
      w.start >= 0 &&
      w.end > w.start &&
      (!i ||
        w.start >= a.words[i - 1].end! - 0.025 ||
        (w.start === a.words[i - 1].start && w.end === a.words[i - 1].end)),
  );
}
export function clearMatch(segment: Segment): Segment {
  const { alignment: _alignment, ...rest } = segment;
  return {
    ...rest,
    source: segment.source === "recognized" ? "estimated" : segment.source,
  };
}
export function applyAlignment(s: Segment): Segment {
  const a = s.alignment;
  if (!a || !lineCanApply(a))
    throw new Error("ยังมีคำที่ไม่มีเวลา เวลาซ้อน หรือคำที่ต้องตรวจฟัง");
  return {
    ...s,
    start: a.words[0].start!,
    end: a.words[a.words.length - 1].end!,
    source: a.model === "กำหนดเอง" ? "manual" : "recognized",
    alignment: { ...a, status: "applied" },
  };
}
export function shiftSegment(s: Segment, delta: number): Segment {
  return {
    ...s,
    start: s.start + delta,
    end: s.end + delta,
    ...(s.alignment
      ? {
          alignment: {
            ...s.alignment,
            words: s.alignment.words.map((w) => ({
              ...w,
              start: w.start === null ? null : w.start + delta,
              end: w.end === null ? null : w.end + delta,
            })),
          },
        }
      : {}),
  };
}
export function manualWord(
  text: string,
  from: number,
  to: number,
): AlignedWord {
  return {
    text,
    from,
    to,
    heard: "",
    start: null,
    end: null,
    match: "missing",
    similarity: 0,
    shared: false,
  };
}
