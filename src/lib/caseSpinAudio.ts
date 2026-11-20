/** Щелчки прокрута кейса. Источник — реальное положение ленты, не таймер. */

const CELL_PITCH = 128 + 12;
const TRACK_PAD = 12;

let ctx: AudioContext | null = null;

export function primeCaseAudio(): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;
  if (!ctx) ctx = new Ctor();
  void ctx.resume();
}

function readX(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  return new DOMMatrix(t).m41;
}

function cellUnderPointer(x: number, view: number): number {
  return Math.floor((view / 2 - x - TRACK_PAD) / CELL_PITCH);
}

function playTick(audio: AudioContext, speed: number): void {
  const now = audio.currentTime;
  const fast = Math.max(0, Math.min(1, speed / 36));
  const dur = 0.016 + (1 - fast) * 0.034;
  const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const env = Math.exp(-i / (frames * 0.22));
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900 + fast * 1600;
  filter.Q.value = 0.85;
  const gain = audio.createGain();
  gain.gain.value = 0.16 + fast * 0.1;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start(now);
}

export type CaseDropFanfare = "immortal" | "jackpot" | null;

function tone(
  audio: AudioContext,
  freq: number,
  t: number,
  dur: number,
  type: OscillatorType,
  peak: number
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function playImmortal(audio: AudioContext): void {
  const t = audio.currentTime;
  tone(audio, 82, t, 0.42, "sine", 0.26);
  tone(audio, 164, t, 0.3, "triangle", 0.1);
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    tone(audio, freq, t + 0.1 + i * 0.12, 0.62, "triangle", 0.1);
  });
  tone(audio, 1568, t + 0.58, 0.75, "sine", 0.05);
}

function playJackpot(audio: AudioContext): void {
  const t = audio.currentTime;
  [988, 1175, 1319, 1568, 1760, 1976, 2093, 2349].forEach((freq, i) => {
    tone(audio, freq, t + i * 0.05, 0.14, "triangle", 0.07);
  });
  [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
    tone(audio, freq, t + 0.46, 0.72, "sine", 0.09);
  });
}

function playStop(audio: AudioContext): void {
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/**
 * Следит за translate ленты. Щелчок на каждой смене окошка под указателем,
 * удар — когда лента замерла.
 */
export function watchCaseReel(
  track: HTMLElement,
  durationMs: number,
  fanfare: CaseDropFanfare = null
): () => void {
  primeCaseAudio();
  if (!ctx) return () => undefined;
  const audio = ctx;
  let raf = 0;
  let dead = false;
  let lastIdx = -1;
  let lastX = readX(track);
  let heard = false;
  let still = 0;
  let ended = false;
  const started = performance.now();

  const finish = () => {
    if (ended || dead) return;
    ended = true;
    if (!heard) return;
    if (fanfare === "immortal") playImmortal(audio);
    else if (fanfare === "jackpot") playJackpot(audio);
    else playStop(audio);
  };

  const step = () => {
    if (dead || ended) return;
    const x = readX(track);
    const view = track.parentElement?.clientWidth || 640;
    const idx = cellUnderPointer(x, view);
    const speed = Math.abs(x - lastX);
    if (lastIdx >= 0 && idx !== lastIdx) {
      playTick(audio, Math.max(speed, 4));
      heard = true;
      still = 0;
    } else if (heard && speed < 0.2) {
      still += 1;
    } else {
      still = 0;
    }
    lastIdx = idx;
    lastX = x;
    const elapsed = performance.now() - started;
    if (heard && still >= 10 && elapsed > 400) {
      finish();
      return;
    }
    if (elapsed > durationMs + 400) {
      finish();
      return;
    }
    raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
  return () => {
    dead = true;
    cancelAnimationFrame(raf);
  };
}
