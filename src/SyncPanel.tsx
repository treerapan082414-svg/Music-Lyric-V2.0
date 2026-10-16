import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Headphones, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  applyAlignment,
  lineCanApply,
  parseTranscript,
  type Transcript,
  type AlignedWord,
} from "./alignment";
import { decodeAudio, resampleForAsr, type AudioData } from "./audio";
import { timecode, type Project, type Segment } from "./model";

type Props = {
  project: Project;
  audioData: AudioData | null;
  onChange: (p: Project) => void;
  onSelect: (s: Segment) => void;
  onBusy: (v: boolean) => void;
  onError: (e: unknown) => void;
  onNotice: (text: string) => void;
};
export default function SyncPanel({
  project,
  audioData,
  onChange,
  onSelect,
  onBusy,
  onError,
  onNotice,
}: Props) {
  const [language, setLanguage] = useState("thai");
  const [model, setModel] = useState("small");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [stem, setStem] = useState<File | null>(null);
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(30);
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );
  function stop() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setWorking(false);
    onBusy(false);
  }
  function complete(lyrics: Segment[], transcript: Transcript) {
    onChange({ ...project, lyrics, transcript });
    onNotice(
      "เทียบคำแล้ว — ตรวจคำสีเหลือง/แดงและฟังเวลาก่อนกดใช้ ไม่เปลี่ยนเนื้อเพลงต้นฉบับ",
    );
  }
  async function run(imported?: Transcript) {
    if (!audioData) {
      onError(new Error("เพิ่มเพลงก่อนตรวจคำร้อง"));
      return;
    }
    if (!project.lyrics.length) {
      onError(new Error("ใส่เนื้อเพลงก่อนตรวจคำร้อง"));
      return;
    }
    const ticket = ++generation.current;
    setWorking(true);
    onBusy(true);
    setProgress("เตรียมเสียงสำหรับตรวจคำร้อง…");
    try {
      let samples: Float32Array | undefined;
      let offset = 0;
      if (!imported) {
        const buffer = stem
          ? (await decodeAudio(stem)).buffer
          : audioData.buffer;
        if (Math.abs(buffer.duration - audioData.buffer.duration) > 1)
          throw new Error(
            "แทร็กเสียงร้องต้องยาวเท่าเพลงต้นฉบับและคงช่วงเงียบไว้ เพื่อไม่ให้เวลาเหลื่อม",
          );
        offset = range ? from : 0;
        const end = range ? Math.min(to, buffer.duration) : buffer.duration;
        if (end - offset > 600)
          throw new Error("กรุณาวิเคราะห์ทีละช่วงไม่เกิน 10 นาที");
        samples = await resampleForAsr(buffer, offset, end);
      }
      if (ticket !== generation.current) return;
      // Import uses the same matcher but never invokes/downloads an ASR model.
      const instance = new Worker(new URL("./asr.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent) => {
        if (ticket !== generation.current) return;
        const data = event.data;
        if (data.status === "progress") setProgress(data.message);
        if (data.status === "error") {
          stop();
          onError(
            new Error(
              `ตรวจคำร้องไม่สำเร็จ: ${data.message} หากดาวน์โหลดโมเดลไม่ได้ ให้ตรวจอินเทอร์เน็ตหรือใช้ JSON ถอดเสียงรายคำ`,
            ),
          );
        }
        if (data.status === "done") {
          stop();
          complete(data.lyrics, data.transcript);
        }
      };
      instance.onerror = () => {
        stop();
        onError(
          new Error(
            "ตัวประมวลผลเสียงหยุดทำงาน อุปกรณ์อาจมี RAM ไม่พอ ลอง tiny หรือวิเคราะห์ช่วงสั้นลง",
          ),
        );
      };
      instance.postMessage(
        {
          samples,
          language,
          model,
          offset,
          duration: project.duration,
          lyrics: project.lyrics,
          transcript: imported,
          audioFingerprint: project.audioFingerprint,
          runtimeBase: new URL(
            `${import.meta.env.BASE_URL}onnx/`,
            document.baseURI,
          ).href,
        },
        samples ? [samples.buffer] : [],
      );
    } catch (e) {
      if (ticket !== generation.current) return;
      stop();
      onError(e);
    }
  }
  const matches = project.lyrics.flatMap((s) => s.alignment?.words ?? []);
  const exact = matches.filter((w) => w.match === "exact").length;
  const uncertain = matches.filter(
    (w) => w.match === "missing" || w.match === "close" || w.shared,
  ).length;
  const safe = project.lyrics.filter(
    (s) =>
      s.alignment?.status === "proposed" &&
      lineCanApply(s.alignment) &&
      s.alignment.words.every((w) => w.match === "exact" && !w.shared),
  );
  return (
    <section className="sync-panel">
      <div className="sync-heading">
        <AudioLines size={19} />
        <div>
          <h3>ตรวจเสียงร้องกับเนื้อเพลง</h3>
          <small>ถอดเสียงจริง → เทียบตัวอักษร → ตรวจเวลารายคำ</small>
        </div>
        <span className="new-tag">ใหม่</span>
      </div>
      <p className="muted">
        Whisper ฟังเสียงในเครื่องแล้วจับคู่ตามลำดับเพลง
        เวลาที่ไม่พบจะเว้นไว้ให้แก้เอง
        เสียงดนตรีทับหรือเสียงประสานอาจทำให้ถอดผิด
      </p>
      <div className="sync-settings">
        <label>
          ภาษาเพลง
          <select
            aria-label="ภาษาเพลง"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {[
              ["thai", "ไทย"],
              ["english", "English"],
              ["korean", "한국어"],
              ["japanese", "日本語"],
              ["chinese", "中文"],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          โมเดล
          <select
            aria-label="โมเดลตรวจคำร้อง"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="tiny">tiny · เบาและเร็ว</option>
            <option value="base">base · สมดุล</option>
            <option value="small">small · แนะนำสำหรับไทย</option>
          </select>
        </label>
      </div>
      <label className="stem-input">
        <span className="note">
          small ให้ผลภาษาไทยดีกว่า base ในตัวอย่างที่ทดสอบ แต่ใช้ RAM
          มากและอาจใช้เวลาหลายเท่าของเพลง เลือก base/tiny หากเครื่องช้า
        </span>
        แทร็กเสียงร้องแยก (ถ้ามี)
        <input
          aria-label="แทร็กเสียงร้องแยก"
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && f.size > 150 * 1024 * 1024) {
              onError(new Error("แทร็กเสียงร้องใหญ่เกิน 150 MB"));
              return;
            }
            setStem(f ?? null);
          }}
        />
      </label>
      {stem && (
        <button className="text-button" onClick={() => setStem(null)}>
          ใช้เพลงต้นฉบับแทนแทร็กเสียงร้อง
        </button>
      )}
      <p className="note">
        แทร็ก Vocals ที่แยกจากเพลงและคงเวลาเดิมจะช่วยลดเสียงดนตรีรบกวน
        ต้องไม่มีการตัดช่วงเงียบออก
      </p>
      <label className="range-toggle">
        <input
          type="checkbox"
          checked={range}
          onChange={(e) => setRange(e.target.checked)}
        />{" "}
        ตรวจเฉพาะช่วงเวลา
      </label>
      {range && (
        <>
          <div className="timing-fields">
            <label>
              จากวินาที
              <input
                aria-label="เริ่มช่วงวิเคราะห์"
                type="number"
                min="0"
                step="0.1"
                value={from}
                onChange={(e) => setFrom(+e.target.value)}
              />
            </label>
            <label>
              ถึงวินาที
              <input
                aria-label="จบช่วงวิเคราะห์"
                type="number"
                min="0"
                step="0.1"
                value={to}
                onChange={(e) => setTo(+e.target.value)}
              />
            </label>
          </div>
          <p className="note">
            เลือกเนื้อเพลงเฉพาะช่วงนี้ก่อนตรวจ เพื่อให้จับคู่ลำดับได้ถูกต้อง
          </p>
        </>
      )}
      <button
        className="primary full"
        disabled={!audioData || !project.lyrics.length || working}
        onClick={() => void run()}
      >
        <AudioLines size={16} /> ฟังเสียงและเทียบคำร้อง
      </button>
      <p className="note">
        ครั้งแรกดาวน์โหลดโมเดลจาก Hugging Face ขนาดหลายสิบถึงหลายร้อย MB
        เก็บแคชได้ ไม่ส่งเพลงออกจากอุปกรณ์ ใช้ CPU/RAM และอาจช้ากว่าเพลงจริง
      </p>
      <input
        ref={file}
        type="file"
        hidden
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 10 * 1024 * 1024)
              throw new Error("JSON ใหญ่เกิน 10 MB");
            const raw = JSON.parse(await f.text());
            const words = parseTranscript(raw, project.duration);
            void run({
              model: "ไฟล์ถอดเสียงภายนอก",
              language,
              text: words.map((w) => w.text).join(" "),
              words,
              audioFingerprint: project.audioFingerprint,
            });
          } catch (e) {
            onError(e);
          }
        }}
      />
      <button
        className="secondary full"
        disabled={!audioData || !project.lyrics.length}
        onClick={() => file.current?.click()}
      >
        <Upload size={14} /> นำเข้า JSON ถอดเสียงรายคำ
      </button>
      {project.transcript && (
        <>
          <details className="transcript-details">
            <summary>
              ข้อความที่ได้ยินจริง · {project.transcript.words.length} ช่วงคำ
            </summary>
            <p>{project.transcript.text}</p>
            <small>{project.transcript.model}</small>
          </details>
          <button
            className="text-button full"
            onClick={() => void run(project.transcript)}
          >
            เทียบผลถอดเสียงเดิมกับเนื้อเพลงอีกครั้ง
          </button>
        </>
      )}
      {matches.length > 0 && (
        <>
          <div className="match-stats">
            <span>
              <b>
                {exact}/{matches.length}
              </b>{" "}
              ตรงอักษร
            </span>
            <span>
              <b>{uncertain}</b> ต้องตรวจ
            </span>
          </div>
          <p className="note">
            “ตรงอักษร” วัดข้อความที่ถอดได้ ไม่ใช่คะแนนความแม่นยำของเวลา
            กลุ่มที่ใช้เวลาเดียวกันยังไม่ใช่เวลารายคำอิสระ
          </p>
          <button
            className="secondary full"
            disabled={!safe.length}
            onClick={() => {
              const ids = new Set(safe.map((s) => s.id));
              onChange({
                ...project,
                lyrics: project.lyrics.map((s) =>
                  ids.has(s.id) ? applyAlignment(s) : s,
                ),
              });
              onNotice(
                `ใช้เวลา ${safe.length} ท่อนแล้ว ท่อนที่ยังไม่ชัดเจนคงไว้ให้ตรวจแก้`,
              );
            }}
          >
            <Check size={15} /> ใช้เวลาท่อนที่ตรงชัดเจน ({safe.length})
          </button>
          <div className="alignment-results">
            {project.lyrics.map(
              (s, i) =>
                s.alignment && (
                  <button
                    key={s.id}
                    className="alignment-result"
                    onClick={() => onSelect(s)}
                  >
                    <div>
                      <b>ท่อน {i + 1}</b>
                      <span>
                        {s.alignment.status === "applied"
                          ? "ใช้เวลาแล้ว"
                          : "รอตรวจและใช้เวลา"}
                      </span>
                    </div>
                    <p>{s.text}</p>
                    <div className="word-chips">
                      {s.alignment.words.map((w, j) => (
                        <span className={`word-chip ${w.match}`} key={j}>
                          {w.text}
                          {w.shared ? " ≈" : ""}
                        </span>
                      ))}
                    </div>
                    {s.alignment.warning && (
                      <small className="warning">{s.alignment.warning}</small>
                    )}
                    <small>คลิกเพื่อตรวจสิ่งที่ได้ยินและแก้เวลารายคำ →</small>
                  </button>
                ),
            )}
          </div>
        </>
      )}
      {working &&
        createPortal(
          <div className="modal-backdrop">
            <section
              className="dialog sync-progress"
              role="dialog"
              aria-modal="true"
              aria-label="กำลังตรวจคำร้อง"
            >
              <AudioLines className="pulse" size={32} />
              <h2>กำลังตรวจเสียงร้องจริง</h2>
              <p role="status">{progress}</p>
              <p className="note">
                ไม่ส่งเพลงไปเซิร์ฟเวอร์ เก็บแท็บไว้และเผื่อเวลาประมวลผล
                โดยเฉพาะเพลงยาว
              </p>
              <button
                className="secondary full"
                onClick={() => {
                  stop();
                  onNotice(
                    "ยกเลิกการตรวจคำร้องแล้ว เนื้อเพลงและเวลาเดิมยังอยู่",
                  );
                }}
              >
                <X size={16} /> ยกเลิกการตรวจคำร้อง
              </button>
            </section>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function WordTimingEditor({
  segment,
  onChange,
  onListen,
  onStamp,
}: {
  segment: Segment;
  onChange: (alignment: NonNullable<Segment["alignment"]>) => void;
  onListen: (start: number, end: number) => void;
  onStamp: () => number;
}) {
  const [selected, setSelected] = useState(0);
  const a = segment.alignment;
  if (!a) return null;
  const index = Math.min(selected, a.words.length - 1);
  const word = a.words[index];
  function update(patch: Partial<AlignedWord>) {
    if (!a) return;
    onChange({
      ...a,
      status: "proposed",
      warning: undefined,
      words: a.words.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    });
  }
  return (
    <section className="word-editor">
      <h3>ตรวจคำที่ร้องและเวลารายคำ</h3>
      <div className="word-chips">
        {a.words.map((w, i) => (
          <button
            key={i}
            className={`word-chip ${w.match} ${i === index ? "selected" : ""}`}
            onClick={() => setSelected(i)}
          >
            {w.text}
          </button>
        ))}
      </div>
      {word && (
        <>
          <div className="word-comparison">
            <span>
              เนื้อเพลง <b>{word.text}</b>
            </span>
            <span>
              ได้ยิน <b>{word.heard || "หาไม่พบในเสียงถอด"}</b>
            </span>
          </div>
          <p className={`word-status ${word.match}`}>
            {word.match === "exact"
              ? "ตัวอักษรตรงกัน"
              : word.match === "close"
                ? "ข้อความใกล้เคียง ต้องฟังยืนยัน"
                : word.match === "manual"
                  ? "กำหนดเวลาด้วยตนเอง"
                  : "ยังจับคู่คำนี้ไม่ได้"}
            {word.shared ? " · ใช้เวลาร่วมกับกลุ่มคำ" : ""}
          </p>
          <div className="timing-fields">
            <label>
              IN คำ (วินาที)
              <input
                aria-label="เวลาเริ่มคำ"
                type="number"
                min="0"
                step="0.001"
                value={word.start === null ? "" : +word.start.toFixed(3)}
                onChange={(e) =>
                  update({
                    start: e.target.value === "" ? null : +e.target.value,
                    match: "manual",
                    shared: false,
                  })
                }
              />
            </label>
            <label>
              OUT คำ (วินาที)
              <input
                aria-label="เวลาจบคำ"
                type="number"
                min="0"
                step="0.001"
                value={word.end === null ? "" : +word.end.toFixed(3)}
                onChange={(e) =>
                  update({
                    end: e.target.value === "" ? null : +e.target.value,
                    match: "manual",
                    shared: false,
                  })
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                update({ start: onStamp(), match: "manual", shared: false })
              }
            >
              จับ IN คำ
            </button>
            <button
              className="secondary"
              onClick={() =>
                update({ end: onStamp(), match: "manual", shared: false })
              }
            >
              จับ OUT คำ
            </button>
          </div>
          <button
            className="secondary full"
            disabled={
              word.start === null || word.end === null || word.end <= word.start
            }
            onClick={() => onListen(word.start!, word.end!)}
          >
            <Headphones size={14} /> ฟังเฉพาะคำนี้
          </button>
        </>
      )}
      <p className="note">
        คำที่หาไม่พบไม่มีเวลาที่แต่งขึ้น คลิกแต่ละคำ ฟังและจับ IN/OUT
        ก่อนใช้เวลาให้ท่อนนี้
      </p>
      {!lineCanApply(a) && (
        <p className="note warning">
          ยังใช้เวลาไม่ได้: กำหนด IN/OUT ให้ครบ เรียงตามลำดับและไม่ซ้อนกัน
          หรือฟังแก้ช่วงที่ระบบแจ้งเตือน
        </p>
      )}
    </section>
  );
}
