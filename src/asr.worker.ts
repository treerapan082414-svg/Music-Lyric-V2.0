import { alignLyrics, measuredChunks, type Transcript } from "./alignment";
import type { Segment } from "./model";
type Input = {
  samples?: Float32Array;
  language: string;
  model: string;
  runtimeBase: string;
  offset: number;
  duration: number;
  lyrics: Segment[];
  transcript?: Transcript;
  audioFingerprint?: string;
};
self.onmessage = async (event: MessageEvent<Input>) => {
  try {
    const input = event.data;
    let transcript = input.transcript;
    if (!transcript) {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      env.backends.onnx.wasm!.wasmPaths = input.runtimeBase;
      env.backends.onnx.wasm!.numThreads = 1;
      type Recognizer = {
        (
          audio: Float32Array,
          options: Record<string, unknown>,
        ): Promise<{
          text: string;
          chunks?: {
            text: string;
            timestamp: [number | null, number | null];
          }[];
        }>;
        dispose(): Promise<void>;
      };
      const create = pipeline as unknown as (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<Recognizer>;
      if (!["tiny", "base", "small"].includes(input.model))
        throw new Error("รุ่นโมเดลไม่ถูกต้อง");
      const model = `onnx-community/whisper-${input.model}_timestamped`;
      self.postMessage({
        status: "progress",
        message:
          "กำลังดาวน์โหลดโมเดลจาก Hugging Face ครั้งแรกอาจใช้เวลาหลายนาที",
      });
      const recognizer = await create("automatic-speech-recognition", model, {
        device: "wasm",
        dtype: "q8",
        progress_callback: (p: {
          status: string;
          file?: string;
          progress?: number;
        }) => {
          if (p.status === "progress")
            self.postMessage({
              status: "progress",
              message: `ดาวน์โหลด ${p.file?.split("/").pop() ?? "โมเดล"} · ${Math.floor(p.progress ?? 0)}%`,
            });
        },
      });
      try {
        self.postMessage({
          status: "progress",
          message:
            "กำลังฟังเสียงและหาตำแหน่งคำร้องจริง… อาจใช้เวลานานกว่าความยาวเพลง",
        });
        const output = await recognizer(input.samples!, {
          language: input.language,
          task: "transcribe",
          return_timestamps: "word",
          chunk_length_s: 25,
          stride_length_s: 4,
          force_full_sequences: false,
          chunk_callback: () =>
            self.postMessage({
              status: "progress",
              message: "ถอดเสียงแล้วหนึ่งช่วง กำลังฟังช่วงถัดไป…",
            }),
        });
        if (!output.chunks?.length)
          throw new Error(
            "โมเดลไม่คืนเวลาระดับคำ กรุณาลองรุ่นอื่นหรือใช้ไฟล์ถอดเสียงที่มี word timestamps",
          );
        const words = measuredChunks(
          output.chunks,
          input.offset,
          input.duration,
        );
        if (!words.length) throw new Error("ไม่พบคำร้องที่มีเวลาใช้งานได้");
        transcript = {
          model,
          language: input.language,
          text: output.text,
          words,
          audioFingerprint: input.audioFingerprint,
        };
      } finally {
        await recognizer.dispose();
      }
    }
    self.postMessage({
      status: "progress",
      message: "กำลังเทียบตัวอักษรและคำกับเนื้อเพลงตามลำดับ…",
    });
    const lyrics = alignLyrics(input.lyrics, transcript);
    self.postMessage({ status: "done", lyrics, transcript });
  } catch (e) {
    self.postMessage({
      status: "error",
      message: e instanceof Error ? e.message : "ถอดเสียงไม่สำเร็จ",
    });
  }
};
