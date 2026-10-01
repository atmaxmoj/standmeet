# standmeet-stt —— the instance's own speech-to-text (docs/design/voice-input.md).
# SenseVoice-Small int8 on sherpa-onnx, CPU only. ffmpeg decodes the browser's recording; bzip2
# unpacks the model. The sherpa-onnx wheel bundles its own onnxruntime.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The model is baked in at build time: the container starts with zero downloads and works offline.
# zh / en / ja / ko / yue, ~228 MB unpacked.
ARG SENSEVOICE_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
RUN mkdir -p /models/sense-voice \
    && python -c "import urllib.request;urllib.request.urlretrieve('${SENSEVOICE_URL}', '/tmp/sv.tar.bz2')" \
    && tar -xjf /tmp/sv.tar.bz2 -C /models/sense-voice --strip-components=1 \
    && rm -rf /tmp/sv.tar.bz2 /models/sense-voice/test_wavs /models/sense-voice/model.onnx

COPY server.py .

LABEL org.opencontainers.image.source=https://github.com/atmaxmoj/standmeet
ENV STT_MODEL_DIR=/models/sense-voice STT_NUM_THREADS=2 STT_POOL_SIZE=1
EXPOSE 8080
USER nobody
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
