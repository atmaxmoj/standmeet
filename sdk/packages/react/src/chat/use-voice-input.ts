// use-voice-input —— the composer's microphone (docs/design/voice-input.md). Press and speak; a
// pause ends the recording on its own (voice-endpoint.ts), or press again. The recording goes to
// the instance and the text comes back to onText, which sends it. The browser records whatever it
// can (webm/opus, or mp4/aac on Safari) and turns it into the 16 kHz WAV the instance reads
// (toWav16k).

import { useEffect, useRef, useState } from 'react';

import { transcribeRecording, voiceAvailable } from './api.js';
import { loadStoredSession } from './stored-session.js';
import { watchForPause } from './voice-endpoint.js';

// MAX_SECONDS —— a spoken question, not a dictation; the server refuses anything past 90 s anyway.
const MAX_SECONDS = 60;

export type VoiceState = 'idle' | 'recording' | 'transcribing';

// VoiceProblem —— which sentence to show (voice.<key> in the chat catalog), '' = none.
export type VoiceProblem = '' | 'denied' | 'nothing' | 'tooLong' | 'busy' | 'failed';

const PROBLEM_OF: Record<string, VoiceProblem> = {
  recording_too_long: 'tooLong',
  voice_busy: 'busy',
  voice_unavailable: 'busy',
  network: 'busy',
};

export interface VoiceInput {
  available: boolean;
  state: VoiceState;
  seconds: number;
  problem: VoiceProblem;
  toggle: () => void;
}

// useVoiceInput —— onText receives the transcript (the caller appends it to the input).
export function useVoiceInput(onText: (text: string) => void): VoiceInput {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<VoiceProblem>('');
  const rec = useRef<MediaRecorder | null>(null);
  // onTextRef —— the recording ends seconds after it started; it must hand its words to this
  // render's onText (the input as it is now), not the one captured when the mic was pressed.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => {
    let live = true;
    void voiceAvailable().then((on) => { if (live) setAvailable(on && canRecord()); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [state]);
  useEffect(() => {
    if (state === 'recording' && seconds >= MAX_SECONDS) rec.current?.stop();
  }, [state, seconds]);

  const finish = async (audio: Blob): Promise<void> => {
    setState('transcribing');
    const wav = await toWav16k(audio).catch(() => null);
    if (wav === null) { setState('idle'); setProblem('failed'); return; }
    const res = await transcribeRecording(wav, loadStoredSession()?.session_token ?? '');
    setState('idle');
    if (!res.ok) { setProblem(PROBLEM_OF[res.code] ?? 'failed'); return; }
    if (res.text === '') { setProblem('nothing'); return; }
    onTextRef.current(res.text);
  };

  const start = async (): Promise<void> => {
    setProblem('');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (stream === null) { setProblem('denied'); return; }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const unwatch = watchForPause(stream, () => { if (recorder.state === 'recording') recorder.stop(); });
    recorder.ondataavailable = (e) => { chunks.push(e.data); };
    recorder.onstop = () => {
      unwatch();
      stream.getTracks().forEach((t) => t.stop());
      void finish(new Blob(chunks, { type: recorder.mimeType }));
    };
    rec.current = recorder;
    setSeconds(0);
    recorder.start();
    setState('recording');
  };

  const toggle = (): void => {
    if (state === 'recording') { rec.current?.stop(); return; }
    if (state === 'idle') void start();
  };
  return { available, state, seconds, problem, toggle };
}

// toWav16k —— the one shape the instance reads: 16 kHz mono 16-bit PCM WAV. The browser decodes its
// own recording (webm/opus, mp4/aac) and resamples it, so the server needs no audio decoder.
const RATE = 16000;

async function toWav16k(recording: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await recording.arrayBuffer()).finally(() => { void ctx.close(); });
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return wavBlob((await offline.startRendering()).getChannelData(0));
}

function wavBlob(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => { view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true); });
  return new Blob([view], { type: 'audio/wav' });
}

function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function'
    && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

// clock —— 0:07 for the recording timer.
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// appendSpoken —— the transcript joins what the visitor already typed.
export function appendSpoken(current: string, spoken: string): string {
  return current.trim() === '' ? spoken : `${current.trimEnd()} ${spoken}`;
}
