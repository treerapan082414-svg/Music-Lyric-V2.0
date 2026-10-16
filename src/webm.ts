// Add Duration to MediaRecorder's streaming WebM without reparsing/re-encoding
// the unknown-sized Clusters. Rewriting those containers can invalidate nesting.
export async function finalizeWebm(
  blob: Blob,
  durationMs: number,
): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  function read(offset: number, id = false) {
    let length = 1;
    while (length <= 8 && !(bytes[offset] & (1 << (8 - length)))) length++;
    if (length > 8 || offset + length > bytes.length)
      throw new Error("WebM header ไม่ถูกต้อง");
    const marker = 1 << (8 - length);
    let value = id ? bytes[offset] : bytes[offset] & (marker - 1);
    let unknown = !id && (bytes[offset] & (marker - 1)) === marker - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[offset + i];
      unknown = unknown && bytes[offset + i] === 255;
    }
    return { length, value, unknown };
  }
  function element(offset: number) {
    const id = read(offset, true);
    const size = read(offset + id.length);
    return {
      id: id.value,
      size,
      data: offset + id.length + size.length,
      offset,
    };
  }
  const header = element(0);
  if (header.id !== 0x1a45dfa3) throw new Error("ไฟล์ไม่ใช่ WebM");
  const segment = element(header.data + header.size.value);
  if (segment.id !== 0x18538067) throw new Error("ไม่พบ WebM Segment");
  let info: ReturnType<typeof element> | undefined;
  for (let p = segment.data; p < bytes.length; ) {
    const el = element(p);
    if (el.id === 0x114d9b74)
      throw new Error("ไม่รองรับ WebM ที่มี SeekHead ในตัวส่งออกนี้");
    if (el.id === 0x1549a966) {
      info = el;
      break;
    }
    if (el.size.unknown) break;
    p = el.data + el.size.value;
  }
  if (!info || info.size.unknown) throw new Error("ไม่พบข้อมูลเวลา WebM");
  const infoEnd = info.data + info.size.value;
  let scale = 1000000;
  const parts: Uint8Array[] = [];
  for (let p = info.data; p < infoEnd; ) {
    const el = element(p);
    const end = el.data + el.size.value;
    if (el.size.unknown || end > infoEnd || end <= p)
      throw new Error("ข้อมูลเวลา WebM ไม่ถูกต้อง");
    if (el.id === 0x2ad7b1) {
      scale = 0;
      for (let i = el.data; i < end; i++) scale = scale * 256 + bytes[i];
    }
    if (el.id !== 0x4489) parts.push(bytes.slice(p, end));
    p = end;
  }
  if (!scale || !Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("ระยะเวลา WebM ไม่ถูกต้อง");
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(
    3,
    (durationMs * 1000000) / scale,
    false,
  );
  parts.push(duration);
  const payloadSize = parts.reduce((n, p) => n + p.length, 0);
  let length = 1;
  while (payloadSize >= 2 ** (7 * length) - 1) length++;
  const size = new Uint8Array(length);
  let rest = payloadSize;
  for (let i = length - 1; i >= 0; i--) {
    size[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  size[0] |= 1 << (8 - length);
  const prefix = bytes.slice(0, info.offset);
  // Retain streaming Segment semantics after the insertion changes file size.
  const sizeOffset = segment.offset + 4;
  prefix[sizeOffset] = (1 << (9 - segment.size.length)) - 1;
  for (let i = 1; i < segment.size.length; i++) prefix[sizeOffset + i] = 255;
  return new Blob(
    [
      prefix,
      new Uint8Array([0x15, 0x49, 0xa9, 0x66]),
      size,
      ...parts,
      bytes.slice(infoEnd),
    ],
    { type: blob.type },
  );
}
