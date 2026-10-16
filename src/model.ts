import { lineCanApply, type LineAlignment, type Transcript } from "./alignment";
export type Segment = {
  id: string;
  text: string;
  start: number;
  end: number;
  source: "estimated" | "imported" | "manual" | "recognized";
  alignment?: LineAlignment;
  section?: string;
  translation?: string;
};
export type Style = {
  color: string;
  accent: string;
  background: string;
  fontSize: number;
  position: number;
  theme: string;
  ratio: string;
  visualizer: boolean;
};
export type Project = {
  version: 1;
  name: string;
  lyrics: Segment[];
  style: Style;
  audioName: string;
  duration: number;
  audioFingerprint?: string;
  transcript?: Transcript;
};
export const defaultStyle: Style = {
  color: "#ffffff",
  accent: "#ff2d7b",
  background: "#111025",
  fontSize: 48,
  position: 58,
  theme: "midnight",
  ratio: "16:9",
  visualizer: true,
};
export const initialProject: Project = {
  version: 1,
  name: "โปรเจกต์ไม่มีชื่อ",
  lyrics: [],
  style: defaultStyle,
  audioName: "",
  duration: 0,
};
export const uid = () => crypto.randomUUID();
export function timecode(n: number) {
  const t = Math.max(0, Number.isFinite(n) ? n : 0);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(3).padStart(6, "0")}`;
}
export function parseTime(raw: string): number {
  const parts = raw.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((a, b) => a * 60 + b, 0);
}
export function words(text: string): string[] {
  return [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)]
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
}
export function parseLyrics(input: string, duration = 120): Segment[] {
  const lines = input.replace(/\r/g, "").split("\n");
  const result: Segment[] = [];
  let section = "";
  if (/\d{1,2}:\d{2}[^\n]*-->/.test(input)) {
    for (const block of input.replace(/\r/g, "").split(/\n\s*\n/)) {
      const rows = block.split("\n");
      const i = rows.findIndex((x) => x.includes("-->"));
      if (i < 0) continue;
      const [a, b] = rows[i].split("-->");
      const start = parseTime(a);
      const end = parseTime(b.trim().split(/\s/)[0]);
      const text = rows
        .slice(i + 1)
        .join("\n")
        .replace(/<[^>]*>/g, "")
        .trim();
      if (text && Number.isFinite(start) && Number.isFinite(end) && end > start)
        result.push({ id: uid(), text, start, end, source: "imported" });
    }
  } else {
    for (const raw of lines) {
      const row = raw.trim();
      if (!row || /^\[(ar|ti|al|by|offset|length):/i.test(row)) continue;
      const matches = [...row.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)];
      if (matches.length) {
        const text = row.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
        if (text)
          for (const m of matches)
            result.push({
              id: uid(),
              text,
              start: parseTime(m[1]),
              end: 0,
              source: "imported",
              section,
            });
      } else if (/^\[.+\]$/.test(row)) section = row.slice(1, -1);
      else
        result.push({
          id: uid(),
          text: row,
          start: -1,
          end: 0,
          source: "estimated",
          section,
        });
    }
    const timed = result.every((x) => x.start >= 0);
    if (timed) result.sort((a, b) => a.start - b.start);
    result.forEach((x, i) => {
      if (!timed) x.start = (i * duration) / result.length;
      x.end =
        result[i + 1]?.start > x.start
          ? result[i + 1].start
          : timed
            ? duration > x.start
              ? duration
              : x.start + 3
            : ((i + 1) * duration) / result.length;
    });
    if (!timed)
      result.forEach((x, i) => {
        x.end = ((i + 1) * duration) / result.length;
        x.source = "estimated";
      });
  }
  return result;
}
export function activeSegment(lyrics: Segment[], time: number) {
  return lyrics.find((x) => time >= x.start && time < x.end);
}
export function lyricAnalysis(lyrics: Segment[], duration: number) {
  const counts = new Map<string, number>();
  lyrics.forEach((x) =>
    counts.set(x.text.trim(), (counts.get(x.text.trim()) ?? 0) + 1),
  );
  return {
    lines: lyrics.length,
    words: lyrics.reduce((n, x) => n + words(x.text).length, 0),
    repeated: [...counts].filter(([, n]) => n > 1),
    sections: [...new Set(lyrics.map((x) => x.section).filter(Boolean))],
    issues: lyrics.flatMap((x, i) => {
      const errors: string[] = [];
      if (x.start < 0 || x.end <= x.start || !Number.isFinite(x.end))
        errors.push(`ท่อน ${i + 1}: เวลาเริ่ม/จบไม่ถูกต้อง`);
      if (duration && x.end > duration + 0.05)
        errors.push(`ท่อน ${i + 1}: เกินความยาวเพลง`);
      if (
        lyrics.some((y) => y.id !== x.id && x.start < y.end && y.start < x.end)
      )
        errors.push(`ท่อน ${i + 1}: เวลาซ้อนท่อนอื่น`);
      return errors;
    }),
    confirmed: lyrics.filter((x) => x.source === "manual").length,
    estimated: lyrics.filter((x) => x.source === "estimated").length,
  };
}
export function suggestTiming(
  lyrics: Segment[],
  energy: number[],
  duration: number,
): Segment[] {
  if (!lyrics.length || !energy.length || !duration) return lyrics;
  const peak = Math.max(...energy);
  const active = energy
    .map((e, i) => (e > peak * 0.16 ? i : -1))
    .filter((i) => i >= 0);
  if (!active.length) throw new Error("ไม่พบสัญญาณเสียงที่ใช้เสนอเวลาได้");
  const start = (active[0] / energy.length) * duration;
  const end = ((active[active.length - 1] + 1) / energy.length) * duration;
  const weights = lyrics.map((x) => Math.max(1, words(x.text).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return lyrics.map((x, i) => {
    const s = cursor;
    cursor += ((end - start) * weights[i]) / total;
    return { ...x, start: s, end: cursor, source: "estimated" };
  });
}
export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !Array.isArray(p.lyrics) ||
    p.lyrics.length > 10000 ||
    !p.style ||
    typeof p.audioName !== "string" ||
    !Number.isFinite(p.duration) ||
    p.duration < 0
  )
    throw new Error("ไฟล์โปรเจกต์ไม่ถูกต้อง");
  for (const x of p.lyrics)
    if (
      typeof x.text !== "string" ||
      !Number.isFinite(x.start) ||
      !Number.isFinite(x.end) ||
      x.start < 0 ||
      x.end <= x.start ||
      !["estimated", "manual", "imported", "recognized"].includes(x.source)
    )
      throw new Error("ข้อมูลเนื้อเพลงหรือเวลาไม่ถูกต้อง");
  if (
    !["16:9", "9:16", "1:1", "4:5"].includes(p.style.ratio) ||
    !["midnight", "aurora", "sunset", "minimal"].includes(p.style.theme) ||
    ![p.style.color, p.style.accent, p.style.background].every((v) =>
      /^#[0-9a-f]{6}$/i.test(v),
    ) ||
    !Number.isFinite(p.style.fontSize) ||
    p.style.fontSize < 16 ||
    p.style.fontSize > 100 ||
    !Number.isFinite(p.style.position) ||
    p.style.position < 15 ||
    p.style.position > 85
  )
    throw new Error("รูปแบบโปรเจกต์ไม่ถูกต้อง");
  for (const x of p.lyrics) {
    const a = x.alignment;
    if (!a) continue;
    if (
      !["proposed", "applied"].includes(a.status) ||
      typeof a.model !== "string" ||
      typeof a.language !== "string" ||
      !Array.isArray(a.words) ||
      a.words.length > 10000
    )
      throw new Error("ข้อมูลการเทียบคำไม่ถูกต้อง");
    for (const w of a.words)
      if (
        typeof w.text !== "string" ||
        typeof w.heard !== "string" ||
        !Number.isInteger(w.from) ||
        !Number.isInteger(w.to) ||
        w.from < 0 ||
        w.to <= w.from ||
        x.text.slice(w.from, w.to) !== w.text ||
        !["exact", "close", "missing", "manual"].includes(w.match) ||
        !Number.isFinite(w.similarity) ||
        w.similarity < 0 ||
        w.similarity > 1 ||
        typeof w.shared !== "boolean" ||
        ![w.start, w.end].every(
          (t) =>
            t === null ||
            (typeof t === "number" &&
              Number.isFinite(t) &&
              t >= 0 &&
              t <= p.duration + 0.1),
        )
      )
        throw new Error("ข้อมูลเวลารายคำไม่ถูกต้อง");
    if (
      a.status === "applied" &&
      (!lineCanApply(a) ||
        a.words[0].start! < x.start - 0.025 ||
        a.words[a.words.length - 1].end! > x.end + 0.025)
    )
      throw new Error("เวลารายคำไม่สัมพันธ์กับเวลาท่อน");
  }
  if (p.transcript) {
    const t = p.transcript;
    if (
      typeof t.model !== "string" ||
      typeof t.language !== "string" ||
      typeof t.text !== "string" ||
      !Array.isArray(t.words) ||
      t.words.length > 30000 ||
      t.words.some(
        (w) =>
          typeof w.text !== "string" ||
          !Number.isFinite(w.start) ||
          !Number.isFinite(w.end) ||
          w.start < 0 ||
          w.end <= w.start ||
          w.end > p.duration + 0.1,
      )
    )
      throw new Error("ข้อมูลถอดเสียงไม่ถูกต้อง");
  }
  return { ...p, lyrics: p.lyrics.map((x) => ({ ...x, id: uid() })) };
}
export function exportLrc(lyrics: Segment[]) {
  return [...lyrics]
    .sort((a, b) => a.start - b.start)
    .map((x) => `[${timecode(x.start)}]${x.text}`)
    .join("\n");
}
