# Voice input: speech to text in the backend

Status: APPROVED 2026-10-01 (owner: "语音输入，你就做吧 … 记得语音处理是自己的 infra，做好业务解耦";
then, on a first version that ran the engine as a separate service: "是后端代码里面 infra 啊").

## What the owner asked

- 2026-09-30: "质量很好的 stt 模型，最好前端能跑". The survey found browser-only Whisper weak on
  Chinese (whisper-tiny zh CER ≈ 71%), no mixed-language speech, and 75–200 MB per visitor.
- 2026-09-30, decided: "服务器端转写吧" — the visitor's browser records, the instance transcribes.
- 2026-10-01: the engine lives in the backend code's own infra layer (`internal/infra/stt`), and the
  business code is decoupled from it. No separate service, no separate image: an upgrade brings it.

## Decisions

1. **The engine is a backend infra package.** `internal/infra/stt` runs SenseVoice-Small int8
   (zh / en / ja / ko / yue, mixed speech) in the backend process through sherpa-onnx's Go binding
   (cgo). The model (~240 MB) is baked into the backend image at `/srv/stt`; the recognizer is built
   on first use and decodes serially (sherpa-onnx recognizers are not thread-safe; a chat clip
   decodes in under a second). Audio is not stored: the samples live for one call.
2. **The business side calls one function.** The public route hands `Transcribe(ctx, filename,
   contentType, audio) (text, error)` a recording; it knows nothing of models or audio formats.
   Swapping the engine changes this package only.
3. **The browser sends 16 kHz mono 16-bit WAV.** The SDK decodes its own recording (whatever the
   browser recorded: webm/opus, mp4/aac) with the Web Audio API and resamples it, so the backend
   needs no ffmpeg. Anything else is refused with a sentence.
4. **The text goes into the input box, not into the conversation.** The visitor reads it, fixes it,
   and sends it.

Cost, stated plainly: the backend image moved from alpine to Debian (`node:22-bookworm-slim`), since
the engine's prebuilt libraries need glibc, and grew by the model and onnxruntime (~270 MB). The
build compiles with cgo; the arch that is not the build machine's own uses a cross C compiler, so
nothing runs under QEMU. The image keeps `wget` because every deployed compose health-checks the
backend with it.

## Mechanism

```
browser (SDK Composer)                       backend
 mic → MediaRecorder → Web Audio decode   POST /api/v1/transcribe (visitor session, multipart "audio")
 → 16 kHz mono PCM16 WAV                  → caps (2 MiB, 90 s) + rate limit → internal/infra/stt
 text lands in the input  ◀── {"text"} ──  → SenseVoice in process
```

- **Route.** `POST /api/v1/transcribe` under the visitor's own session; 20 calls per minute per IP in
  the central public rate table; refusals are display errors with a sentence.
- **Availability.** `GET /api/v1/voice` → `{available}`: true when the model is in the image. The
  composer offers the mic only then (and only where the browser can record).
- **SDK.** The composer's mic: press to record, press again to stop (no hold-to-talk — a phone's
  long-press opens menus); a timer while recording, a line while transcribing; one sentence per
  failure (microphone blocked, nothing heard, too long, busy, unreadable), in all nine locales.

## Acceptance

1. `voice-input.spec.ts` (Playwright, real stack, the real model in the backend): Chromium with a
   fake microphone playing a recorded English sentence; a visitor presses the mic, stops, and the
   input box holds the sentence's words; sending it gets an answer.
2. A Chinese recording sent to the route comes back as Chinese words.
3. A recording over the cap is refused with the sentence.
4. A request without a session is refused (401).
5. `go test -tags sttlive ./internal/infra/stt/` runs the engine on both recordings with the model
   on disk (not part of the default unit run: the model is in the image, not the repo).

## Not in this change

- Streaming partial results while speaking (needs a streaming model and a socket).
- Voice output (text to speech).
