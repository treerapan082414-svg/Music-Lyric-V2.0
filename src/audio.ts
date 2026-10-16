export type AudioData = {
  buffer: AudioBuffer;
  energy: number[];
  peaks: number[];
};
export async function decodeAudio(file: Blob): Promise<AudioData> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    const energy: number[] = [];
    const peaks: number[] = [];
    const size = Math.max(1, Math.ceil(buffer.length / 1200));
    for (let start = 0; start < buffer.length; start += size) {
      let sum = 0,
        peak = 0,
        count = 0;
      for (let i = start; i < Math.min(start + size, buffer.length); i += 8) {
        const value =
          channels.reduce((a, c) => a + Math.abs(c[i]), 0) / channels.length;
        sum += value * value;
        peak = Math.max(peak, value);
        count++;
      }
      energy.push(Math.sqrt(sum / count));
      peaks.push(peak);
    }
    return { buffer, energy, peaks };
  } finally {
    await context.close();
  }
}
export async function resampleForAsr(
  buffer: AudioBuffer,
  from: number,
  to: number,
): Promise<Float32Array> {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to > buffer.duration + 0.01 ||
    to - from < 0.1
  )
    throw new Error("ช่วงเวลาวิเคราะห์ไม่ถูกต้อง");
  const ctx = new OfflineAudioContext(1, Math.ceil((to - from) * 16000), 16000);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, from, to - from);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}
