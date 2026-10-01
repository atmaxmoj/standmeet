# Voice input: speech to text on the instance's own infrastructure

Status: APPROVED 2026-10-01 (owner: "语音输入，你就做吧 … 记得语音处理是自己的 infra，做好业务解耦").

## What the owner asked

- 2026-09-30: "质量很好的 stt 模型，最好前端能跑". The survey found browser-only Whisper weak on
  Chinese (whisper-tiny zh CER ≈ 71%), no mixed-language speech, and 75–200 MB per visitor.
- 2026-09-30, decided: "服务器端转写吧" — the visitor's browser records, the instance transcribes.
- 2026-10-01: the transcription runs on the instance's own infrastructure, and the business code
  is decoupled from the engine.

## Decisions

1. **The engine is its own service.** A bundled `stt` container: sherpa-onnx (k2-fsa, Apache-2.0)
   running SenseVoice-Small int8 (zh / en / ja / ko / yue, mixed speech, ~228 MB unpacked), with
   ffmpeg to decode whatever the browser recorded (webm/opus, mp4/aac). CPU only, ~400 MB RAM.
   Audio never leaves the owner's server and is never stored: the upload lives in a temp file for
   the length of one request.
2. **The wire between the instance and the engine is the OpenAI transcription shape.**
   `POST /v1/audio/transcriptions` (multipart `file`, `model`, `language`) → `{"text": …}`. The
   backend holds one adapter for that shape, behind a `Transcriber` port. Swapping the engine —
   another sherpa model, a Whisper server, a hosted provider — changes the URL, not the code.
3. **The business side never sees audio formats or models.** The chat composer asks the instance
   "turn this recording into text"; the instance answers with text or a human sentence. The SDK
   holds the recorder; the backend holds the session check, the size and length caps, the rate
   limit and the call; the `stt` service holds the model.
4. **The text goes into the input box, not straight into the conversation.** The visitor reads
   it, fixes it, and sends it. A misheard word never becomes a question the agent answers.

Reference: the service ports the design of skywolf123/sensevoice-asr (MIT): ffmpeg decodes to
16 kHz mono float32, SenseVoice's inline markers (`<|zh|><|NEUTRAL|>…`) are stripped, a small
recognizer pool (sherpa-onnx recognizers are not thread-safe), the model is baked into the image
at build time. Chat clips are short, so its long-audio segmentation is left out.

## Mechanism

```
browser (SDK Composer)                instance backend                     stt service
 mic button → MediaRecorder  ──POST /api/v1/transcribe──────────────▶  session + caps + rate
 (webm/opus, ≤ 60 s)              multipart "audio"                       limit, Transcriber port
                                                     ──POST /v1/audio/transcriptions──▶ ffmpeg →
                                                                                       SenseVoice
 text lands in the input  ◀──────── {"text"} ──────────────────────────◀── {"text"}
```

- **Route.** `POST /api/v1/transcribe`, multipart field `audio`, under the visitor's own session
  (the same grant that lets them chat; a codeless public visitor has a public session). Caps:
  2 MiB of upload and 90 s of audio (the composer stops recording at 60 s); 20 calls per minute
  per IP in the central public rate table. A refusal is a display error with a sentence.
- **Availability.** `GET /api/v1/voice` → `{available}`; the backend probes `stt` (`GET /healthz`)
  at most once a minute. The composer asks once when it mounts and shows the mic only when the
  answer is true. An instance upgraded from an older template has no `stt` service yet: the mic
  simply does not appear until the owner adds it (docs/deploy.md says how).
- **Wiring.** `STT_URL` (default `http://stt:8080`) is deployment wiring, like the database URL,
  never an owner setting. It is set by the bundled template; nobody edits it.
- **SDK.** `Composer` gains a mic button: press to start, press again to stop (no hold-to-talk —
  a phone's long-press opens menus). While recording, a timer and a stop control; while
  transcribing, a throbber. The result is appended to the input. Errors: microphone permission
  denied, nothing heard, too long, service busy — each one sentence, in all nine locales.
- **Image.** `standmeet-stt`, built from `stt/` by the release pipeline like the other images
  (CI matrix + `make release-push-one SVC=stt`), multi-arch.

## Acceptance (each red on the code of 2026-10-01)

1. `voice-input.spec.ts` (Playwright, real stack with the real `stt` service): Chromium with a fake
   microphone that plays a recorded English sentence; a visitor on a microsite's AgentWidget presses
   the mic, stops, and the input box holds the sentence's words; sending it gets an answer.
2. The same with a Chinese sentence: the input holds the Chinese words.
3. A recording over the cap is refused with the sentence, and the input keeps what was typed.
4. A request without a session is refused (401); the stt service is never called.
5. With `stt` stopped, `GET /api/v1/voice` says `available: false` and the mic is not offered;
   the chat works.

## Not in this change

- Streaming partial results while speaking (needs a streaming model and a socket).
- The owner choosing another engine in the UI. The port allows it; nobody asked for it.
- Voice output (text to speech).
