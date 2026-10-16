import { activeSegment, type Project } from "./model";
import { finalizeWebm } from "./webm";
export function dimensions(ratio: string, height = 720): [number, number] {
  const [w, h] = ratio.split(":").map(Number);
  return [Math.round((height * w) / h / 2) * 2, height];
}
export function renderFrame(
  canvas: HTMLCanvasElement,
  project: Project,
  time: number,
  spectrum?: Uint8Array,
) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const s = project.style;
  ctx.fillStyle = s.background;
  ctx.fillRect(0, 0, w, h);
  if (s.theme !== "minimal") {
    const palettes: Record<string, string[]> = {
      midnight: ["#481c72", "#182d58"],
      aurora: ["#075747", "#284a85"],
      sunset: ["#853957", "#794b22"],
    };
    const colors = palettes[s.theme] ?? palettes.midnight;
    for (let i = 0; i < 2; i++) {
      const x = w * (i ? 0.77 : 0.24) + Math.sin(time * 0.15 + i) * w * 0.08;
      const y = h * (i ? 0.65 : 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.65);
      g.addColorStop(0, colors[i]);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = "#ffffff20";
    for (let i = 0; i < 45; i++) {
      const x = ((((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1) * w;
      const y = (i * 97.3 + time * 3) % h;
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff90";
  ctx.font = `500 ${Math.round(h * 0.021)}px sans-serif`;
  ctx.fillText(project.name, w / 2, h * 0.13, w * 0.85);
  const active = activeSegment(project.lyrics, time);
  if (active) {
    const fontSize = (s.fontSize * h) / 720;
    ctx.font = `700 ${fontSize}px sans-serif`;
    const lines: string[] = [];
    for (const raw of active.text.split("\n")) {
      let line = "";
      for (const part of new Intl.Segmenter("th", {
        granularity: "grapheme",
      }).segment(raw)) {
        if (ctx.measureText(line + part.segment).width > w * 0.84 && line) {
          lines.push(line);
          line = "";
        }
        line += part.segment;
      }
      lines.push(line);
    }
    const y = (h * s.position) / 100 - (lines.length - 1) * fontSize * 0.72;
    ctx.shadowColor = "#00000090";
    ctx.shadowBlur = 12;
    ctx.fillStyle = s.color;
    lines.forEach((line, i) =>
      ctx.fillText(line, w / 2, y + i * fontSize * 1.45),
    );
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.accent;
    ctx.fillRect(
      w * 0.46,
      y + lines.length * fontSize * 1.45 - fontSize * 0.9,
      w * 0.08,
      (3 * h) / 720,
    );
  } else {
    ctx.fillStyle = "#ffffff50";
    ctx.font = `400 ${h * 0.035}px sans-serif`;
    ctx.fillText(
      project.lyrics.length ? "♫" : "เพิ่มเพลงและเนื้อเพลงเพื่อเริ่มสร้าง",
      w / 2,
      h * 0.56,
      w * 0.85,
    );
  }
  if (s.visualizer && spectrum) {
    const count = 48;
    const bw = (w * 0.65) / count;
    ctx.fillStyle = s.accent;
    for (let i = 0; i < count; i++) {
      const value = spectrum[Math.floor((i * spectrum.length) / count)] / 255;
      const bh = Math.max(2, value * h * 0.12);
      ctx.globalAlpha = 0.4 + value * 0.6;
      ctx.fillRect(w * 0.175 + i * bw, h * 0.85 - bh, bw * 0.55, bh);
    }
    ctx.globalAlpha = 1;
  }
}
export const videoMime = () =>
  typeof MediaRecorder === "undefined"
    ? ""
    : ([
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m)) ?? "");
export async function exportVideo(
  canvas: HTMLCanvasElement,
  project: Project,
  buffer: AudioBuffer,
  onProgress: (n: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const mimeType = videoMime();
  if (!mimeType || !canvas.captureStream)
    throw new Error(
      "เบราว์เซอร์นี้ไม่รองรับการส่งออก WebM กรุณาใช้ Chrome หรือ Edge บนคอมพิวเตอร์",
    );
  const [w, h] = dimensions(project.style.ratio);
  canvas.width = w;
  canvas.height = h;
  const context = new AudioContext();
  const source = context.createBufferSource();
  source.buffer = buffer;
  const dest = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(dest);
  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5000000,
  });
  const chunks: Blob[] = [];
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let ended = false;
  try {
    await context.resume();
    if (signal.aborted) throw new DOMException("ยกเลิกแล้ว", "AbortError");
    return await new Promise<Blob>((resolve, reject) => {
      const abort = () => {
        ended = true;
        if (recorder.state !== "inactive") recorder.stop();
        reject(new DOMException("ยกเลิกแล้ว", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        ended = true;
        reject(new Error("Encoder ส่งออกไม่สำเร็จ"));
      };
      const recordingStart = context.currentTime;
      recorder.onstop = () => {
        signal.removeEventListener("abort", abort);
        if (!ended) {
          ended = true;
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) {
            reject(new Error("ไม่พบข้อมูลวิดีโอ"));
            return;
          }
          finalizeWebm(
            blob,
            (context.currentTime - recordingStart) * 1000,
          ).then((fixed) => {
            onProgress(1);
            resolve(fixed);
          }, reject);
        }
      };
      const base = context.currentTime + 0.03;
      const frame = () => {
        const t = Math.max(0, context.currentTime - base);
        analyser.getByteFrequencyData(spectrum);
        renderFrame(canvas, project, t, spectrum);
        onProgress(Math.min(t / buffer.duration, 0.999));
        if (!ended) raf = requestAnimationFrame(frame);
      };
      renderFrame(canvas, project, 0, spectrum);
      recorder.start(1000);
      source.start(base);
      frame();
      source.onended = () => {
        if (recorder.state === "recording") recorder.stop();
      };
    });
  } finally {
    ended = true;
    cancelAnimationFrame(raf);
    try {
      source.stop();
    } catch {}
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
  }
}
