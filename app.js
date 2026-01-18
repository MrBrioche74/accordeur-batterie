/* =========================================================
   ACCORDEUR BATTERIE (WEB) — Style + Peau + UI++ + PWA
   ========================================================= */

// ---------- PRESETS ----------
const PRESETS = {
  tight: {
    label: "Tendu",
    targets: {
      snare:   { label: 'Caisse claire (14")', batter: { min: 205, max: 245 }, reso: { min: 220, max: 265 } },
      tomHigh: { label: 'Tom aigu (10")',      batter: { min: 175, max: 215 }, reso: { min: 190, max: 235 } },
      tomMid:  { label: 'Tom medium (12")',    batter: { min: 135, max: 175 }, reso: { min: 150, max: 195 } },
      tomLow:  { label: 'Tom basse (14")',     batter: { min: 95,  max: 130 }, reso: { min: 110, max: 145 } },
    }
  },
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
  badge:  document.getElementById("badge"),

  needle: document.getElementById("needle"),
  band:   document.getElementById("band"),

  theme:  document.getElementById("btnTheme"),
  full:   document.getElementById("btnFull"),
};

// ---------- THEME (dark/light) ----------
initTheme();
el.theme.addEventListener("click", toggleTheme);

function initTheme(){
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// ---------- FULLSCREEN ----------
el.full.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    // iOS Safari ne supporte pas le vrai fullscreen; pas grave
  }
});

// ---------- PWA (offline) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}

// ---------- AUDIO ----------
let audioCtx = null;
let analyser = null;
let source = null;
let stream = null;
let rafId = null;

// ---------- DSP ----------
const FFT_SIZE = 16384;
const TIME_BUF = 2048;

const MIN_FREQ_VIEW = 40;
const MAX_FREQ_VIEW = 280; // correspond à l’échelle affichée

const HIT_RMS_THRESHOLD = 0.035;
const HIT_RISE_FACTOR = 1.8;

const HOLD_MS = 260;
const POST_HIT_DELAY_MS = 45;
const AVG_SPECTRA = 4;

let baselineRms = 0;
let lastHitAt = 0;

// Aiguille “smooth”
let needleTargetPct = 0.5;
let needlePct = 0.5;

// ---------- EVENTS ----------
el.btn.addEventListener("click", async () => (audioCtx ? stop() : await start()));
el.style.addEventListener("change", updateRangeUI);
el.skin.addEventListener("change", updateRangeUI);
el.target.addEventListener("change", updateRangeUI);

updateRangeUI();
animateNeedle();

// ---------- START / STOP ----------
async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
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
    el.badge.textContent = "En écoute…";
    el.badge.style.opacity = "1";

    loop();
  } catch (e) {
    console.error(e);
    el.hint.textContent = "Micro impossible. Sur iPhone : HTTPS + autoriser le micro.";
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
  el.freq.textContent = "0.0";
  el.badge.textContent = "—";
  needleTargetPct = 0.5;
}

// ---------- MAIN LOOP ----------
function loop() {
  if (!analyser || !audioCtx) return;

  const timeBuf = new Float32Array(TIME_BUF);
  analyser.getFloatTimeDomainData(timeBuf);

  const rms = Math.sqrt(timeBuf.reduce((s, v) => s + v*v, 0) / timeBuf.length);
  baselineRms = baselineRms === 0 ? rms : (0.98 * baselineRms + 0.02 * rms);

  const now = performance.now();
  const canTrigger = (now - lastHitAt) > HOLD_MS;

  const isHit =
    canTrigger &&
    rms > HIT_RMS_THRESHOLD &&
    rms > baselineRms * HIT_RISE_FACTOR;

  if (isHit) {
    lastHitAt = now;
    el.badge.textContent = "Analyse…";
    setTimeout(analyzeSpectrumOnce, POST_HIT_DELAY_MS);
  }

  rafId = requestAnimationFrame(loop);
}

// ---------- SPECTRUM ----------
function analyzeSpectrumOnce() {
  if (!analyser || !audioCtx) return;

  const preset = PRESETS[el.style.value];
  const targetObj = preset.targets[el.target.value];
  const band = targetObj[el.skin.value];

  const specLen = analyser.frequencyBinCount;
  const tmp = new Float32Array(specLen);
  const acc = new Float32Array(specLen);

  for (let k = 0; k < AVG_SPECTRA; k++) {
    analyser.getFloatFrequencyData(tmp);
    for (let i = 0; i < specLen; i++) acc[i] += tmp[i];
  }
  for (let i = 0; i < specLen; i++) acc[i] /= AVG_SPECTRA;

  const searchMin = Math.max(40, band.min - 40);
  const searchMax = band.max + 100;

  const peakHz = findPeakHz(acc, audioCtx.sampleRate, analyser.fftSize, searchMin, searchMax);
  if (!peakHz) { el.badge.textContent = "Réessaie"; return; }

  updateUI(peakHz, preset.label, targetObj.label, band);
}

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

  // interpolation i-1, i, i+1
  const i0 = bestI - 1, i1 = bestI, i2 = bestI + 1;
  const a0 = Math.pow(10, dbSpectrum[i0] / 20);
  const a1 = Math.pow(10, dbSpectrum[i1] / 20);
  const a2 = Math.pow(10, dbSpectrum[i2] / 20);
  const denom = (a0 + a1 + a2);
  const frac = denom > 0 ? (a0*i0 + a1*i1 + a2*i2) / denom : i1;

  return frac * binHz;
}

// ---------- UI UPDATE ----------
function updateUI(freq, presetLabel, targetLabel, band) {
  el.freq.textContent = freq.toFixed(1);

  // needle target
  const x = (freq - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  needleTargetPct = clamp01(x);

  let status, badge;
  if (freq < band.min) { status = "⬇ trop bas"; badge = "Détendre"; }
  else if (freq > band.max) { status = "⬆ trop haut"; badge = "Serrer"; }
  else { status = "✅ OK"; badge = "Bon"; }

  el.result.textContent = `${presetLabel} • ${targetLabel} : ${status}`;
  el.badge.textContent = badge;
}

function updateRangeUI() {
  const preset = PRESETS[el.style.value];
  const targetObj = preset.targets[el.target.value];
  const band = targetObj[el.skin.value];

  el.range.textContent = `${band.min}–${band.max} Hz`;

  const left = (band.min - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  const right = (band.max - MIN_FREQ_VIEW) / (MAX_FREQ_VIEW - MIN_FREQ_VIEW);
  el.band.style.left = `${clamp01(left) * 100}%`;
  el.band.style.width = `${Math.max(2, (clamp01(right) - clamp01(left)) * 100)}%`;

  const skinLabel = el.skin.value === "batter" ? "frappe" : "résonance";
  el.hint.textContent = `Style: ${preset.label} • Peau: ${skinLabel}. Frappe 1 coup (micro proche).`;
}

// animation douce de l’aiguille (même si la mesure saute un peu)
function animateNeedle(){
  needlePct += (needleTargetPct - needlePct) * 0.18; // lissage
  el.needle.style.left = `${needlePct * 100}%`;
  requestAnimationFrame(animateNeedle);
}

function clamp01(v){ return Math.max(0, Math.min(1, v)); }
