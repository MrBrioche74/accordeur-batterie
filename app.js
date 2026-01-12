/* =========================================================
   ACCORDEUR BATTERIE – MODE TENDU
   Kit : CC 14" / Tom 10" / Tom 12" / Floor 14"
   Modes : Peau de frappe / Peau de résonance
   ========================================================= */

// ----- PLAGES CIBLES (SON TENDU) -----
// La résonance est volontairement PLUS HAUTE que la frappe
const TARGETS = {
  snare: {
    label: 'Caisse claire (14")',
    batter: { min: 205, max: 245 },
    reso:   { min: 220, max: 265 }
  },
  tomHigh: {
    label: 'Tom aigu (10")',
    batter: { min: 175, max: 215 },
    reso:   { min: 190, max: 235 }
  },
  tomMid: {
    label: 'Tom medium (12")',
    batter: { min: 135, max: 175 },
    reso:   { min: 150, max: 195 }
  },
  tomLow: {
    label: 'Tom basse (14")',
    batter: { min: 95,  max: 130 },
    reso:   { min: 110, max: 145 }
  }
};

// ----- UI -----
const el = {
  select: document.getElementById("targetSelect"),
  btn: document.getElementById("btnToggle"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  freq: document.getElementById("freq"),
  range: document.getElementById("range"),
  hint: document.getElementById("hint"),
  needle: document.getElementById("needle"),
  band: document.getElementById("band"),
};

// ----- AUDIO -----
let audioCtx = null;
let analyser = null;
let source = null;
let stream = null;
let rafId = null;

// ----- PARAMÈTRES DSP -----
const FFT_SIZE = 16384;        // bonne résolution basse fréquence
const TIME_BUF = 2048;
const MIN_FREQ = 40;
const VIEW_MAX = 300;

const HIT_RMS = 0.035;         // sensibilité frappe
const HIT_RISE = 1.8;
const HOLD_MS = 250;
const POST_HIT_DELAY = 45;     // ms après l’attaque
const AVG_SPECTRA = 4;

let baselineRms = 0;
let lastHit = 0;
let mode = "batter"; // "batter" ou "reso"

// ----- AJOUT SÉLECTEUR FRAPPE / RÉSONANCE -----
const modeSelect = document.createElement("select");
modeSelect.innerHTML = `
  <option value="batter">Peau de frappe</option>
  <option value="reso">Peau de résonance</option>
`;
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
  updateRangeUI();
});
el.select.parentElement.after(modeSelect);

// ----- BOUTONS -----
el.btn.addEventListener("click", async () => {
  audioCtx ? stop() : await start();
});

el.select.addEventListener("change", updateRangeUI);

// ----- UI INIT -----
updateRangeUI();

// =========================================================
// AUDIO START / STOP
// =========================================================
async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    baselineRms = 0;
    lastHit = 0;

    el.status.textContent = "🎤 micro actif";
    el.btn.textContent = "Arrêter";
    el.hint.textContent = "Frappe UNE fois, laisse résonner.";

    loop();
  } catch {
    el.hint.textContent = "Micro indisponible (HTTPS obligatoire sur iPhone).";
    stop();
  }
}

function stop() {
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();

  audioCtx = analyser = source = stream = null;

  el.status.textContent = "⏹️ arrêté";
  el.btn.textContent = "Démarrer";
  el.result.textContent = "—";
  el.freq.textContent = "0.0 Hz";
  el.needle.style.left = "50%";
}

// =========================================================
// BOUCLE PRINCIPALE
// =========================================================
function loop() {
  const buf = new Float32Array(TIME_BUF);
  analyser.getFloatTimeDomainData(buf);

  const rms = Math.sqrt(buf.reduce((s,v)=>s+v*v,0)/buf.length);
  baselineRms = baselineRms ? baselineRms*0.98 + rms*0.02 : rms;

  const now = performance.now();
  const hit =
    rms > HIT_RMS &&
    rms > baselineRms * HIT_RISE &&
    now - lastHit > HOLD_MS;

  if (hit) {
    lastHit = now;
    setTimeout(analyzeSpectrum, POST_HIT_DELAY);
  }

  rafId = requestAnimationFrame(loop);
}

// =========================================================
// ANALYSE SPECTRALE
// =========================================================
function analyzeSpectrum() {
  const spec = new Float32Array(analyser.frequencyBinCount);
  const acc = new Float32Array(spec.length);

  for (let i = 0; i < AVG_SPECTRA; i++) {
    analyser.getFloatFrequencyData(spec);
    for (let j = 0; j < spec.length; j++) acc[j] += spec[j];
  }
  for (let j = 0; j < acc.length; j++) acc[j] /= AVG_SPECTRA;

  const t = TARGETS[el.select.value][mode];
  const freq = findPeak(acc, audioCtx.sampleRate, FFT_SIZE, MIN_FREQ, t.max + 80);
  if (freq) updateUI(freq, t);
}

// =========================================================
// PEAK DETECTION
// =========================================================
function findPeak(spec, sr, fftSize, minHz, maxHz) {
  const binHz = sr / fftSize;
  let best = -Infinity, idx = -1;

  for (let i = Math.floor(minHz/binHz); i < Math.floor(maxHz/binHz); i++) {
    if (spec[i] > best) {
      best = spec[i];
      idx = i;
    }
  }
  return idx > 0 ? idx * binHz : null;
}

// =========================================================
// UI UPDATE
// =========================================================
function updateUI(freq, target) {
  el.freq.textContent = `${freq.toFixed(1)} Hz`;

  const x = (freq - MIN_FREQ) / (VIEW_MAX - MIN_FREQ);
  el.needle.style.left = `${Math.max(0,Math.min(100,x*100))}%`;

  let status =
    freq < target.min ? "⬇ trop bas" :
    freq > target.max ? "⬆ trop haut" :
    "✅ OK";

  el.result.textContent = status;
}

// =========================================================
// RANGE UI
// =========================================================
function updateRangeUI() {
  const t = TARGETS[el.select.value][mode];
  el.range.textContent = `plage: ${t.min} – ${t.max} Hz`;

  const left = (t.min - MIN_FREQ) / (VIEW_MAX - MIN_FREQ) * 100;
  const right = (t.max - MIN_FREQ) / (VIEW_MAX - MIN_FREQ) * 100;

  el.band.style.left = `${left}%`;
  el.band.style.width = `${Math.max(2, right-left)}%`;
}
