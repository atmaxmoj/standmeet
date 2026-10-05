// voice-endpoint —— when the visitor has finished speaking. The mic's level is sampled while it
// records; once speech has been heard, a pause of PAUSE_MS ends the recording (owner 2026-10-02:
// "自动识别断句自行发送"). A recording that never hears speech ends after QUIET_MS.
//
// ponytail: a level threshold, not a voice-activity model. A loud room keeps it recording until
// the visitor presses the mic or the 60 s cap; add a VAD model if that bites.

const SAMPLE_MS = 100;
// PAUSE_MS —— a person thinking out loud stops to breathe and to find the next words; 1.2 s cut
// them off mid-question (owner 2026-10-04: "语音的间隔判断太短了，我说话都不敢喘气"). Three seconds
// of quiet means they are done; pressing the mic ends it sooner.
const PAUSE_MS = 3000;
const QUIET_MS = 8000;
// SPEECH_RMS —— the level a voice reaches at a laptop mic; room noise sits well below it.
const SPEECH_RMS = 0.02;
// SPEECH_FRAMES —— this many loud samples in a row count as speech, not a click or a cough.
const SPEECH_FRAMES = 3;

// watchForPause —— calls onEnd once (speech then a pause, or nothing heard at all). Returns the
// stop function; call it when the recording ends for any other reason.
export function watchForPause(stream: MediaStream, onEnd: () => void): () => void {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const started = Date.now();
  let loudRun = 0;
  let heard = false;
  let lastLoud = started;
  const stop = (): void => { clearInterval(tick); void ctx.close(); };
  const tick = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    const now = Date.now();
    loudRun = rms(buf) > SPEECH_RMS ? loudRun + 1 : 0;
    heard = heard || loudRun >= SPEECH_FRAMES;
    lastLoud = loudRun > 0 ? now : lastLoud;
    const ended = heard ? now - lastLoud >= PAUSE_MS : now - started >= QUIET_MS;
    if (ended) { stop(); onEnd(); }
  }, SAMPLE_MS);
  return stop;
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}
