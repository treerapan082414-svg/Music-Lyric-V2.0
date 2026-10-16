# Validation for 1.1

Automated unit checks cover Thai combining marks, uneven observed times, missing words, shared timestamps, repeated choruses, long silence, invalid transcript files, project persistence schema and streaming WebM metadata. Browser integration covers MP3/WAV, timeline editing, imported word timestamps, explicit application, word highlight pixels, audition, save/reload, JSON, cancellation, encoder failures and audiovisual WebM in both aspect ratios. Imported transcript fixtures do not exercise the ASR model.

Real model inference was separately exercised in production-build Chromium using Transformers.js 3.8.1, quantized `_timestamped` Whisper models and self-hosted WASM, without mocks:

- English JFK speech (`Xenova/transformers.js-docs/jfk.wav`), base: 22/22 lyric words matched text exactly, with uneven word intervals returned by the model.
- Thai FLEURS validation speech (`th_th/10039824435567831360.wav`, 8.22 seconds), small: 19/23 expected words matched text exactly. Nine words still required review, counting both textual differences and shared/coarse intervals. This is a count from one speech sample, not a timing accuracy score or a singing benchmark. Base performed worse on this sample.
- Model inference, including model loading and text matching, took about 48 seconds for the Thai small run with cached downloads in this development machine. User devices and full songs may take much longer.

An optional reusable check is available after building and starting the preview server:

```sh
node scripts/check-asr.mjs /path/to/audio.wav /path/to/reference.txt thai small
```

It downloads a real model on demand, runs the public UI, exports the resulting JSON to `/tmp/bk-artifacts/asr-result.json`, and captures a screenshot. Chromium and network access to Hugging Face are required. Use `ASR_TEST_URL` for a deployed site and `CHROMIUM_PATH` to override the executable. No fixture audio is committed. FLEURS attribution/license and source links are in README.md.

Whisper ASR plus text sequence matching is not forced alignment. No song-specific accuracy claim is supported until the actual song and reference lyrics are tested. Wrong, missing, shared and manually corrected timings must remain distinguishable.
