import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  FileText,
  Palette,
  ChartNoAxesCombined,
  Upload,
  Play,
  Pause,
  SkipBack,
  Download,
  Save,
  FolderOpen,
  Undo2,
  Redo2,
  Plus,
  Trash2,
  Headphones,
  Check,
  X,
  HelpCircle,
  Maximize,
  MousePointer2,
  Music2,
  ShieldCheck,
} from "lucide-react";
import {
  activeSegment,
  exportLrc,
  initialProject,
  lyricAnalysis,
  parseLyrics,
  suggestTiming,
  timecode,
  uid,
  validateProject,
  type Project,
  type Segment,
} from "./model";
import { decodeAudio, type AudioData } from "./audio";
import { download, loadLocal, saveLocal } from "./storage";
import { dimensions, exportVideo, renderFrame, videoMime } from "./render";
import SyncPanel, { WordTimingEditor } from "./SyncPanel";
import {
  applyAlignment,
  clearMatch,
  lineCanApply,
  shiftSegment,
  splitWords,
  manualWord,
} from "./alignment";

const tabs = [
  { id: "lyrics", label: "เนื้อเพลง", icon: FileText },
  { id: "analysis", label: "วิเคราะห์", icon: ChartNoAxesCombined },
  { id: "style", label: "ตกแต่ง", icon: Palette },
] as const;
const themes = [
  ["midnight", "Midnight Bloom", "#553779"],
  ["aurora", "Northern Lights", "#227b72"],
  ["sunset", "Golden Hour", "#b65b69"],
  ["minimal", "Minimal Studio", "#282831"],
];
export default function App() {
  const [project, setProject] = useState<Project>(
    structuredClone(initialProject),
  );
  const projectRef = useRef(project);
  projectRef.current = project;
  const [tab, setTab] = useState<string>("lyrics");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tap, setTap] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [help, setHelp] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const auditionEnd = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<{ past: Project[]; future: Project[] }>({
    past: [],
    future: [],
  });
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const lyricInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const source = useRef<MediaElementAudioSourceNode | null>(null);
  const abort = useRef<AbortController | null>(null);
  const writing = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const storageBlocked = useRef(false);
  const dirty = useRef(false);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด กรุณาลองใหม่");
  const commit = useCallback((change: Project | ((p: Project) => Project)) => {
    const old = projectRef.current;
    const next = typeof change === "function" ? change(old) : change;
    dirty.current = true;
    saveRevision.current++;
    history.current.past.push(old);
    if (history.current.past.length > 80) history.current.past.shift();
    history.current.future = [];
    projectRef.current = next;
    setProject(next);
    setHistoryVersion((v) => v + 1);
    setResult(null);
  }, []);
  function replaceProject(next: Project) {
    dirty.current = true;
    saveRevision.current++;
    storageBlocked.current = false;
    history.current = { past: [], future: [] };
    projectRef.current = next;
    setProject(next);
    setHistoryVersion((v) => v + 1);
    setResult(null);
  }
  const undo = useCallback((redo = false) => {
    const h = history.current;
    const from = redo ? h.future : h.past;
    const to = redo ? h.past : h.future;
    const next = from.pop();
    if (next) {
      dirty.current = true;
      saveRevision.current++;
      to.push(projectRef.current);
      projectRef.current = next;
      setProject(next);
      setHistoryVersion((v) => v + 1);
      setResult(null);
    }
  }, []);
  void historyVersion;
  useEffect(() => {
    let live = true;
    loadLocal()
      .then(async (data) => {
        if (!live) return;
        if (data) {
          const p = validateProject(data.project);
          let decoded: AudioData | null = null;
          if (data.audio) {
            try {
              decoded = await decodeAudio(data.audio);
            } catch {
              setError("กู้คืนเพลงไม่ได้ กรุณาแนบไฟล์เพลงอีกครั้ง");
            }
          }
          if (!live) return;
          setProject(p);
          projectRef.current = p;
          setAudioBlob(data.audio);
          setAudioData(decoded);
          setNotice(
            !data.audio && p.audioName
              ? "โปรเจกต์นี้ยังไม่มีไฟล์เพลง กรุณาแนบเพลงอีกครั้ง"
              : "กู้คืนโปรเจกต์ล่าสุดแล้ว",
          );
          setSaved("กู้คืนงานที่บันทึกแล้ว");
        }
      })
      .catch((e) => {
        storageBlocked.current = true;
        fail(e);
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);
  useEffect(() => {
    if (!result) {
      setResultUrl("");
      return;
    }
    const url = URL.createObjectURL(result);
    setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => {
    if (!loaded || storageBlocked.current || !dirty.current) return;
    const revision = saveRevision.current;
    setSaved("กำลังบันทึก…");
    const timer = setTimeout(() => {
      writing.current = writing.current
        .catch(() => {})
        .then(() => saveLocal(project, audioBlob))
        .then(() => {
          if (revision === saveRevision.current) {
            dirty.current = false;
            setSaved("บันทึกในเครื่องแล้ว");
          }
        })
        .catch(() => {
          if (revision === saveRevision.current)
            setSaved("บันทึกไม่สำเร็จ — ดาวน์โหลดโปรเจกต์สำรอง");
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [project, audioBlob, loaded]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const t = audio.current?.currentTime ?? 0;
      if (auditionEnd.current !== null && t >= auditionEnd.current) {
        audio.current?.pause();
        auditionEnd.current = null;
      }
      setTime(t);
      if (canvas.current) {
        let bins: Uint8Array | undefined;
        if (analyser.current) {
          bins = new Uint8Array(analyser.current.frequencyBinCount);
          analyser.current.getByteFrequencyData(bins);
        }
        renderFrame(canvas.current, projectRef.current, t, bins);
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const el = wave.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    el.width = 2400;
    el.height = 100;
    ctx.clearRect(0, 0, 2400, 100);
    const peaks = audioData?.peaks ?? [];
    const max = Math.max(0.01, ...peaks);
    ctx.fillStyle = "#9181dd";
    peaks.forEach((p, i) => {
      const h = (p / max) * 85;
      ctx.fillRect(
        (i / peaks.length) * 2400,
        (100 - h) / 2,
        Math.max(1, 2400 / peaks.length - 0.6),
        h,
      );
    });
  }, [audioData]);
  async function playPause() {
    try {
      if (!audio.current || !audioData) throw new Error("กรุณาอัปโหลดเพลงก่อน");
      if (!audio.current.paused) {
        audio.current.pause();
        return;
      }
      if (!context.current) {
        context.current = new AudioContext();
        source.current = context.current.createMediaElementSource(
          audio.current,
        );
        analyser.current = context.current.createAnalyser();
        analyser.current.fftSize = 256;
        source.current.connect(analyser.current);
        analyser.current.connect(context.current.destination);
      }
      await context.current.resume();
      await audio.current.play();
    } catch (e) {
      fail(e);
    }
  }
  function seek(t: number) {
    if (audio.current) {
      audio.current.currentTime = Math.max(
        0,
        Math.min(project.duration || 0, t),
      );
      setTime(audio.current.currentTime);
    }
  }
  async function uploadAudio(file?: File) {
    if (!loaded) return;
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      setError("ไฟล์ใหญ่เกิน 150 MB กรุณาใช้เพลงที่สั้นลง");
      return;
    }
    if (!/\.(mp3|wav|m4a|flac|ogg|aac|webm|mp4)$/i.test(file.name)) {
      setError("รองรับ MP3, WAV, M4A, FLAC, OGG, AAC");
      return;
    }
    setBusy("กำลังถอดรหัสและวิเคราะห์เสียง…");
    setError("");
    try {
      audio.current?.pause();
      const data = await decodeAudio(file);
      const fingerprint = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setAudioData(data);
      setAudioBlob(file);
      replaceProject({
        ...projectRef.current,
        audioName: file.name,
        duration: data.buffer.duration,
        audioFingerprint: fingerprint,
        transcript:
          projectRef.current.audioFingerprint === fingerprint
            ? projectRef.current.transcript
            : undefined,
        lyrics:
          projectRef.current.audioFingerprint === fingerprint
            ? projectRef.current.lyrics
            : projectRef.current.lyrics.map(clearMatch),
      });
      setNotice("อ่าน waveform สำเร็จ — พร้อมจับเวลาเนื้อเพลง");
    } catch {
      setError("เบราว์เซอร์อ่านไฟล์เสียงนี้ไม่ได้ ลองแปลงเป็น MP3 หรือ WAV");
    } finally {
      setBusy("");
    }
  }
  function importText(raw: string) {
    const lyrics = parseLyrics(raw, project.duration || 120);
    if (!lyrics.length) {
      setError("ไม่พบเนื้อเพลงหรือ timestamp ที่อ่านได้");
      return;
    }
    commit((p) => ({ ...p, lyrics }));
    setSelected(lyrics[0].id);
    setText("");
    setNotice(
      `เพิ่ม ${lyrics.length} ท่อนแล้ว${lyrics.some((x) => x.source === "estimated") ? " · เวลายังเป็นค่าประมาณ กรุณาจับเวลาหรือนำเข้า LRC" : ""}`,
    );
  }
  function editSegment(id: string, patch: Partial<Segment>) {
    commit((p) => ({
      ...p,
      lyrics: p.lyrics.map((x) =>
        x.id === id
          ? {
              ...((patch.text !== undefined && patch.text !== x.text) ||
              patch.start !== undefined ||
              patch.end !== undefined
                ? clearMatch(x)
                : x),
              ...patch,
            }
          : x,
      ),
    }));
  }
  function stamp(which: "start" | "end") {
    const p = projectRef.current;
    const index = p.lyrics.findIndex((x) => x.id === selected);
    if (index < 0) {
      setError("เลือกท่อนร้องก่อนจับเวลา");
      return;
    }
    const now = audio.current?.currentTime ?? 0;
    if (!audioData) {
      setError("กรุณาเพิ่มเพลงก่อนจับเวลา");
      return;
    }
    commit({
      ...p,
      lyrics: p.lyrics.map((x, i) => {
        if (i === index)
          return {
            ...clearMatch(x),
            [which]: now,
            ...(which === "start" && x.end <= now
              ? { end: Math.min(now + 3, p.duration) }
              : {}),
            source: "manual",
          };
        if (which === "start" && i === index - 1 && x.end > now)
          return { ...clearMatch(x), end: now };
        return x;
      }),
    });
    if (which === "end" && p.lyrics[index + 1])
      setSelected(p.lyrics[index + 1].id);
  }
  function tapNext() {
    const p = projectRef.current;
    const index = Math.max(
      0,
      p.lyrics.findIndex((x) => x.id === selected),
    );
    const now = audio.current?.currentTime ?? 0;
    if (!audioData || !p.lyrics.length) return;
    commit({
      ...p,
      lyrics: p.lyrics.map((x, i) =>
        i === index
          ? {
              ...clearMatch(x),
              start: now,
              end: Math.max(now + 0.001, x.end),
              source: "manual",
            }
          : i === index - 1
            ? { ...clearMatch(x), end: now, source: "manual" }
            : x,
      ),
    });
    setSelected(p.lyrics[index + 1]?.id ?? p.lyrics[index]?.id);
    if (index === p.lyrics.length - 1) {
      setTap(false);
      setNotice("จับเวลาท่อนสุดท้ายแล้ว ใช้ OUT ปรับเวลาจบ");
    }
  }
  function saveJson() {
    download(
      new Blob([JSON.stringify(projectRef.current, null, 2)], {
        type: "application/json",
      }),
      `${projectRef.current.name}.bk.json`,
    );
    setNotice("ดาวน์โหลด JSON แล้ว — ไฟล์เพลงเก็บในเครื่อง แยกสำรองเพลงด้วย");
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (exporting || help || syncing || busy) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveJson();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        undo(true);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (tap) tapNext();
        else void playPause();
      } else if (e.key.toLowerCase() === "i") stamp("start");
      else if (e.key.toLowerCase() === "o") stamp("end");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function openJson(file?: File) {
    if (!file) return;
    setBusy("กำลังเปิดโปรเจกต์…");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("ไฟล์ JSON ใหญ่เกิน 5 MB");
      const p = validateProject(JSON.parse(await file.text()));
      audio.current?.pause();
      replaceProject(p);
      setAudioBlob(null);
      setAudioData(null);
      setSelected(p.lyrics[0]?.id ?? "");
      setNotice("เปิดโปรเจกต์แล้ว กรุณาแนบไฟล์เพลงเดิมอีกครั้ง");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  const analysis = lyricAnalysis(project.lyrics, project.duration);
  const current = project.lyrics.find((x) => x.id === selected);
  const active = activeSegment(project.lyrics, time);
  function setStyle(patch: Partial<Project["style"]>) {
    commit((p) => ({ ...p, style: { ...p.style, ...patch } }));
  }
  async function startExport() {
    setError("");
    if (!audioData) {
      setError("กรุณาเพิ่มเพลงก่อนส่งออก");
      return;
    }
    if (!project.lyrics.length) {
      setError("กรุณาเพิ่มเนื้อเพลงก่อนส่งออก");
      return;
    }
    if (analysis.issues.length) {
      setError("แก้ไขเวลาไม่ถูกต้องหรือซ้อนกันในแท็บวิเคราะห์ก่อนส่งออก");
      return;
    }
    audio.current?.pause();
    setTap(false);
    setExporting(true);
    setProgress(0);
    setResult(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const blob = await exportVideo(
        document.createElement("canvas"),
        project,
        audioData.buffer,
        setProgress,
        controller.signal,
      );
      setResult(blob);
      setNotice("ส่งออกสำเร็จ ตรวจสอบวิดีโอแล้วดาวน์โหลดได้");
    } catch (e) {
      if ((e as Error).name === "AbortError") setNotice("ยกเลิกการส่งออกแล้ว");
      else fail(e);
    } finally {
      setExporting(false);
    }
  }
  function dragClip(
    e: React.PointerEvent<HTMLElement>,
    segment: Segment,
    edge?: "start" | "end",
  ) {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(segment.id);
    const rect = timeline.current!.getBoundingClientRect();
    const startX = e.clientX;
    const p = projectRef.current;
    let next = p;
    const mode = edge ?? "move";
    const move = (ev: PointerEvent) => {
      dirty.current = true;
      saveRevision.current++;
      const delta = ((ev.clientX - startX) / rect.width) * (p.duration || 120);
      let a = segment.start,
        b = segment.end;
      if (mode === "move") {
        const d = Math.max(-a, Math.min(delta, (p.duration || 120) - b));
        a += d;
        b += d;
      } else if (mode === "start")
        a = Math.max(0, Math.min(b - 0.02, a + delta));
      else b = Math.min(p.duration || 120, Math.max(a + 0.02, b + delta));
      next = {
        ...p,
        lyrics: p.lyrics.map((x) =>
          x.id === segment.id
            ? {
                ...(mode === "move"
                  ? shiftSegment(x, a - x.start)
                  : clearMatch(x)),
                start: a,
                end: b,
                source: "manual",
              }
            : x,
        ),
      };
      projectRef.current = next;
      setProject(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (next !== p) {
        history.current.past.push(p);
        history.current.future = [];
        setHistoryVersion((v) => v + 1);
        setResult(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }
  const [cw, ch] = dimensions(project.style.ratio);
  return (
    <div
      className="studio"
      data-ready={loaded ? "true" : "false"}
      inert={syncing || undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (exporting || syncing || busy || !loaded) return;
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (/\.(txt|lrc|srt|vtt)$/i.test(file.name))
          void file.text().then(importText).catch(fail);
        else void uploadAudio(file);
      }}
    >
      <audio
        ref={audio}
        src={audioUrl || undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          if (audioUrl) setError("เล่นเสียงไม่ได้ กรุณาลองไฟล์ MP3 หรือ WAV");
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.flac,.m4a"
        hidden
        onChange={(e) => {
          void uploadAudio(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={lyricInput}
        type="file"
        accept=".txt,.lrc,.srt,.vtt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            if (f.size > 2 * 1024 * 1024)
              setError("ไฟล์เนื้อเพลงใหญ่เกิน 2 MB");
            else void f.text().then(importText).catch(fail);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          void openJson(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <a className="brand" href="#" aria-label="BK Lyric Studio">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <div>
            BK LYRIC <b>STUDIO</b>
            <small>PRO · YOUR MUSIC, YOUR STORY</small>
          </div>
        </a>
        <div className="project-title">
          <input
            aria-label="ชื่อโปรเจกต์"
            value={project.name}
            maxLength={100}
            onChange={(e) => commit((p) => ({ ...p, name: e.target.value }))}
          />
          <span className="save-state">
            <i />
            {saved || "พื้นที่สร้างสรรค์ของคุณ"}
          </span>
        </div>
        <div className="top-actions">
          <button
            title="โปรเจกต์ใหม่"
            aria-label="โปรเจกต์ใหม่"
            onClick={() => {
              if (
                confirm(
                  "เริ่มโปรเจกต์ใหม่? ดาวน์โหลด JSON และเก็บไฟล์เพลงไว้ก่อนหากต้องการสำรอง",
                )
              ) {
                audio.current?.pause();
                replaceProject(structuredClone(initialProject));
                setAudioBlob(null);
                setAudioData(null);
                setSelected("");
                setText("");
                setTap(false);
              }
            }}
          >
            <Plus size={17} />
          </button>
          <button
            title="เปิดโปรเจกต์ JSON"
            aria-label="เปิดโปรเจกต์ JSON"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          <button
            title="ดาวน์โหลดโปรเจกต์ JSON"
            aria-label="บันทึกโปรเจกต์"
            onClick={saveJson}
          >
            <Save size={17} />
          </button>
          <span className="divider" />
          <button
            aria-label="เลิกทำ"
            title="เลิกทำ Ctrl+Z"
            disabled={!history.current.past.length}
            onClick={() => undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            aria-label="ทำซ้ำ"
            title="ทำซ้ำ Ctrl+Y"
            disabled={!history.current.future.length}
            onClick={() => undo(true)}
          >
            <Redo2 size={17} />
          </button>
          <button
            aria-label="วิธีใช้งาน"
            title="วิธีใช้งาน"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={17} />
          </button>
          <button
            className="primary export-top"
            onClick={() => void startExport()}
            disabled={!loaded || !!busy || exporting || syncing}
          >
            <Download size={16} /> ส่งออกวิดีโอ
          </button>
        </div>
      </header>
      <div className="workflow">
        <span className={audioData ? "done" : "step-active"}>
          <b>{audioData ? <Check size={12} /> : 1}</b> เพิ่มเพลง
        </span>
        <em />
        <span
          className={
            project.lyrics.length ? "done" : audioData ? "step-active" : ""
          }
        >
          <b>{project.lyrics.length ? <Check size={12} /> : 2}</b> ใส่เนื้อเพลง
        </span>
        <em />
        <span className={project.lyrics.length ? "step-active" : ""}>
          <b>3</b> จับเวลาและตกแต่ง
        </span>
        <em />
        <span>
          <b>4</b> ส่งออก
        </span>
        <span className="local-badge">
          <ShieldCheck size={13} /> ไฟล์อยู่ในเครื่องคุณ
        </span>
      </div>
      {(error || notice) && (
        <div
          className={`message ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            aria-label="ปิดข้อความ"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <main className="workspace">
        <nav className="rail" aria-label="เครื่องมือ">
          <div className="rail-label">STUDIO</div>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={21} />
              <span>{t.label}</span>
            </button>
          ))}
          <div className="rail-bottom">
            <Headphones size={23} />
            <small>
              สร้างสรรค์
              <br />
              ได้เต็มเสียง
            </small>
          </div>
        </nav>
        <section className="left-panel">
          <div className="panel-title">
            <h2>
              {tab === "lyrics"
                ? "เนื้อเพลงของคุณ"
                : tab === "analysis"
                  ? "วิเคราะห์เพลงและเนื้อร้อง"
                  : "สไตล์ของวิดีโอ"}
            </h2>
            <span className="tiny-label">
              {tab === "lyrics"
                ? "LYRICS"
                : tab === "analysis"
                  ? "INSIGHTS"
                  : "APPEARANCE"}
            </span>
          </div>
          {tab === "lyrics" ? (
            <>
              <div
                className="audio-upload"
                onClick={() => audioInput.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") audioInput.current?.click();
                }}
              >
                <span className="upload-icon">
                  <Music2 size={22} />
                </span>
                <div>
                  <b>{project.audioName || "เพิ่มไฟล์เพลงของคุณ"}</b>
                  <small>
                    {audioData
                      ? `${timecode(project.duration)} · พร้อมจับเวลา`
                      : "ลากไฟล์มาวาง หรือคลิกเพื่อเลือก"}
                  </small>
                </div>
                <Upload size={16} />
              </div>
              <div className="section-heading">
                <h3>เพิ่มเนื้อเพลง</h3>
                <button
                  className="text-button"
                  onClick={() => lyricInput.current?.click()}
                >
                  <Upload size={13} /> นำเข้าไฟล์
                </button>
              </div>
              <textarea
                className="lyrics-input"
                aria-label="วางเนื้อเพลง"
                placeholder={
                  "วางเนื้อเพลงที่นี่…\nหนึ่งบรรทัด = หนึ่งท่อนร้อง\n\nใช้ [Verse] หรือ [Chorus] แบ่งท่อน"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="import-footer">
                <span>TXT · LRC · SRT · VTT</span>
                <button
                  className="primary small"
                  disabled={!text.trim()}
                  onClick={() => importText(text)}
                >
                  สร้างท่อนร้อง <Plus size={14} />
                </button>
              </div>
              {project.lyrics.length > 0 && (
                <button
                  className="primary sync-cta"
                  onClick={() => setTab("analysis")}
                >
                  <AudioLines size={15} /> ตรวจคำที่ร้องให้ตรงเนื้อเพลง
                </button>
              )}
              <div className="section-heading">
                <h3>
                  ท่อนร้อง{" "}
                  <span className="count">{project.lyrics.length}</span>
                </h3>
                <button
                  className="text-button"
                  title="เพิ่มท่อนว่างที่ตำแหน่งปัจจุบัน"
                  onClick={() => {
                    const id = uid();
                    commit((p) => ({
                      ...p,
                      lyrics: [
                        ...p.lyrics,
                        {
                          id,
                          text: "เนื้อเพลงใหม่",
                          start: time,
                          end: Math.min(time + 3, p.duration || 120),
                          source: "estimated",
                        },
                      ],
                    }));
                    setSelected(id);
                  }}
                >
                  <Plus size={15} /> เพิ่ม
                </button>
              </div>
              <div className="segments">
                {!project.lyrics.length ? (
                  <div className="empty-small">
                    <FileText size={28} />
                    <p>ทุกเพลงเริ่มจากบรรทัดแรก</p>
                    <small>เพิ่มเนื้อเพลงเพื่อเริ่มจัดเวลา</small>
                  </div>
                ) : (
                  project.lyrics.map((s, i) => (
                    <button
                      className={`segment ${selected === s.id ? "selected" : ""} ${active?.id === s.id ? "singing" : ""}`}
                      key={s.id}
                      onClick={() => {
                        setSelected(s.id);
                        seek(s.start);
                      }}
                    >
                      <span className="segment-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        {s.section && (
                          <small className="section-tag">{s.section}</small>
                        )}
                        <p>{s.text}</p>
                        <small>
                          {s.source === "estimated"
                            ? "ยังไม่ได้เทียบคำร้อง · เวลาคร่าว ๆ"
                            : `${timecode(s.start)} — ${timecode(s.end)}`}
                        </small>
                      </div>
                      <span
                        className={`source-dot ${s.source}`}
                        title={
                          s.source === "estimated"
                            ? "เวลาประมาณ"
                            : s.source === "imported"
                              ? "เวลาจากไฟล์"
                              : s.source === "recognized"
                                ? "เวลาจากคำที่ถอดเสียง"
                                : "ปรับด้วยตนเอง"
                        }
                      />
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
          {tab === "analysis" && (
            <div className="analysis-content">
              <SyncPanel
                project={project}
                audioData={audioData}
                onChange={commit}
                onSelect={(s) => {
                  setSelected(s.id);
                  seek(
                    s.alignment?.words.find((w) => w.start !== null)?.start ??
                      s.start,
                  );
                }}
                onBusy={(value) => {
                  setSyncing(value);
                  if (value) {
                    audio.current?.pause();
                    setTap(false);
                  }
                }}
                onError={fail}
                onNotice={setNotice}
              />
              <p className="muted">
                ตรวจโครงสร้างเนื้อเพลงและช่วงเวลาในเครื่อง
                ไม่ส่งเสียงไปยังบริการภายนอก
              </p>
              <div className="stat-grid">
                <div>
                  <b>{analysis.lines}</b>
                  <span>ท่อนร้อง</span>
                </div>
                <div>
                  <b>{analysis.words}</b>
                  <span>คำโดยประมาณ</span>
                </div>
                <div>
                  <b>{analysis.confirmed}</b>
                  <span>ท่อนที่ปรับเอง</span>
                </div>
                <div>
                  <b>{analysis.estimated}</b>
                  <span>เวลาที่ยังประมาณ</span>
                </div>
              </div>
              <details className="rough-timing">
                <summary>
                  เครื่องมือเดิม: แบ่งเวลาคร่าว ๆ (ไม่เทียบคำร้อง)
                </summary>
                <p className="muted">
                  ใช้พลังงานเสียงหาแนวช่วงที่มีเสียง แล้วแบ่งตามจำนวนคำ
                  เป็นเพียงจุดเริ่มต้น ดนตรีอาจถูกนับเป็นเสียงร้อง
                  ยังไม่มีโมเดลแยกเสียงร้องหรือ Forced Alignment
                </p>
                <button
                  className="secondary full"
                  disabled={!audioData || !project.lyrics.length}
                  onClick={() => {
                    try {
                      commit((p) => ({
                        ...p,
                        lyrics: suggestTiming(
                          p.lyrics,
                          audioData!.energy,
                          p.duration,
                        ).map(clearMatch),
                      }));
                      setNotice(
                        "สร้างเวลาประมาณแล้ว กรุณาฟังและจับเวลา IN / OUT ทุกท่อน",
                      );
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  <AudioLines size={16} /> วิเคราะห์เสียงและเสนอเวลา
                </button>
              </details>
              <h3>โครงสร้างและท่อนซ้ำ</h3>
              <div className="info-box">
                {analysis.sections.length
                  ? analysis.sections.join(" → ")
                  : "เพิ่ม [Verse] / [Chorus] ในเนื้อเพลงเพื่อระบุโครงสร้าง"}
              </div>
              {analysis.repeated.map(([line, n]) => (
                <div className="repeat-row" key={line}>
                  <span>{line}</span>
                  <b>×{n}</b>
                </div>
              ))}
              {!analysis.repeated.length && (
                <p className="muted">ยังไม่พบบรรทัดซ้ำ</p>
              )}
              <h3>ตรวจสอบเวลา</h3>
              {analysis.issues.length ? (
                <ul className="issue-list">
                  {analysis.issues.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              ) : (
                <div className="info-box">
                  <Check size={15} />{" "}
                  {project.lyrics.length
                    ? "ไม่พบเวลาซ้อนหรือเวลาเกินเพลง"
                    : "เพิ่มเนื้อเพลงเพื่อเริ่มตรวจสอบ"}
                </div>
              )}
              <p className="note">
                ไม่มีระบบรับประกันการซิงก์ 100% ควรตรวจฟังทุกท่อน โดยเฉพาะ RAP
                และเสียงร้องซ้อน
              </p>
              <button
                className="secondary full"
                disabled={!project.lyrics.length}
                onClick={() =>
                  download(
                    new Blob([exportLrc(project.lyrics)], {
                      type: "text/plain;charset=utf-8",
                    }),
                    `${project.name}.lrc`,
                  )
                }
              >
                <Download size={15} /> ดาวน์โหลดเนื้อเพลง LRC
              </button>
            </div>
          )}
          {tab === "style" && (
            <div className="style-content">
              <p className="eyebrow">MOOD COLLECTION</p>
              <h3>เลือกบรรยากาศให้เพลง</h3>
              <div className="theme-grid">
                {themes.map(([id, label, color]) => (
                  <button
                    className={`theme-card ${project.style.theme === id ? "chosen" : ""}`}
                    key={id}
                    onClick={() => setStyle({ theme: id })}
                  >
                    <span
                      style={{
                        background: `radial-gradient(at 30% 20%, ${color}, #13121f)`,
                      }}
                    >
                      <i>ความรู้สึกที่เป็นคุณ</i>
                      {project.style.theme === id && <Check size={15} />}
                    </span>
                    <small>{label}</small>
                  </button>
                ))}
              </div>
              <h3>ข้อความและสี</h3>
              <label>
                สีข้อความ
                <input
                  aria-label="สีข้อความ"
                  type="color"
                  value={project.style.color}
                  onChange={(e) => setStyle({ color: e.target.value })}
                />
              </label>
              <label>
                สีไฮไลต์
                <input
                  aria-label="สีไฮไลต์"
                  type="color"
                  value={project.style.accent}
                  onChange={(e) => setStyle({ accent: e.target.value })}
                />
              </label>
              <label>
                สีพื้นหลัง
                <input
                  aria-label="สีพื้นหลัง"
                  type="color"
                  value={project.style.background}
                  onChange={(e) => setStyle({ background: e.target.value })}
                />
              </label>
              <label>
                ขนาดข้อความ <span>{project.style.fontSize} px</span>
              </label>
              <input
                aria-label="ขนาดข้อความ"
                type="range"
                min="16"
                max="100"
                value={project.style.fontSize}
                onChange={(e) => setStyle({ fontSize: +e.target.value })}
              />
              <label>
                ตำแหน่งแนวตั้ง <span>{project.style.position}%</span>
              </label>
              <input
                aria-label="ตำแหน่งข้อความ"
                type="range"
                min="15"
                max="85"
                value={project.style.position}
                onChange={(e) => setStyle({ position: +e.target.value })}
              />
              <label className="toggle-label">
                แถบเสียงจากเพลงจริง
                <input
                  type="checkbox"
                  checked={project.style.visualizer}
                  onChange={(e) => setStyle({ visualizer: e.target.checked })}
                />
              </label>
              <p className="note">
                ภาพตัวอย่างและวิดีโอส่งออกใช้ตัววาด Canvas เดียวกัน
                ฟอนต์ใช้ฟอนต์ระบบของอุปกรณ์
              </p>
            </div>
          )}
        </section>
        <section className="preview-panel">
          <div className="preview-toolbar">
            <span>
              <i className="live-dot" /> LIVE PREVIEW
              {active?.source === "estimated" && (
                <small className="preview-alignment">
                  ยังไม่ได้เทียบกับเสียงร้อง
                </small>
              )}
            </span>
            <div>
              <select
                aria-label="สัดส่วนวิดีโอ"
                value={project.style.ratio}
                onChange={(e) => setStyle({ ratio: e.target.value })}
              >
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
                <option>4:5</option>
              </select>
              <button
                aria-label="แสดงเต็มหน้าจอ"
                title="แสดงภาพตัวอย่างเต็มหน้าจอ"
                onClick={() =>
                  void canvas.current?.requestFullscreen().catch(fail)
                }
              >
                <Maximize size={15} />
              </button>
            </div>
          </div>
          <div className="canvas-area">
            <div
              className="canvas-wrap"
              style={{ aspectRatio: project.style.ratio.replace(":", "/") }}
            >
              <canvas
                ref={canvas}
                width={cw}
                height={ch}
                aria-label="ภาพตัวอย่างวิดีโอ"
              />
            </div>
            {!audioData && (
              <button
                className="start-overlay"
                onClick={() => audioInput.current?.click()}
              >
                <Upload size={17} /> เริ่มต้นด้วยไฟล์เพลง
              </button>
            )}
          </div>
          <div className="transport">
            <span className="transport-time">
              {timecode(time)} <i>/ {timecode(project.duration)}</i>
            </span>
            <div>
              <button aria-label="กลับไปเริ่มต้น" onClick={() => seek(0)}>
                <SkipBack size={17} />
              </button>
              <button
                className="play-button"
                aria-label={playing ? "หยุดชั่วคราว" : "เล่นเพลง"}
                disabled={!audioData}
                onClick={() => void playPause()}
              >
                {playing ? (
                  <Pause size={19} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
              <button
                className="text-button"
                title="ย้อน 3 วินาทีเพื่อฟังซ้ำ"
                onClick={() => seek(time - 3)}
              >
                −3s
              </button>
            </div>
            <label className="volume">
              <Headphones size={14} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                aria-label="ความดังเสียงตัวอย่าง"
                value={volume}
                onChange={(e) => setVolume(+e.target.value)}
              />
            </label>
          </div>
          <div className="preview-tip">
            <MousePointer2 size={13} />
            <span>
              เลือกท่อนร้อง → ฟังเพลง → กด I เริ่ม / O จบ
              หรือลากขอบบล็อกบนไทม์ไลน์
            </span>
          </div>
        </section>
        <aside className="properties">
          <div className="panel-title">
            <h2>ตั้งค่าท่อนร้อง</h2>
            <span className="tiny-label">PROPERTIES</span>
          </div>
          {current ? (
            <div className="property-content">
              <span className="eyebrow">
                SEGMENT{" "}
                {String(project.lyrics.indexOf(current) + 1).padStart(2, "0")}
              </span>
              <label>
                เนื้อเพลง
                <textarea
                  aria-label="แก้ไขท่อนร้อง"
                  value={current.text}
                  onChange={(e) =>
                    editSegment(current.id, { text: e.target.value })
                  }
                />
              </label>
              <label>
                ชื่อท่อน
                <input
                  value={current.section || ""}
                  placeholder="เช่น Chorus"
                  onChange={(e) =>
                    editSegment(current.id, { section: e.target.value })
                  }
                />
              </label>
              <div className="timing-fields">
                <label>
                  เริ่ม (วินาที)
                  <input
                    aria-label="เวลาเริ่ม"
                    type="number"
                    min="0"
                    step="0.001"
                    value={+current.start.toFixed(3)}
                    onChange={(e) =>
                      editSegment(current.id, {
                        start: +e.target.value,
                        source: "manual",
                      })
                    }
                  />
                </label>
                <label>
                  จบ (วินาที)
                  <input
                    aria-label="เวลาจบ"
                    type="number"
                    min="0"
                    step="0.001"
                    value={+current.end.toFixed(3)}
                    onChange={(e) =>
                      editSegment(current.id, {
                        end: +e.target.value,
                        source: "manual",
                      })
                    }
                  />
                </label>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => stamp("start")}>
                  จับ IN <kbd>I</kbd>
                </button>
                <button className="secondary" onClick={() => stamp("end")}>
                  จับ OUT <kbd>O</kbd>
                </button>
              </div>
              <button
                className="secondary full"
                onClick={() => {
                  seek(Math.max(0, current.start - 1));
                  if (audio.current?.paused) void playPause();
                }}
              >
                <Headphones size={15} /> ฟังท่อนนี้
              </button>
              <div className={`timing-status ${current.source}`}>
                {current.source === "estimated"
                  ? "◌ เวลาประมาณ · ต้องตรวจฟัง"
                  : current.source === "imported"
                    ? "↗ เวลาอ้างอิงจากไฟล์เนื้อเพลง"
                    : current.source === "recognized"
                      ? "♫ เวลาจากการเทียบคำร้อง"
                      : "✓ เวลาที่ปรับด้วยตนเอง"}
              </div>
              {current.alignment ? (
                <>
                  <WordTimingEditor
                    key={current.id}
                    segment={current}
                    onChange={(alignment) =>
                      editSegment(current.id, { alignment })
                    }
                    onStamp={() => audio.current?.currentTime ?? 0}
                    onListen={(start, end) => {
                      seek(Math.max(0, start - 0.2));
                      auditionEnd.current = Math.min(
                        project.duration,
                        end + 0.2,
                      );
                      if (audio.current?.paused) void playPause();
                    }}
                  />
                  <button
                    className="primary full apply-line"
                    disabled={!lineCanApply(current.alignment)}
                    onClick={() => {
                      try {
                        editSegment(current.id, applyAlignment(current));
                        setNotice(
                          "ใช้เวลาคำกับท่อนนี้แล้ว ภาพตัวอย่างจะแสดงคำตามเวลา",
                        );
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    ใช้เวลารายคำกับท่อนนี้
                  </button>
                </>
              ) : (
                <button
                  className="secondary full"
                  onClick={() =>
                    editSegment(current.id, {
                      alignment: {
                        model: "กำหนดเอง",
                        language: "thai",
                        status: "proposed",
                        words: splitWords(current.text).map((w) =>
                          manualWord(w.text, w.from, w.to),
                        ),
                      },
                    })
                  }
                >
                  จับเวลารายคำด้วยตนเอง
                </button>
              )}
              <button
                className="danger text-button"
                onClick={() => {
                  commit((p) => ({
                    ...p,
                    lyrics: p.lyrics.filter((x) => x.id !== current.id),
                  }));
                  setSelected("");
                }}
              >
                <Trash2 size={14} /> ลบท่อนนี้
              </button>
            </div>
          ) : (
            <div className="empty-properties">
              <MousePointer2 size={27} />
              <p>เลือกท่อนร้อง</p>
              <small>
                คลิกเนื้อเพลงหรือบล็อกบนไทม์ไลน์
                <br />
                เพื่อแก้ไขข้อความและเวลา
              </small>
            </div>
          )}
          <div className="sync-box">
            <h3>
              <span className="pink-dot" /> จับเวลาตามเสียงร้อง
            </h3>
            <p>เล่นเพลง แล้วกด Space ทุกครั้งที่เริ่มร้องบรรทัดถัดไป</p>
            <button
              className={tap ? "primary full" : "secondary full"}
              disabled={!audioData || !project.lyrics.length}
              onClick={() => {
                setTap((v) => !v);
                if (!selected) setSelected(project.lyrics[0]?.id ?? "");
              }}
            >
              {tap ? "กำลังจับเวลา · ปิดโหมด" : "เปิดโหมดจับเวลาทีละท่อน"}
            </button>
            {tap && (
              <button className="primary full" onClick={tapNext}>
                จับท่อนถัดไป <kbd>Space</kbd>
              </button>
            )}
            <small>
              โหมดนี้ Space ใช้บันทึกเวลา
              <br />
              ใช้ปุ่ม ▶ เพื่อเล่นหรือหยุดเพลง
            </small>
          </div>
          <div className="offset-box">
            <label>
              เลื่อนเวลาทั้งเพลง (วินาที)
              <input
                aria-label="ค่าเลื่อนเวลาทั้งเพลง"
                type="number"
                step="0.1"
                value={offset}
                onChange={(e) => setOffset(+e.target.value)}
              />
            </label>
            <button
              className="secondary full"
              disabled={!project.lyrics.length || !offset}
              onClick={() => {
                if (project.lyrics.some((x) => x.start + offset < 0)) {
                  setError("เลื่อนแล้วเวลาเริ่มติดลบ กรุณาลดค่าเลื่อน");
                  return;
                }
                commit((p) => ({
                  ...p,
                  lyrics: p.lyrics.map((x) => ({
                    ...shiftSegment(x, offset),
                    source: "manual",
                  })),
                }));
                setOffset(0);
              }}
            >
              ใช้ค่าเลื่อนเวลา
            </button>
          </div>
        </aside>
      </main>
      <section className="timeline-panel">
        <div className="timeline-header">
          <div>
            <AudioLines size={16} />
            <b>ไทม์ไลน์</b>
            <span>{project.lyrics.length} ท่อนร้อง</span>
          </div>
          <div>
            <span className="legend">
              <i /> เพลง <i /> เนื้อร้อง
            </span>
            <label>
              ซูม
              <input
                aria-label="ซูมไทม์ไลน์"
                type="range"
                min="1"
                max="8"
                step="0.5"
                value={zoom}
                onChange={(e) => setZoom(+e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="timeline-body">
          <div className="track-labels">
            <div>เวลา</div>
            <div>
              <Music2 size={14} /> เพลงต้นฉบับ
            </div>
            <div>
              <FileText size={14} /> เนื้อร้อง
            </div>
          </div>
          <div className="timeline-scroll">
            <div
              ref={timeline}
              className="tracks"
              style={{ width: `${zoom * 100}%` }}
            >
              <div
                className="ruler"
                onClick={(e) => {
                  const r = timeline.current!.getBoundingClientRect();
                  seek(
                    ((e.clientX - r.left) / r.width) *
                      (project.duration || 120),
                  );
                }}
              >
                {Array.from({ length: 13 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / 12) * 100}%` }}>
                    {timecode((i / 12) * (project.duration || 120)).slice(0, 5)}
                  </span>
                ))}
              </div>
              <div
                className="wave-track"
                onClick={(e) => {
                  const r = timeline.current!.getBoundingClientRect();
                  seek(
                    ((e.clientX - r.left) / r.width) *
                      (project.duration || 120),
                  );
                }}
              >
                <canvas ref={wave} aria-label="waveform ของเสียง" />
                {!audioData && <span>อัปโหลดเพลงเพื่อแสดง waveform</span>}
              </div>
              <div className="lyric-track">
                {project.lyrics.map((s, i) => (
                  <div
                    key={s.id}
                    className={`clip ${s.source} ${s.id === selected ? "selected" : ""}`}
                    style={{
                      left: `${(s.start / (project.duration || 120)) * 100}%`,
                      width: `${Math.max(0.1, ((s.end - s.start) / (project.duration || 120)) * 100)}%`,
                    }}
                    onPointerDown={(e) => dragClip(e, s)}
                    title={`${i + 1}. ${s.text} · ${timecode(s.start)}–${timecode(s.end)}`}
                  >
                    <span
                      className="handle left"
                      onPointerDown={(e) => dragClip(e, s, "start")}
                    />
                    <span className="clip-text">{s.text}</span>
                    {s.alignment?.status === "applied" &&
                      s.alignment.words.map((word, index) =>
                        word.start !== null && word.end !== null ? (
                          <span
                            key={index}
                            className="word-tick"
                            style={{
                              left: `${((word.start - s.start) / (s.end - s.start)) * 100}%`,
                              width: `${((word.end - word.start) / (s.end - s.start)) * 100}%`,
                            }}
                          />
                        ) : null,
                      )}
                    <span
                      className="handle right"
                      onPointerDown={(e) => dragClip(e, s, "end")}
                    />
                  </div>
                ))}
              </div>
              <div
                className="playhead"
                style={{ left: `${(time / (project.duration || 120)) * 100}%` }}
              >
                <span />
              </div>
            </div>
          </div>
        </div>
        <footer className="timeline-footer">
          <span>
            <i className="live-dot" /> LOCAL FIRST · ไม่อัปโหลดไฟล์เพลง
          </span>
          <span>
            Space เล่น/หยุด <kbd>I</kbd> เริ่ม <kbd>O</kbd> จบ · ความละเอียด 1
            ms
          </span>
          <span>
            BK STUDIO <b>1.1</b>
          </span>
        </footer>
      </section>
      {(busy || !loaded) && (
        <div className="modal-backdrop">
          <div className="dialog busy-dialog">
            <AudioLines className="pulse" size={30} />
            <h2>{busy || "กำลังเปิดสตูดิโอ…"}</h2>
            <p>ไฟล์ของคุณจะถูกประมวลผลบนอุปกรณ์นี้</p>
          </div>
        </div>
      )}
      {help && (
        <div className="modal-backdrop">
          <section className="dialog">
            <button
              className="close"
              aria-label="ปิดวิธีใช้งาน"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">GET STARTED</span>
            <h2>จากเพลงของคุณ สู่เรื่องราวบนจอ</h2>
            <ol className="help-steps">
              <li>
                เพิ่มเพลง MP3 หรือ WAV แล้ววางเนื้อร้องทีละบรรทัด หรือนำเข้า LRC
                / SRT / VTT
              </li>
              <li>
                เลือกท่อนและเล่นเพลง กด I เพื่อจับเวลาเริ่ม กด O เพื่อจบ
                หรือลากบล็อกบนไทม์ไลน์
              </li>
              <li>
                โหมดจับเวลาทีละท่อน: กด Space ตอนเริ่มแต่ละบรรทัด
                จากนั้นตรวจฟังและแก้เวลาในช่องวินาที
              </li>
              <li>
                เลือกธีมและสัดส่วน แล้วส่งออก WebM 720p 30fps พร้อมเสียง
                ใช้เวลาประมาณความยาวเพลงจริง
              </li>
            </ol>
            <p className="note">
              แท็บวิเคราะห์มี Whisper ถอดเสียงในเครื่องพร้อมเวลา
              แล้วเทียบตัวอักษรกับเนื้อเพลง
              กดท่อนที่ต้องตรวจเพื่อฟังและแก้เวลารายคำ กดใช้เวลาหลังตรวจแล้ว
              ระบบนี้ยังไม่ใช่ Forced Alignment และไม่รับประกันตรง 100%
              บันทึกอัตโนมัติด้วย IndexedDB เฉพาะเบราว์เซอร์นี้ JSON ไม่รวมเพลง
              ต้องแนบเพลงอีกครั้งเมื่อย้ายเครื่อง
            </p>
            <p className="note">
              รุ่นนี้ยังไม่มีแปลภาษา MP4 4K เอฟเฟกต์ 3D หรือหลายแทร็ก แนะนำ
              Chrome / Edge บนคอมพิวเตอร์ เก็บแท็บไว้ด้านหน้าขณะส่งออก
            </p>
            <button className="primary full" onClick={() => setHelp(false)}>
              เริ่มสร้างสรรค์
            </button>
          </section>
        </div>
      )}
      {(exporting || result) && (
        <div className="modal-backdrop">
          <section className="dialog export-dialog">
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2>{exporting ? "กำลังสร้างวิดีโอของคุณ" : "วิดีโอพร้อมแล้ว"}</h2>
            {exporting ? (
              <>
                <div className="export-progress">
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
                <b>{Math.floor(progress * 100)}%</b>
                <p>
                  WebM · 720p · 30fps · รวมเสียงเพลง
                  <br />
                  ใช้เวลาประมาณความยาวเพลง เก็บแท็บนี้ไว้ด้านหน้า
                </p>
                <button
                  className="secondary full"
                  onClick={() => abort.current?.abort()}
                >
                  ยกเลิกการส่งออก
                </button>
              </>
            ) : (
              <>
                <video controls src={resultUrl} className="result-video" />
                <p>
                  {(result!.size / 1024 / 1024).toFixed(1)} MB · WebM พร้อมเสียง
                </p>
                <button
                  className="primary full"
                  onClick={() => download(result!, `${project.name}.webm`)}
                >
                  <Download size={17} /> ดาวน์โหลดวิดีโอ
                </button>
                <button
                  className="text-button full"
                  onClick={() => setResult(null)}
                >
                  กลับไปแก้ไข
                </button>
              </>
            )}
          </section>
        </div>
      )}
      <span hidden>{videoMime()}</span>
    </div>
  );
}
