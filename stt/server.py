"""stt —— the instance's own speech-to-text: SenseVoice-Small (int8) on sherpa-onnx, CPU only.

POST /v1/audio/transcriptions  (multipart: file, optional model / language / response_format)
  -> {"text": "...", "language": "en", "duration": 3.2}
GET  /healthz                   -> {"status": "ok"}

The wire is the OpenAI transcription shape, so the backend's one adapter reaches this service and
any other OpenAI-compatible engine alike (docs/design/voice-input.md). Audio is decoded by ffmpeg
(the browser records webm/opus or mp4/aac) to 16 kHz mono float32, recognised, and the temp file
is deleted before the response — nothing is stored.

Ported from the design of skywolf123/sensevoice-asr (MIT): ffmpeg decode, marker stripping, a small
recognizer pool (sherpa-onnx recognizers are not thread-safe), the model baked into the image. Chat
clips are short, so its long-audio segmentation is left out: a clip over MAX_SECONDS is refused.
"""

from __future__ import annotations

import logging
import os
import queue
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

SAMPLE_RATE = 16000
MODEL_DIR = Path(os.environ.get("STT_MODEL_DIR", "/models/sense-voice"))
NUM_THREADS = int(os.environ.get("STT_NUM_THREADS", "2"))
POOL_SIZE = int(os.environ.get("STT_POOL_SIZE", "1"))
MAX_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 90.0

# SenseVoice writes inline markers (<|zh|><|NEUTRAL|><|Speech|><|withitn|>); the transcript keeps words.
MARKER = re.compile(r"<\|[^|]*\|>")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stt")
app = FastAPI(title="standmeet-stt")

_free: "queue.Queue[sherpa_onnx.OfflineRecognizer]" = queue.Queue()


def _recognizer() -> "sherpa_onnx.OfflineRecognizer":
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(MODEL_DIR / "model.int8.onnx"),
        tokens=str(MODEL_DIR / "tokens.txt"),
        num_threads=NUM_THREADS,
        use_itn=True,
        language="auto",
        provider="cpu",
    )


@app.on_event("startup")
def _load() -> None:
    for _ in range(POOL_SIZE):
        _free.put(_recognizer())
    log.info("ready: %d recognizer(s), %d thread(s)", POOL_SIZE, NUM_THREADS)


def decode(path: str) -> np.ndarray:
    """Any container ffmpeg reads -> 16 kHz mono float32."""
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-acodec", "pcm_f32le",
         "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
    )
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        log.warning("ffmpeg could not decode the upload: %s", tail[-1] if tail else "no stderr")
        raise HTTPException(status_code=400, detail="the recording could not be read")
    return np.frombuffer(proc.stdout, dtype="<f4")


def recognise(samples: np.ndarray) -> tuple[str, str]:
    rec = _free.get()
    try:
        stream = rec.create_stream()
        stream.accept_waveform(SAMPLE_RATE, samples)
        rec.decode_stream(stream)
        result = stream.result
    finally:
        _free.put(rec)
    lang = (getattr(result, "lang", "") or "").replace("<|", "").replace("|>", "")
    return MARKER.sub("", result.text or "").strip(), lang


@app.post("/v1/audio/transcriptions")
def transcribe(
    file: UploadFile = File(...),
    model: str = Form("sensevoice"),
    language: str = Form(""),
    response_format: str = Form("json"),
) -> dict:
    # model / language / response_format: accepted for wire compatibility. SenseVoice detects the
    # language itself (and a visitor may mix two), and json is the only shape returned.
    _ = model, language, response_format
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="the recording is too large")
    with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "").suffix or ".bin") as tmp:
        tmp.write(data)
        tmp.flush()
        samples = decode(tmp.name)
    duration = len(samples) / SAMPLE_RATE
    if duration > MAX_SECONDS:
        raise HTTPException(status_code=413, detail="the recording is too long")
    text, lang = recognise(samples) if samples.size else ("", "")
    log.info("transcribed %.1fs -> %d chars (%s)", duration, len(text), lang or "-")
    return {"text": text, "language": lang, "duration": round(duration, 2)}


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}
