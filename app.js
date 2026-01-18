/* =========================================================
   ACCORDEUR BATTERIE (WEB)
   Kit : CC 14" / Tom 10" / Tom 12" / Floor 14"
   Sélecteurs : Style (Tendu / Rock) + Peau (Frappe / Réso)
   Tech : détection de frappe + FFT + pic spectral
   ========================================================= */

// ---------- PRESETS ----------
const PRESETS = {
  // Son tendu : plus haut, attaque très nette
  tight: {
    label: "Tendu",
    targets: {
      snare:   { label: 'Caisse claire (14")', batter: { min: 205, max: 245 }, reso: { min: 220, max: 265 } },
      tomHigh: { label: 'Tom aigu (10")',      batter: { min: 175, max: 215 }, reso: { min: 190, max: 235 } },
      tomMid:  { label: 'Tom medium (12")',    batter: { min: 135, max: 175 }, reso: { min: 150, max: 195 } },
      tomLow:  { label: 'Tom basse (14")',     batter: { min: 95,  max: 130 }, reso: { min: 110, max: 145 } },
    }
  },

  // Rock : plus bas, plus de “corps”, descente évidente
  rock: {
    label: "Rock",
    targets: {
      snare:   { label: 'Caisse claire (14")', batter: { min: 190, max: 220 }, reso: { min: 205, max: 240 } },
      tomHigh: { label: 'Tom aigu (10")',      batter: { min: 160, max: 180 }, reso: { min: 175, max: 195 } },
      tomMid:  { label: 'Tom medium (12")',    batter: { min: 120, max: 140 }, reso: { min: 135, max: 155 } },
      tomLow:  { label: 'Tom basse (14")',     batter: { min: 85,  max: 105 }, reso: { min: 100, max: 120 } },
    }
  }
};

// ---------- UI ----------
const el = {
  style:  document.getElementById("styleSelect"),
  skin:   document.getElementById("skinSelect"),
  target: document.getElementById("targetSelect"),

  btn:    document.getElementById("btnToggle"),
  status: document.getElementById("status"),

  result: document.getElementById("result"),
  freq:   document.getElementById("freq"),
  range:  document.getElementById("range"),
  hint:   document.getElementById("hint"),

  needle: document.getElementById("needle"),
  band:   document.getElementById("band"),
};

// ---------- AUDIO ----------
let audioCtx = null;
let analyser = null;
let source = null;
let stream = null;
let rafId = null;

// ---------- DSP PARAMS ----------
const FFT_SIZE = 16384;        // résolution basse fréquence
const TIME_BUF = 2048;

const MIN_FREQ_VIEW = 40;      // affichage meter
const MAX_FREQ_VIEW = 300;

const HIT_RMS_THRESHOLD = 0.035;
const HIT_RISE_FACTOR = 1.8;

const HOLD_MS = 250;           // anti double-détection
const POST_HIT_DELAY_MS = 45;  // attendre après l’attaque
const AVG_SPECTRA = 4;         // moyenne de spectres

let baselineRms = 0;
let lastHitAt = 0;

// ---------- EVENTS ----------
el.btn.addEventListener("click", async () => (audioCtx ? stop() : await start()));
el.style.addEventListener("change", () => { updateRangeUI(); });
el.skin.addEventListener("change", () => { updateRangeUI(); });
el.target.addEventListener("change", () => { updateRangeUI(); });

updateRangeUI();

// ---------- START / STOP ----------
async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.0;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    baselineRms = 0;
    lastHitAt = 0;

    el.status.textContent = "🎤 micro actif";
    el.btn.textContent = "Arrêter";
    el.hint.textContent = "Frappe 1 coup. Attends l’analyse, puis refrappe.";

    loop();
  } catch (e) {
    console.error(e);
    el.hint.textContent = "Micro impossible. Sur iPhone, HTTPS + autorisation micro obligatoires.";
    stop();
  }
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (source) source.disconnect();
  source = null;
  analyser = null;

  if (audioCtx) audioCtx.close();
  audioCtx = null;

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  el.status.textContent = "⏹️ arrêté";
  el.btn.textContent = "Démarrer";
  el.result.textContent = "—";
  el.freq.textContent = "0.0 Hz";
  el.needle.style.left = "50%";
  el.hint.textContent = "Appuie sur “Démarrer”, accepte le micro, puis frappe le fût (1 coup).";
}

// ---------- MAIN LOOP ----------
function loop() {
  if (!analyser || !audioCtx) return;

  const timeBuf = new Float32Array(TIME_BUF);
  analyser.getFloatTimeDomainData(timeBuf);

  const rms = Math.sqrt(timeBuf.reduce((s, v) => s + v*v, 0) / timeBuf.length);

  // baseline RMS (bruit ambiant)
  baselineRms = baselineRms === 0 ? rms : (0.98 * baselineRms + 0.02 * rms);

  const now = performance.now();
  const canTrigger = (now - lastHitAt) > HOLD_MS;

  const isHit =
    canTrigger &&
    rms > HIT_RMS_THRESHOLD &&
    rms > baselineRms * HIT_RISE_FACTOR;

  if (isHit) {
    lastHitAt = now;
    setTimeout(analyzeSpectrumOnce, POST_HIT_DELAY_MS);
  }

  rafId = requestAnimationFrame(loop);
}

// ---------- SPECTRUM ANALYSIS ----------
function analyzeSpectrumOnce() {
  if (!analyser || !audioCtx) return;

  const preset = PRESETS[el.style.value];
  const targetObj = preset.targets[el.target.value];
  const band = targetObj[el.skin.value]; // batter/reso

  const specLen = analyser.frequencyBinCount;
  const tmp = new Float32Array(specLen);
  const acc = new Float32Array(specLen);

  for (let k = 0; k < AVG_SPECTRA; k++) {
    analyser.getFloatFrequencyData(tmp); // dB (valeurs négatives)
    for (let i = 0; i < specLen; i++) acc[i] += tmp[i];
  }
  for (let i = 0; i < specLen; i++) acc[i] /= AVG_SPECTRA;

  const searchMin = Math.max(40, band.min - 40);
  const searchMax = band.max + 100;

  const peakHz = findPeakHz(acc, audioCtx.sampleRate, analyser.fftSize, searchMin, searchMax);
  if (!peakHz) return;

  updateUI(peakHz, preset.label, targetObj.label, band);
}

// Trouve le pic spectral dans une plage, avec une petite interpolation
function findPeakHz(dbSpectrum, sampleRate, fftSize, minHz, maxHz) {
  const binHz = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(minHz / binHz));
  const end = Math.min(dbSpectrum.length - 2, Math.floor(maxHz / binHz));
  if (start >= end) return null;

  let bestI = -1;
  let bestDb = -Infinity;

  for (let i = start; i <= end; i++) {
    const v = dbSpectrum[i];
    if (v > bestDb) { bestDb = v; bestI = i; }
  }
  if (bestI < 1) return null;

  // interpolation "centre de gravité" sur i-1,i,i+1 (dB->amplitude approx)
  const i0 = bestI - 1, i1 = bestI, i2 = bestI + 1;
  const a0 = Math.pow(10, dbSpectrum[i0] / 20);
  const a1 = Math.pow(10, dbSpectrum[i1] / 20);
  const a2 = Math.pow(10, dbSpectrum[i2] / 20);
  const denom = (a0 + a1 + a2);
  const frac = denom > 0 ? (a0*i0 + a1*i1 + a2*i2) / denom : i1;

  return frac * binHz;
}

// ---------- UI ----------
function updateUI(freq, presetLabel, targetLabel, band) {
  el.freq.textContent = `${freq.toFixed(1)} Hz`;

  // needle position in viewport
  const x = (freq - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  el.needle.style.left = `${clamp01(x) * 100}%`;

  let status;
  if (freq < band.min) status = "⬇ trop bas";
  else if (freq > band.max) status = "⬆ trop haut";
  else status = "✅ OK";

  el.result.textContent = `${presetLabel} • ${targetLabel} : ${status}`;
}

function updateRangeUI() {
  const preset = PRESETS[el.style.value];
  const targetObj = preset.targets[el.target.value];
  const band = targetObj[el.skin.value];

  el.range.textContent = `plage: ${band.min}–${band.max} Hz`;

  // zone visuelle (band) dans le meter
  const left = (band.min - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  const right = (band.max - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  el.band.style.left = `${clamp01(left) * 100}%`;
  el.band.style.width = `${Math.max(2, (clamp01(right) - clamp01(left)) * 100)}%`;

  // petit rappel dans le hint
  const skinLabel = el.skin.value === "batter" ? "frappe" : "résonance";
  el.hint.textContent = `Style: ${preset.label} • Peau: ${skinLabel}. Frappe 1 coup (micro proche).`;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
