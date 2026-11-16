/* Studio — clean UI for reForge. Talks to /sdapi/v1/* (needs --api) and /studio/api/* (sd-studio extension). */
'use strict';

/* ======================================================================= helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r8 = (n) => Math.max(64, Math.round(n / 8) * 8);
const toDataURL = (b64) => (b64.startsWith('data:') ? b64 : 'data:image/png;base64,' + b64);
const blobToDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
const dataURLToBlob = (d) => fetch(d).then((r) => r.blob());
const imgSize = (blob) => new Promise((res) => { const i = new Image(); i.onload = () => { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(i.src); }; i.onerror = () => res({ w: 0, h: 0 }); i.src = URL.createObjectURL(blob); });
const shortName = (title) => String(title || '').replace(/\s*\[[0-9a-f]+\]$/i, '').replace(/\.(safetensors|ckpt|pt|pth)$/i, '').split(/[\\/]/).pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const ICONS = {
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  images: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  classic: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevl: '<path d="M15 6l-6 6 6 6"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  redo: '<path d="M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  base: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
function hydrateIcons(root = document) { $$('[data-icon]', root).forEach((e) => { if (!e.firstChild) e.innerHTML = icon(e.dataset.icon); }); }

function toast(msg, type = '') {
  const t = el('div', 'toast ' + type); t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
}
function busy(text) { $('#busy-text').textContent = text || ''; $('#busy').hidden = !text; }

/* ======================================================================= API */
async function api(path, body, method) {
  const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || j.error || j.errors || JSON.stringify(j); } catch { /* not json */ }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

/* ======================================================================= IndexedDB history */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open('sd-studio', 1);
      rq.onupgradeneeded = () => { const s = rq.result.createObjectStore('images', { keyPath: 'id' }); s.createIndex('created', 'created'); };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('images', mode); const s = t.objectStore('images');
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  put(r) { return this.tx('readwrite', (s) => s.put(r)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  all() { return this.tx('readonly', (s) => s.getAll()); },
};
const urlCache = new Map();
function recURL(r) { if (!urlCache.has(r.id)) urlCache.set(r.id, URL.createObjectURL(r.blob)); return urlCache.get(r.id); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ======================================================================= constants & state */
const ASPECTS = [
  { id: '3:4', w: 960, h: 1280, label: '3:4' },
  { id: '1:1', w: 1024, h: 1024, label: '1:1' },
  { id: '4:3', w: 1280, h: 960, label: '4:3' },
  { id: '9:16', w: 768, h: 1344, label: '9:16' },
  { id: '16:9', w: 1344, h: 768, label: '16:9' },
  { id: 'custom', w: 0, h: 0, label: 'Custom' },
];
const COUNTS = [1, 2, 4, 6, 8];
const QUALITY = {
  fast: { steps: 20, hires: false, adetailer: false },
  sharp: { steps: 28, hires: true, adetailer: false },
  max: { steps: 28, hires: true, adetailer: true },
};
const DEFAULT_NEG = 'lowres, worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed, blurry, jpeg artifacts, watermark, signature, text, username';
const DEFAULTS = {
  prompt: '', negative: DEFAULT_NEG, aspect: '3:4', width: 960, height: 1280, quality: 'sharp', count: 1, seed: -1,
  sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 28, cfg: 6, clip: 2,
  hires: true, hrScale: 1.5, hrDenoise: 0.35, hrSteps: 14, hrUpscaler: '', adetailer: false, adDenoise: 0.4, adConfidence: 0.3,
  subseed: -1, subseedStrength: 0, loras: [], vae: 'Automatic',
  baseDenoise: 0.45, baseMode: 'edit', baseSize: 'image', baseFit: 1,
};
const ADV_KEYS = ['sampler', 'scheduler', 'steps', 'cfg', 'clip', 'subseed', 'subseedStrength', 'hrScale', 'hrDenoise', 'hrSteps', 'adDenoise', 'adConfidence'];
const KIND_LABEL = { txt2img: 'Generar', img2img: 'Transformar', upscale: 'Upscale x2', refine: 'Refinar', fix: 'Caras/manos', variation: 'Variación', upload: 'Subida' };

const S = {
  st: { ...DEFAULTS, ...store.get('studio.settings', {}) },
  models: [], vaes: [], loras: [], loraNames: {}, samplers: [], schedulers: [], upscalers: [],
  hasAD: false, apiOk: false, model: '', ultra: '',
  queue: [], running: null, lastRecord: null, coverBust: Date.now(),
  previews: null, // {checkpoint:Set, lora:Set} of names with a cover; null = unknown -> always try
  base: null, // { dataURL, blob, w, h, src, info } - session only (too heavy for localStorage)
  pngInfo: null,
};
let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('studio.settings', S.st), 250); }

/* ======================================================================= settings <-> UI */
function renderStatic() {
  const ac = $('#aspect-chips');
  ASPECTS.forEach((a) => {
    const b = el('button', 'chip'); b.type = 'button'; b.dataset.aspect = a.id;
    const box = a.w ? `<i class="ar" style="width:${Math.round(a.w / 96)}px;height:${Math.round(a.h / 96)}px"></i>` : '';
    b.innerHTML = box + a.label;
    b.onclick = () => { S.st.aspect = a.id; if (a.w) { S.st.width = a.w; S.st.height = a.h; } syncUI(); persist(); };
    ac.append(b);
  });
  const cc = $('#count-chips');
  COUNTS.forEach((n) => {
    const b = el('button', 'chip', n === 1 ? '1 imagen' : `${n}`); b.type = 'button'; b.dataset.count = n;
    b.onclick = () => { S.st.count = n; syncUI(); persist(); };
    cc.append(b);
  });
  $$('#quality-seg button').forEach((b) => b.onclick = () => { applyQuality(b.dataset.q); });
}

function applyQuality(q) {
  S.st.quality = q;
  Object.assign(S.st, QUALITY[q]);
  if (!S.hasAD) S.st.adetailer = false;
  syncUI(); persist();
}

/** Push S.st into every input. */
function syncUI() {
  const st = S.st;
  if ($('#prompt').value !== st.prompt) $('#prompt').value = st.prompt;
  if ($('#negative').value !== st.negative) $('#negative').value = st.negative;
  $$('#aspect-chips .chip').forEach((b) => b.classList.toggle('active', b.dataset.aspect === st.aspect));
  $('#custom-size').hidden = st.aspect !== 'custom';
  $('#cw').value = st.width; $('#ch').value = st.height;
  if (S.base) {
    const [w, h] = baseSize(st);
    $('#size-label').textContent = `${w} × ${h}` + (st.baseSize === 'image' ? ' (de la imagen)' : '');
  } else {
    $('#size-label').textContent = `${st.width} × ${st.height}` + (st.hires ? ` → ${r8(st.width * st.hrScale)} × ${r8(st.height * st.hrScale)}` : '');
  }
  $('#aspect-block').classList.toggle('dim', !!S.base && st.baseSize === 'image');
  $$('#count-chips .chip').forEach((b) => b.classList.toggle('active', +b.dataset.count === st.count));
  $$('#quality-seg button').forEach((b) => b.classList.toggle('active', b.dataset.q === st.quality));
  $('#seed').value = st.seed >= 0 ? st.seed : '';
  setSel('#sampler', st.sampler); setSel('#scheduler', st.scheduler); setSel('#hr-upscaler', st.hrUpscaler);
  setRange('steps', st.steps); setRange('cfg', st.cfg); setRange('clip', st.clip);
  setRange('hr-scale', st.hrScale); setRange('hr-denoise', st.hrDenoise); setRange('hr-steps', st.hrSteps);
  setRange('ad-denoise', st.adDenoise); setRange('ad-confidence', st.adConfidence);
  setRange('subseed-strength', st.subseedStrength); setRange('base-denoise', st.baseDenoise);
  $('#subseed').value = st.subseed >= 0 ? st.subseed : '';
  // Mejoras (main panel): Face fix / Enhance Details (HiRes) / VAE Model
  const ff = $('#face-fix'), eh = $('#enhance-hires');
  ff.checked = st.adetailer && S.hasAD; ff.disabled = !S.hasAD;
  $('#face-fix-row').classList.toggle('disabled', !S.hasAD);
  $('#face-fix-hint').textContent = S.hasAD ? 're-dibuja caras y manos (ADetailer)' : 'ADetailer no instalado';
  eh.checked = st.hires && !S.base; eh.disabled = !!S.base;
  $('#enhance-hires-row').classList.toggle('disabled', !!S.base);
  $('#enhance-hires-hint').textContent = S.base ? 'no aplica con imagen base (img2img)' : 'genera más grande y re-detalla';
  setSel('#vae-select', st.vae);
  $('#hires-fields').hidden = !st.hires; $('#ad-fields').hidden = !st.adetailer;
  $('#hires-off-note').hidden = st.hires; $('#ad-off-note').hidden = st.adetailer;
  $('#ad-wrap').hidden = !S.hasAD;
  renderBase(); renderSeedLast();
  renderLoraChips();
  setStatus();
}
function setSel(sel, v) { const s = $(sel); if ([...s.options].some((o) => o.value === v)) s.value = v; }
function setRange(id, v) { const r = $('#' + id); if (!r) return; r.value = v; paintRange(r); }

/** Paint slider fill (--p) and sync the numeric box next to it. */
function paintRange(r) {
  const min = +r.min || 0, max = +r.max || 100;
  r.style.setProperty('--p', ((+r.value - min) / (max - min)) * 100 + '%');
  const num = r._num; if (num && document.activeElement !== num) num.value = r.value;
}

/** Upgrade every range: wrap + default marker, editable number box, double-click label = default. */
function enhanceRanges(root = document) {
  $$('input[type=range]', root).forEach((r) => {
    if (r._enhanced) return; r._enhanced = true;
    const field = r.closest('.field');
    const def = r.dataset.def;
    if (def !== undefined) {
      const wrap = el('div', 'range-wrap'); r.replaceWith(wrap); wrap.append(r);
      const mark = el('i', 'def-mark'); mark.style.left = `calc(9px + (100% - 18px) * ${(def - r.min) / (r.max - r.min)})`; wrap.prepend(mark);
    }
    const num = field && $('.field-head .num', field);
    if (num) {
      r._num = num; num.min = r.min; num.max = r.max; num.step = r.step;
      const commit = () => {
        let v = parseFloat(num.value); if (!Number.isFinite(v)) v = +r.value;
        v = Math.min(+r.max, Math.max(+r.min, v)); r.value = v; num.value = r.value;
        r.dispatchEvent(new Event('input', { bubbles: true }));
      };
      num.addEventListener('change', commit);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); num.blur(); } });
    }
    const label = field && $('.field-head > span', field);
    if (label && def !== undefined) {
      label.title = `Doble clic: volver a ${def}`;
      label.addEventListener('dblclick', () => { r.value = def; r.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    paintRange(r);
  });
}

/** Mark quality as "custom" when advanced values diverge from the preset. */
function reconcileQuality() {
  const q = QUALITY[S.st.quality];
  if (q && (q.steps !== S.st.steps || q.hires !== S.st.hires || q.adetailer !== S.st.adetailer)) S.st.quality = 'custom';
}

function bindInputs() {
  $('#prompt').addEventListener('input', (e) => { S.st.prompt = e.target.value; persist(); });
  $('#negative').addEventListener('input', (e) => { S.st.negative = e.target.value; persist(); });
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); } });
  const sizeIn = () => { S.st.width = r8(+$('#cw').value || 1024); S.st.height = r8(+$('#ch').value || 1024); syncUI(); persist(); };
  $('#cw').addEventListener('change', sizeIn); $('#ch').addEventListener('change', sizeIn);
  $('#seed').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); S.st.seed = Number.isFinite(v) && v >= 0 ? v : -1; persist(); });
  $('#seed-random').onclick = () => { S.st.seed = -1; syncUI(); persist(); };
  const num = (id, key, quality) => $('#' + id).addEventListener('input', (e) => {
    S.st[key] = +e.target.value; paintRange(e.target);
    if (quality) reconcileQuality();
    $$('#quality-seg button').forEach((b) => b.classList.toggle('active', b.dataset.q === S.st.quality));
    if (key === 'hrScale') syncUI();
    if (key === 'baseDenoise') renderBase();
    persist();
  });
  num('steps', 'steps', true); num('cfg', 'cfg'); num('clip', 'clip'); num('hr-scale', 'hrScale'); num('hr-denoise', 'hrDenoise');
  num('hr-steps', 'hrSteps'); num('ad-denoise', 'adDenoise'); num('ad-confidence', 'adConfidence');
  num('subseed-strength', 'subseedStrength'); num('base-denoise', 'baseDenoise');
  $('#subseed').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); S.st.subseed = Number.isFinite(v) && v >= 0 ? v : -1; persist(); });
  $('#subseed-random').onclick = () => { S.st.subseed = -1; syncUI(); persist(); };
  $('#adv-reset').onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    ADV_KEYS.forEach((k) => { S.st[k] = DEFAULTS[k]; });
    if (S.samplers.length && !S.samplers.some((x) => x.name === S.st.sampler)) S.st.sampler = S.samplers[0].name;
    applyQuality(QUALITY[S.st.quality] ? S.st.quality : 'sharp');
    toast('Avanzado restablecido.');
  };
  $('#seed-last').onclick = () => { if (S.lastRecord?.seed >= 0) { S.st.seed = S.lastRecord.seed; syncUI(); persist(); } };
  bindBase();
  $('#sampler').onchange = (e) => { S.st.sampler = e.target.value; persist(); };
  $('#scheduler').onchange = (e) => { S.st.scheduler = e.target.value; persist(); };
  $('#hr-upscaler').onchange = (e) => { S.st.hrUpscaler = e.target.value; persist(); };
  $('#enhance-hires').onchange = (e) => { S.st.hires = e.target.checked; reconcileQuality(); syncUI(); persist(); };
  $('#face-fix').onchange = (e) => { S.st.adetailer = e.target.checked; reconcileQuality(); syncUI(); persist(); };
  $('#vae-select').onchange = (e) => setVae(e.target.value);
  $('#generate').onclick = generate;
  $('#save-config').onclick = saveCurrentConfig;
  $('#model-card').onclick = () => openPicker('checkpoint');
  $('#add-lora').onclick = () => openPicker('lora');
}

/* ======================================================================= server data */
async function loadServer() {
  try {
    const [models, vaes, loras, samplers, schedulers, upscalers, latent, scripts, opts] = await Promise.all([
      api('/sdapi/v1/sd-models'), api('/sdapi/v1/sd-vae'), api('/sdapi/v1/loras').catch(() => []),
      api('/sdapi/v1/samplers'), api('/sdapi/v1/schedulers').catch(() => []), api('/sdapi/v1/upscalers'),
      api('/sdapi/v1/latent-upscale-modes').catch(() => []), api('/sdapi/v1/scripts').catch(() => ({})), api('/sdapi/v1/options'),
    ]);
    const loraNames = await api('/studio/api/lora-names').catch(() => ({}));
    const pv = await api('/studio/api/previews').catch(() => null);
    S.previews = pv ? { checkpoint: new Set(pv.checkpoint), lora: new Set(pv.lora) } : null;
    Object.assign(S, { models, vaes, loras, loraNames, samplers, schedulers, upscalers, apiOk: true });
    S.hasAD = [...(scripts.txt2img || [])].some((n) => /adetailer/i.test(n));
    S.model = opts.sd_model_checkpoint || '';
    fillSelect('#vae-select', vaeOptions().map(([v]) => v), vaeOptions().map(([, l]) => l));
    const vae = resolveVae(S.st.vae);
    if (!vae) toast('VAE guardado no encontrado: ' + S.st.vae + '. Usando Automático.', 'err');
    S.st.vae = vae || 'Automatic';
    S.ultra = (upscalers.find((u) => /ultrasharp/i.test(u.name)) || upscalers.find((u) => /R-ESRGAN 4x\+$/.test(u.name)) || upscalers.find((u) => u.name !== 'None') || {}).name || 'Lanczos';
    if (opts.show_progress_every_n_steps > 3 || opts.show_progress_every_n_steps < 1) api('/sdapi/v1/options', { show_progress_every_n_steps: 3, live_previews_enable: true }).catch(() => {});

    fillSelect('#sampler', samplers.map((s) => s.name));
    fillSelect('#scheduler', schedulers.map((s) => s.label || s.name), schedulers.map((s) => s.label || s.name));
    const hrNames = [...latent.map((l) => l.name), ...upscalers.map((u) => u.name).filter((n) => n !== 'None')];
    fillSelect('#hr-upscaler', hrNames);
    if (!S.st.hrUpscaler || !hrNames.includes(S.st.hrUpscaler)) S.st.hrUpscaler = S.ultra;
    if (!samplers.some((s) => s.name === S.st.sampler)) S.st.sampler = samplers[0]?.name || 'Euler a';
    if (schedulers.length && !schedulers.some((s) => (s.label || s.name) === S.st.scheduler)) S.st.scheduler = schedulers[0].label || schedulers[0].name;
    if (!S.hasAD) S.st.adetailer = false;
    S.st.loras = S.st.loras.filter((l) => loras.some((x) => x.name === l.name));
    $('#lb-fix').hidden = !S.hasAD;
    syncUI(); renderModelCard(); renderModelsPage(); setStatus();
  } catch (e) {
    S.apiOk = false; setStatus();
    if (S.warned) return;
    S.warned = true;
    if (e.status === 404) toast('API no activa. Agrega --api a COMMANDLINE_ARGS en webui-user.bat y reinicia.', 'err');
    else toast('No se pudo conectar con reForge: ' + e.message, 'err');
  }
}
function fillSelect(sel, values, labels) {
  const s = $(sel); s.innerHTML = '';
  values.forEach((v, i) => { const o = el('option'); o.value = v; o.textContent = labels ? labels[i] : v; s.append(o); });
}
function setStatus() {
  const q = S.queue.length + (S.running ? 1 : 0);
  $('#status').innerHTML = `<span><i class="dot ${S.apiOk ? '' : 'off'}"></i>${S.apiOk ? 'Conectado' : 'Sin conexión'}</span>` + (q ? `<span>${q} en proceso</span>` : '');
  const verb = S.base ? 'Transformar' : 'Generar';
  $('#generate-label').textContent = S.running ? `Agregar a la cola${S.queue.length ? ` (${S.queue.length})` : ''}` : (S.st.count > 1 ? `${verb} ${S.st.count}` : verb);
}

/* ======================================================================= models, VAE, LoRAs */
const coverURL = (kind, name) => `/studio/api/preview/${kind}?name=${encodeURIComponent(name)}&t=${S.coverBust}`;
function coverEl(cls, kind, name) {
  const c = el('div', cls); c.style.position = 'relative'; c.style.overflow = 'hidden';
  c.append(el('span', '', esc(shortName(name).slice(0, 1).toUpperCase())));
  const img = el('img'); img.alt = ''; img.loading = 'lazy';
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  // only request covers that exist (missing ones would 404 in the console); unknown list -> try anyway
  if (S.previews && !S.previews[kind]?.has(name)) return c;
  img.onerror = () => img.remove(); img.src = coverURL(kind, name);
  c.append(img);
  return c;
}
function renderModelCard() {
  const cover = $('#model-cover'); cover.replaceWith(Object.assign(coverEl('model-cover', 'checkpoint', S.model), { id: 'model-cover' }));
  $('#model-name').textContent = shortName(S.model) || 'Sin modelo';
  $('#vae-name').textContent = 'VAE: ' + vaeLabel(S.st.vae);
}

async function setCheckpoint(title) {
  if (title === S.model) return;
  if (S.running) { toast('Espera a que termine la generación actual.', 'err'); return false; }
  busy('Cambiando a ' + shortName(title) + '…');
  try {
    // Safe path: the server saves the checkpoint and restarts itself (hot-swap leaks RAM and segfaults).
    const r = await api('/studio/api/switch-checkpoint', { title });
    if (r.restart) await waitForRestart(r.title, (msg) => busy(msg + ' — ' + shortName(title)));
    S.model = r.title; toast('Modelo listo: ' + shortName(title), 'ok');
  } catch (e) { toast('Error al cambiar modelo: ' + e.message, 'err'); return false; }
  finally { busy(''); }
  renderModelCard(); renderModelsPage();
  return true;
}
/**
 * Wait for the server restart triggered by /studio/api/switch-checkpoint.
 * Phase 1: wait until the old server stops answering (≤20 s).
 * Phase 2: wait until /sdapi/v1/options answers again with `title` as the checkpoint (≤4 min).
 * @param {string} title  checkpoint title the new server must report
 * @param {(msg: string) => void} onStatus  progress text for the busy overlay
 * @throws {Error} on timeout
 */
async function waitForRestart(title, onStatus) {
  const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 1000);
  const up = async () => { try { return await api('/sdapi/v1/options'); } catch { return null; } };
  onStatus('Reiniciando server');
  while (Date.now() - t0 < 20000 && (await up())) await sleep(1000);
  while (Date.now() - t0 < 240000) {
    onStatus(`Reiniciando server (${secs()} s, suele tardar ~1 min)`);
    const o = await up();
    if (o && o.sd_model_checkpoint === title) return;
    await sleep(2000);
  }
  throw new Error('el server no volvió en 4 min (revisa extensions/sd-studio/server.log)');
}
/** VAE choices for selects/chips: [value, label]. 'Automatic' = the checkpoint's own / server default. */
function vaeOptions() {
  return [['Automatic', 'Automático'], ['None', 'Ninguno'], ...S.vaes.map((v) => [v.model_name, shortName(v.model_name)])];
}
function vaeLabel(v) { return v === 'Automatic' ? 'Automático' : v === 'None' ? 'Ninguno' : shortName(v); }
/** Map any VAE name (infotext, saved config, file name with extension) to a known option value, or null. */
function resolveVae(name) {
  if (!name) return 'Automatic';
  if (['Automatic', 'None'].includes(name)) return name;
  return S.vaes.find((x) => x.model_name === name || shortName(x.model_name) === shortName(name))?.model_name || null;
}
/** Pick the VAE for next generations. Sent per request (override_settings.sd_vae): the server's global VAE is untouched. */
function setVae(name) {
  S.st.vae = name; persist();
  setSel('#vae-select', name);
  renderModelCard(); renderModelsPage();
  return true;
}

function loraTriggers(l) {
  let meta = l.metadata?.ss_tag_frequency;
  if (!meta) return [];
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { return []; } }
  const counts = {};
  Object.values(meta).forEach((set) => Object.entries(set || {}).forEach(([t, n]) => { counts[t.trim()] = (counts[t.trim()] || 0) + n; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
}
/** Visible label of a LoRA: custom name set in Studio > file alias > file name. */
function loraLabel(name) {
  return S.loraNames[name] || S.loras.find((x) => x.name === name)?.alias || name;
}
/**
 * Ask for a new visible name and save it server-side (lora_names.json).
 * The file and <lora:name:w> tags are untouched. Empty input restores the original name.
 */
async function renameLora(name) {
  const ans = await askName('Renombrar LoRA (vacío = nombre original)', S.loraNames[name] || shortName(loraLabel(name)));
  if (!ans) return;
  try {
    S.loraNames = await api('/studio/api/lora-names', { name, display: ans.value });
    toast(ans.value ? 'LoRA renombrada: ' + ans.value : 'Nombre original restaurado', 'ok');
  } catch (e) { toast('No se pudo renombrar: ' + e.message, 'err'); return; }
  renderLoraChips(); renderModelsPage();
  if (!$('#picker').hidden && $('#picker-grid').className === 'card-grid' && $('#picker-title').textContent === 'Agregar LoRAs') renderLoraGrid($('#picker-grid'), $('#picker-search').value);
}
function toggleLora(name, on) {
  const has = S.st.loras.some((l) => l.name === name);
  if (on && !has) S.st.loras.push({ name, weight: 0.8 });
  if (!on && has) S.st.loras = S.st.loras.filter((l) => l.name !== name);
  renderLoraChips(); persist();
}
function renderLoraChips() {
  const box = $('#lora-chips'); box.innerHTML = '';
  S.st.loras.forEach((l) => {
    const info = S.loras.find((x) => x.name === l.name);
    const chip = el('div', 'lora-chip');
    chip.append(coverEl('thumb', 'lora', l.name));
    const mid = el('div', '', `<div class="name" title="${esc(l.name)} · clic para renombrar">${esc(shortName(loraLabel(l.name)))}</div><div class="w"><input type="range" min="-1" max="2" step="0.05" value="${l.weight}"><output>${l.weight}</output></div>`);
    $('.name', mid).onclick = () => renameLora(l.name);
    const range = $('input', mid);
    range.oninput = () => { l.weight = +range.value; $('output', mid).textContent = range.value; persist(); };
    paintRange(range);
    chip.append(mid);
    const rm = el('button', 'icon-btn', icon('x')); rm.type = 'button'; rm.title = 'Quitar'; rm.style.cssText = 'width:30px;height:30px';
    rm.onclick = () => toggleLora(l.name, false);
    chip.append(rm);
    const trig = info ? loraTriggers(info) : [];
    if (trig.length) {
      const t = el('div', 'triggers');
      trig.forEach((w) => { const b = el('button', '', esc(w)); b.type = 'button'; b.title = 'Agregar al prompt'; b.onclick = () => addToPrompt(w); t.append(b); });
      chip.append(t);
    }
    box.append(chip);
  });
}
function addToPrompt(word) {
  const p = S.st.prompt.trim();
  if (p.split(',').map((s) => s.trim()).includes(word)) return;
  S.st.prompt = p ? `${p}, ${word}` : word; syncUI(); persist();
}

function modelCard(kind, item, opts = {}) {
  const name = kind === 'checkpoint' ? item.title : item.name;
  const card = el('button', 'm-card' + (opts.active ? ' active' : '')); card.type = 'button';
  const cover = coverEl('cover', kind, name);
  if (opts.active) cover.append(el('span', 'tag', kind === 'lora' ? 'Activa' : 'En uso'));
  card.append(cover);
  const body = el('div', 'body', `<div class="title">${esc(shortName(kind === 'lora' ? loraLabel(item.name) : name))}</div>`);
  if (kind === 'lora') {
    // pencil = rename (visible name only); a <span> because a <button> can't nest inside the card button
    const ed = el('span', 'edit-btn', icon('pencil')); ed.title = 'Renombrar'; ed.setAttribute('role', 'button');
    ed.onclick = (e) => { e.stopPropagation(); renameLora(item.name); };
    cover.append(ed);
    if (S.loraNames[item.name]) body.append(el('div', 'sub file', esc(shortName(item.name))));
  }
  if (opts.sub) body.append(el('div', 'sub', esc(opts.sub)));
  card.append(body);
  card.onclick = opts.onClick;
  return card;
}

function renderModelsPage() {
  const cg = $('#ckpt-grid'); cg.innerHTML = '';
  S.models.forEach((m) => cg.append(modelCard('checkpoint', m, { active: m.title === S.model, onClick: () => setCheckpoint(m.title) })));
  const vc = $('#vae-chips'); vc.innerHTML = '';
  vaeOptions().forEach(([v, label]) => {
    const b = el('button', 'chip' + (S.st.vae === v ? ' active' : ''), esc(label)); b.type = 'button'; b.onclick = () => setVae(v); vc.append(b);
  });
  renderLoraGrid($('#lora-grid-page'), $('#lora-search-page').value);
}
function renderLoraGrid(grid, filter = '') {
  grid.innerHTML = '';
  const f = filter.toLowerCase();
  const list = S.loras.filter((l) => !f || (l.name + ' ' + (l.alias || '') + ' ' + (S.loraNames[l.name] || '')).toLowerCase().includes(f));
  if (!list.length) grid.append(el('div', 'muted', S.loras.length ? 'Sin resultados.' : 'No hay LoRAs en models/Lora.'));
  list.forEach((l) => {
    const active = S.st.loras.some((x) => x.name === l.name);
    const trig = loraTriggers(l);
    grid.append(modelCard('lora', l, {
      active, sub: trig.length ? trig.slice(0, 3).join(', ') : '',
      onClick: () => { toggleLora(l.name, !active); renderLoraGrid(grid, filter); if (grid.id !== 'lora-grid-page') renderModelsPage(); },
    }));
  });
}

function openPicker(kind) {
  const m = $('#picker'); m.hidden = false;
  $('#picker-title').textContent = { checkpoint: 'Elegir modelo', lora: 'Agregar LoRAs', history: 'Elegir imagen base' }[kind];
  const search = $('#picker-search'); search.value = '';
  const extra = $('#picker-extra'); extra.innerHTML = '';
  const render = () => {
    const grid = $('#picker-grid'); const f = search.value.toLowerCase();
    grid.className = kind === 'history' ? 'hist-grid' : 'card-grid';
    if (kind === 'history') {
      DB.all().then((all) => {
        grid.innerHTML = '';
        const list = all.sort((a, b) => b.created - a.created).filter((r) => !f || (r.params?.prompt || '').toLowerCase().includes(f));
        if (!list.length) grid.append(el('div', 'muted', 'No hay imágenes en el historial.'));
        list.forEach((r) => {
          const t = el('div', 'thumb-card'); const img = el('img'); img.src = recURL(r); img.loading = 'lazy'; t.append(img);
          t.onclick = () => { m.hidden = true; setBase(r.blob, 'De mis creaciones'); };
          grid.append(t);
        });
      });
      return;
    }
    if (kind === 'lora') { renderLoraGrid(grid, search.value); return; }
    grid.innerHTML = '';
    S.models.filter((x) => !f || x.title.toLowerCase().includes(f)).forEach((x) => grid.append(modelCard('checkpoint', x, {
      active: x.title === S.model, onClick: async () => { if (await setCheckpoint(x.title) !== false) m.hidden = true; },
    })));
  };
  if (kind === 'checkpoint') {
    extra.append(el('h3', '', 'VAE'));
    const vc = el('div', 'chips');
    vaeOptions().forEach(([v, label]) => {
      const b = el('button', 'chip' + (S.st.vae === v ? ' active' : ''), esc(label)); b.type = 'button';
      b.onclick = () => { if (setVae(v) !== false) { $$('.chip', vc).forEach((c) => c.classList.remove('active')); b.classList.add('active'); } };
      vc.append(b);
    });
    extra.append(vc);
  }
  search.oninput = render; render();
  setTimeout(() => search.focus(), 50);
}

/* ======================================================================= generation queue */
function fullPrompt(st) {
  const tags = st.loras.filter((l) => l.weight !== 0).map((l) => `<lora:${l.name}:${l.weight}>`).join(' ');
  return [st.prompt.trim(), tags].filter(Boolean).join(' ');
}
function adArgs(skipImg2img, st = S.st) {
  const unit = (model) => ({ ad_model: model, ad_denoising_strength: st.adDenoise ?? 0.4, ad_confidence: st.adConfidence ?? 0.3 });
  return { ADetailer: { args: [true, !!skipImg2img, unit('face_yolov8n.pt'), unit('hand_yolov8n.pt')] } };
}
/** Fields shared by txt2img and img2img: prompt, sampling, seeds, ADetailer. */
function commonPayload(st) {
  const p = {
    prompt: fullPrompt(st), negative_prompt: st.negative,
    steps: st.steps, cfg_scale: st.cfg, sampler_name: st.sampler, scheduler: st.scheduler,
    seed: st.seed >= 0 ? st.seed : -1, batch_size: 1, n_iter: st.count,
    override_settings: { CLIP_stop_at_last_layers: st.clip, sd_vae: resolveVae(st.vae) || 'Automatic' }, save_images: true, send_images: true,
  };
  if (st.subseedStrength > 0) Object.assign(p, { subseed: st.subseed >= 0 ? st.subseed : -1, subseed_strength: st.subseedStrength });
  if (st.adetailer && S.hasAD) p.alwayson_scripts = adArgs(false, st);
  return p;
}
/** Output size for img2img: base image scaled to ~1 MP (SDXL native) or the chosen format. */
function baseSize(st) {
  if (!S.base || st.baseSize !== 'image') return [st.width, st.height];
  const k = Math.sqrt((1024 * 1024) / (S.base.w * S.base.h));
  return [r8(S.base.w * k), r8(S.base.h * k)];
}
function img2imgPayload(st) {
  const [w, h] = baseSize(st);
  return { ...commonPayload(st), init_images: [S.base.dataURL], denoising_strength: st.baseDenoise, width: w, height: h, resize_mode: +st.baseFit || 1 };
}
function txt2imgPayload(st) {
  const p = { ...commonPayload(st), width: st.width, height: st.height };
  if (st.hires) Object.assign(p, { enable_hr: true, hr_scale: st.hrScale, hr_upscaler: st.hrUpscaler || S.ultra, denoising_strength: st.hrDenoise, hr_second_pass_steps: st.hrSteps });
  return p;
}

function generate() {
  if (!S.apiOk) { toast('Sin conexión con la API de reForge.', 'err'); return; }
  if (!S.st.prompt.trim() && !S.base) { toast('Escribe un prompt primero.', 'err'); $('#prompt').focus(); return; }
  const st = JSON.parse(JSON.stringify(S.st));
  if (S.base) {
    const [w, h] = baseSize(st); const payload = img2imgPayload(st);
    enqueue({ kind: 'img2img', title: st.prompt || 'Imagen base', count: st.count, ar: w / h, st: { ...st, width: w, height: h }, exec: () => api('/sdapi/v1/img2img', payload) });
    return;
  }
  enqueue({
    kind: 'txt2img', title: st.prompt, count: st.count, ar: st.width / st.height, st,
    exec: () => api('/sdapi/v1/txt2img', txt2imgPayload(st)),
  });
}

function enqueue(job) {
  job.id = uid(); job.state = 'queued';
  job.card = taskCard(job);
  updateTaskActions(job);
  S.queue.push(job); setStatus(); pump();
}
async function pump() {
  if (S.running) return;
  while (S.queue.length) {
    const job = S.queue.shift(); S.running = job; setStatus();
    await runJob(job);
    S.running = null; setStatus();
  }
}
async function runJob(job) {
  job.state = 'running'; updateTaskActions(job);
  const stop = startPolling(job);
  try {
    const res = await job.exec();
    stop();
    const recs = job.collect ? await job.collect(res) : await collectTxt2img(job, res);
    job.records = recs; job.state = 'done';
    fillTask(job);
  } catch (e) {
    stop(); job.state = 'error';
    const err = el('div', 'task-error', esc('Error: ' + e.message)); job.card.querySelector('.task-grid').replaceWith(err);
    updateTaskActions(job);
    toast('Falló la generación: ' + e.message, 'err');
  }
}

function startPolling(job) {
  let alive = true;
  const bar = $('.progress > i', job.card);
  (async () => {
    while (alive) {
      try {
        const p = await api('/sdapi/v1/progress?skip_current_image=false');
        if (!alive) break;
        bar.style.width = Math.round((p.progress || 0) * 100) + '%';
        const idx = p.state?.job_no ?? 0;
        if (p.current_image) {
          const slot = job.card.querySelectorAll('.placeholder')[Math.min(idx, job.count - 1)];
          if (slot) { let im = $('img', slot); if (!im) { im = el('img'); slot.textContent = ''; slot.append(im); } im.src = toDataURL(p.current_image); }
        }
      } catch { /* transient */ }
      await sleep(700);
    }
  })();
  return () => { alive = false; bar.style.width = '100%'; };
}

/** Turn a txt2img/img2img response into history records. */
async function collectTxt2img(job, res) {
  let info = {}; try { info = JSON.parse(res.info || '{}'); } catch { /* ignore */ }
  const first = info.index_of_first_image || 0;
  const imgs = (res.images || []).slice(first, first + job.count);
  const seeds = info.all_seeds || [];
  const texts = (info.infotexts || []).slice(first);
  const out = [];
  for (let i = 0; i < imgs.length; i++) {
    const blob = await dataURLToBlob(toDataURL(imgs[i]));
    const { w, h } = await imgSize(blob);
    const st = { ...job.st, seed: seeds[i] ?? job.st.seed };
    const r = { id: uid(), created: Date.now() + i, kind: job.kind, blob, w, h, seed: seeds[i] ?? -1, model: S.model, vae: job.st.vae || 'Automatic', infotext: texts[i] || '', params: st, parent: job.parent || null, fav: false };
    await DB.put(r); out.push(r);
  }
  if (out.length) { S.lastRecord = out[0]; renderSeedLast(); }
  return out;
}

/* ---------------------------------------------------------------- task cards */
function taskCard(job) {
  $('#feed-empty')?.remove();
  const c = el('div', 'task');
  c.innerHTML = `<div class="task-head"><span class="task-kind">${KIND_LABEL[job.kind] || job.kind}</span><span class="task-title"></span><div class="task-actions"></div></div><div class="progress"><i></i></div><div class="task-grid n${Math.min(job.count, 3)}"></div>`;
  $('.task-title', c).textContent = job.title || '';
  $('.task-title', c).title = job.title || '';
  const grid = $('.task-grid', c);
  for (let i = 0; i < job.count; i++) {
    const t = el('div', 'thumb-card'); t.style.cursor = 'default';
    const ph = el('div', 'placeholder', i === 0 ? 'En cola…' : ''); ph.style.setProperty('--ar', job.ar || 0.75);
    t.append(ph); grid.append(t);
  }
  $('#feed').prepend(c);
  return c;
}
function updateTaskActions(job) {
  const a = $('.task-actions', job.card); a.innerHTML = '';
  const btn = (label, ic, fn, title) => { const b = el('button', 'ghost-btn', (ic ? icon(ic) : '') + esc(label)); b.type = 'button'; if (title) b.title = title; b.onclick = fn; a.append(b); return b; };
  if (job.state === 'queued' || job.state === 'running') {
    const ph = $('.placeholder', job.card); if (ph && job.state === 'running' && ph.textContent === 'En cola…') ph.textContent = 'Generando…';
    if (job.state === 'running' && job.count > 1) btn('Saltar', '', () => api('/sdapi/v1/skip', {}).catch(() => {}), 'Saltar la imagen actual');
    btn('Cancelar', 'x', () => cancelJob(job));
  } else if (job.state === 'done') {
    if (job.records.length > 1) btn('Comparar', 'grid', () => openCompare(job.records));
    if (job.kind === 'img2img') btn('Otra vez', 'redo', () => enqueue({ ...job, card: null, records: null }), 'Repetir (seed nueva si era aleatoria)');
    if (job.kind === 'txt2img') btn('Otra vez', 'redo', () => { const st = { ...job.st, seed: -1 }; enqueue({ ...job, st, card: null, records: null, exec: () => api('/sdapi/v1/txt2img', txt2imgPayload(st)) }); }, 'Mismos ajustes, seeds nuevas');
  } else if (job.state === 'error' || job.state === 'cancelled') {
    btn('Quitar', 'x', () => job.card.remove());
  }
}
function cancelJob(job) {
  if (job.state === 'queued') {
    S.queue = S.queue.filter((j) => j !== job); job.state = 'cancelled'; job.card.remove(); setStatus();
  } else if (job.state === 'running') {
    api('/sdapi/v1/interrupt', {}).catch(() => {});
    toast('Cancelando… (se conserva lo ya generado)');
  }
}
function fillTask(job) {
  $('.progress', job.card)?.remove();
  const grid = $('.task-grid', job.card); grid.innerHTML = '';
  grid.className = `task-grid n${Math.min(job.records.length, 3)}`;
  if (!job.records.length) grid.append(el('div', 'task-error', 'Cancelado, sin imágenes.'));
  job.records.forEach((r) => grid.append(thumb(r, job.records)));
  updateTaskActions(job);
  if (!$('#view-gallery').classList.contains('active')) return;
  renderGallery();
}

function thumb(r, list) {
  const t = el('div', 'thumb-card'); t.dataset.id = r.id;
  const img = el('img'); img.src = recURL(r); img.alt = ''; img.loading = 'lazy'; t.append(img);
  const badges = el('div', 'badges');
  if (r.kind !== 'txt2img') badges.append(el('span', 'badge', esc(KIND_LABEL[r.kind])));
  if (r.w) badges.append(el('span', 'badge', `${r.w}×${r.h}`));
  if (r.seed >= 0) {
    const sb = el('button', 'badge seed-badge', `seed ${r.seed}`); sb.type = 'button'; sb.title = 'Copiar seed';
    sb.onclick = (e) => { e.stopPropagation(); copyText(String(r.seed), 'Seed copiada'); };
    badges.append(sb);
  }
  t.append(badges);
  const hb = el('div', 'hover-bar');
  const hbtn = (label, title, fn) => { const b = el('button', '', label); b.type = 'button'; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; hb.append(b); };
  hbtn('Usar como base', 'Editar esta imagen (img2img)', () => setBase(r.blob, 'De mis creaciones'));
  if (r.seed >= 0) hbtn('Fijar seed', 'Usar esta seed en Generar', () => { S.st.seed = r.seed; syncUI(); persist(); toast(`Seed fijada: ${r.seed}`, 'ok'); });
  t.append(hb);
  const fav = el('button', 'fav' + (r.fav ? ' on' : ''), icon('star')); fav.type = 'button'; fav.title = 'Favorita';
  fav.onclick = (e) => { e.stopPropagation(); toggleFav(r); };
  t.append(fav);
  t.onclick = () => openLightbox(list, list.indexOf(r));
  return t;
}
async function toggleFav(r) {
  r.fav = !r.fav; await DB.put(r);
  $$(`[data-id="${r.id}"] .fav`).forEach((b) => b.classList.toggle('on', r.fav));
  if (LB.list[LB.i] === r) $('#lb-fav').classList.toggle('on', r.fav);
  CMP.cells.forEach((c) => { if (c.r === r) { c.el.classList.toggle('fav', r.fav); $('.cmp-fav', c.el).classList.toggle('on', r.fav); } });
}

/* ======================================================================= improve existing image */
async function improve(r, mode) {
  if (!S.apiOk) { toast('Sin conexión con la API.', 'err'); return; }
  const src = await blobToDataURL(r.blob);
  const st = { ...DEFAULTS, ...(r.params || {}) };
  const base = { prompt: fullPrompt(st), negative_prompt: st.negative, sampler_name: st.sampler, scheduler: st.scheduler, cfg_scale: st.cfg, init_images: [src], save_images: true, send_images: true, override_settings: { CLIP_stop_at_last_layers: st.clip, sd_vae: resolveVae(r.vae || st.vae) || S.st.vae } };
  let job;
  if (mode === 'upscale') {
    job = { kind: 'upscale', title: `${r.w}×${r.h} → ${r.w * 2}×${r.h * 2} (${S.ultra})`, count: 1, ar: r.w / r.h, st, parent: r.id,
      exec: () => api('/sdapi/v1/extra-single-image', { image: src, upscaling_resize: 2, upscaler_1: S.ultra }),
      collect: (res) => collectTxt2img(job, { images: [res.image], info: JSON.stringify({ all_seeds: [r.seed], infotexts: [r.infotext] }) }) };
  } else if (mode === 'refine') {
    const k = Math.min(1.5, 2048 / Math.max(r.w, r.h));
    const w = r8(r.w * Math.max(1, k)), h = r8(r.h * Math.max(1, k));
    job = { kind: 'refine', title: `Refinar ${r.w}×${r.h} → ${w}×${h}`, count: 1, ar: w / h, st: { ...st, width: w, height: h }, parent: r.id,
      exec: () => api('/sdapi/v1/img2img', { ...base, width: w, height: h, steps: 24, denoising_strength: 0.3, seed: r.seed ?? -1,
        override_settings: { ...base.override_settings, upscaler_for_img2img: S.ultra } }) };
  } else if (mode === 'fix') {
    job = { kind: 'fix', title: 'Arreglar caras y manos', count: 1, ar: r.w / r.h, st, parent: r.id,
      exec: () => api('/sdapi/v1/img2img', { ...base, width: r.w, height: r.h, steps: 20, denoising_strength: 0.1, seed: r.seed ?? -1, alwayson_scripts: adArgs(true, st) }) };
  } else if (mode === 'variation') {
    const d = +$('#var-strength').value;
    job = { kind: 'variation', title: `Variación (cambio ${d})`, count: 1, ar: r.w / r.h, st: { ...st, width: r.w, height: r.h }, parent: r.id,
      exec: () => api('/sdapi/v1/img2img', { ...base, width: r8(r.w), height: r8(r.h), steps: st.steps, denoising_strength: d, seed: -1 }) };
  }
  closeLightbox(); showView('generate');
  enqueue(job);
}

/* ======================================================================= lightbox */
const LB = { list: [], i: 0 };
function openLightbox(list, i) {
  LB.list = list; LB.i = Math.max(0, i); $('#lightbox').hidden = false; renderLightbox();
}
function closeLightbox() { $('#lightbox').hidden = true; }
function renderLightbox() {
  const r = LB.list[LB.i]; if (!r) { closeLightbox(); return; }
  $('#lb-img').src = recURL(r);
  $('#lb-prev').hidden = LB.i <= 0; $('#lb-next').hidden = LB.i >= LB.list.length - 1;
  $('#lb-fav').classList.toggle('on', !!r.fav);
  renderParams($('#lb-meta'), parseInfotext(r.infotext), r);
  $('#lb-seed').disabled = !(r.seed >= 0);
}
function bindLightbox() {
  $('#lb-prev').onclick = () => { LB.i--; renderLightbox(); };
  $('#lb-next').onclick = () => { LB.i++; renderLightbox(); };
  $('#lb-fav').onclick = () => toggleFav(LB.list[LB.i]);
  $('#lb-download').onclick = () => { const r = LB.list[LB.i]; const a = el('a'); a.href = recURL(r); a.download = `studio-${r.seed >= 0 ? r.seed : r.id}.png`; a.click(); };
  $('#lb-delete').onclick = async () => {
    const r = LB.list[LB.i]; await DB.del(r.id);
    $$(`[data-id="${r.id}"]`).forEach((n) => n.remove());
    LB.list.splice(LB.i, 1); if (LB.i >= LB.list.length) LB.i--;
    toast('Borrada del historial (el archivo en outputs/ se mantiene).');
    renderLightbox();
  };
  $$('[data-improve]').forEach((b) => b.onclick = () => improve(LB.list[LB.i], b.dataset.improve));
  $('#var-strength').oninput = (e) => { $('#var-o').textContent = e.target.value; };
  $('#lb-base').onclick = () => { const r = LB.list[LB.i]; closeLightbox(); setBase(r.blob, 'De mis creaciones'); };
  $('#lb-reuse').onclick = async () => { const r = LB.list[LB.i]; closeLightbox(); await applySettings({ ...r.params, checkpoint: r.model, vae: r.vae }, true); showView('generate'); toast('Parámetros cargados.', 'ok'); };
  $('#lb-seed').onclick = () => { const r = LB.list[LB.i]; S.st.seed = r.seed; syncUI(); persist(); toast(`Seed fijada: ${r.seed}`, 'ok'); };
  $('#lb-saveconfig').onclick = () => { const r = LB.list[LB.i]; saveConfig({ ...r.params, checkpoint: r.model, vae: r.vae }, r); };
  $('#lb-cover').onclick = async () => {
    const r = LB.list[LB.i]; const name = r.model || S.model;
    try { await api('/studio/api/preview/checkpoint', { name, image: await blobToDataURL(r.blob) }); S.coverBust = Date.now(); S.previews?.checkpoint.add(name); renderModelCard(); renderModelsPage(); toast('Portada actualizada para ' + shortName(name), 'ok'); }
    catch (e) { toast('No se pudo guardar portada: ' + e.message, 'err'); }
  };
}

/* ======================================================================= compare */
const CMP = { cells: [], s: 1, x: 0, y: 0 };
function openCompare(records) {
  const box = $('#compare'); const grid = $('#compare-grid'); grid.innerHTML = '';
  const n = records.length; const ar = (records[0].w / records[0].h) || 0.75;
  const vw = window.innerWidth, vh = window.innerHeight - 70;
  let best = 1, bestSize = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols); const cw = vw / cols, ch = vh / rows;
    const size = Math.min(cw, ch * ar); if (size > bestSize) { bestSize = size; best = cols; }
  }
  grid.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
  CMP.cells = []; CMP.s = 1; CMP.x = 0; CMP.y = 0;
  records.forEach((r) => {
    const c = el('div', 'cmp-cell' + (r.fav ? ' fav' : ''));
    const img = el('img'); img.src = recURL(r); img.alt = ''; c.append(img);
    const bar = el('div', 'cmp-bar', `<span class="badge">Seed ${r.seed >= 0 ? r.seed : '—'}</span>`);
    const mk = (cls, html, title, fn) => { const b = el('button', cls, html); b.type = 'button'; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.append(b); return b; };
    mk('cmp-fav' + (r.fav ? ' on' : ''), icon('star'), 'Favorita', () => toggleFav(r));
    mk('', 'Fijar seed', 'Usar esta seed', () => { S.st.seed = r.seed; syncUI(); persist(); toast(`Seed fijada: ${r.seed}`, 'ok'); });
    mk('', 'Abrir', 'Ver en grande', () => openLightbox(records, records.indexOf(r)));
    c.append(bar);
    grid.append(c); CMP.cells.push({ el: c, img, r });
  });
  box.hidden = false; applyCmp();
}
function applyCmp() { CMP.cells.forEach((c) => { c.img.style.transform = `translate(${CMP.x}px, ${CMP.y}px) scale(${CMP.s})`; }); }
function bindCompare() {
  const grid = $('#compare-grid'); let drag = null;
  grid.addEventListener('wheel', (e) => {
    const cell = e.target.closest('.cmp-cell'); if (!cell) return; e.preventDefault();
    const rect = cell.getBoundingClientRect(); const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const ns = Math.min(8, Math.max(1, CMP.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    CMP.x = px - (px - CMP.x) * (ns / CMP.s); CMP.y = py - (py - CMP.y) * (ns / CMP.s); CMP.s = ns;
    if (ns === 1) { CMP.x = 0; CMP.y = 0; }
    applyCmp();
  }, { passive: false });
  grid.addEventListener('pointerdown', (e) => { if (e.target.closest('button') || !e.target.closest('.cmp-cell')) return; drag = { x: e.clientX - CMP.x, y: e.clientY - CMP.y }; grid.setPointerCapture(e.pointerId); });
  grid.addEventListener('pointermove', (e) => { if (!drag) return; CMP.x = e.clientX - drag.x; CMP.y = e.clientY - drag.y; applyCmp(); });
  grid.addEventListener('pointerup', () => { drag = null; });
  grid.addEventListener('dblclick', () => { CMP.s = 1; CMP.x = 0; CMP.y = 0; applyCmp(); });
}

/* ======================================================================= gallery */
async function renderGallery() {
  const all = (await DB.all()).sort((a, b) => b.created - a.created);
  const onlyFav = $('#only-favs').checked;
  const list = onlyFav ? all.filter((r) => r.fav) : all;
  const g = $('#gallery'); g.innerHTML = '';
  list.forEach((r) => g.append(thumb(r, list)));
  $('#gallery-empty').hidden = list.length > 0;
}
async function handleUpload(file) {
  if (!file) return;
  const blob = file.slice(0, file.size, file.type);
  const { w, h } = await imgSize(blob);
  const parsed = await readImageInfo(blob);
  const cfg = parsed ? infotextToSettings(parsed) : {};
  const params = { ...DEFAULTS, prompt: '', loras: [], width: w, height: h, ...snapshot(cfg) };
  const r = { id: uid(), created: Date.now(), kind: 'upload', blob, w, h, seed: cfg.seed ?? -1, model: cfg.checkpoint || S.model, vae: cfg.vae || S.st.vae, infotext: parsed?.raw || '', params, fav: false };
  await DB.put(r);
  await renderGallery();
  openLightbox([r], 0);
}

/* ======================================================================= configs (server-side presets) */
const CONFIG_KEYS = ['prompt', 'negative', 'aspect', 'width', 'height', 'quality', 'count', 'seed', 'sampler', 'scheduler', 'steps', 'cfg', 'clip', 'hires', 'hrScale', 'hrDenoise', 'hrSteps', 'hrUpscaler', 'adetailer', 'adDenoise', 'adConfidence', 'subseed', 'subseedStrength', 'loras', 'vae'];
function snapshot(src) { const o = {}; CONFIG_KEYS.forEach((k) => { if (src[k] !== undefined) o[k] = JSON.parse(JSON.stringify(src[k])); }); return o; }

/** Apply saved settings; optionally switch checkpoint/VAE when they differ. */
async function applySettings(cfg, switchModel) {
  const snap = snapshot(cfg);
  if (snap.seed === undefined) snap.seed = -1;
  Object.assign(S.st, snap);
  if (!ASPECTS.some((a) => a.id === S.st.aspect && (a.id === 'custom' || (a.w === S.st.width && a.h === S.st.height)))) {
    const match = ASPECTS.find((a) => a.w === S.st.width && a.h === S.st.height); S.st.aspect = match ? match.id : 'custom';
  }
  const missing = S.st.loras.filter((l) => !S.loras.some((x) => x.name === l.name));
  if (missing.length) toast('LoRAs no encontradas: ' + missing.map((l) => l.name).join(', '), 'err');
  S.st.loras = S.st.loras.filter((l) => !missing.includes(l));
  if (snap.vae !== undefined) {
    const vae = resolveVae(snap.vae);
    if (!vae) toast('VAE no encontrado: ' + snap.vae, 'err');
    S.st.vae = vae || 'Automatic';
  }
  syncUI(); persist(); renderModelCard(); renderModelsPage();
  if (switchModel) {
    if (cfg.checkpoint && cfg.checkpoint !== S.model) {
      const m = S.models.find((x) => x.title === cfg.checkpoint || shortName(x.title) === shortName(cfg.checkpoint));
      if (m) await setCheckpoint(m.title); else toast('Modelo no encontrado: ' + shortName(cfg.checkpoint), 'err');
    }
  }
}

async function smallThumb(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = 320 / Math.max(img.width, img.height);
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

function askName(title, value, checkLabel) {
  return new Promise((resolve) => {
    const d = $('#dialog'); d.hidden = false;
    $('#dialog-title').textContent = title;
    const inp = $('#dialog-input'); inp.value = value || '';
    $('#dialog-check-wrap').hidden = !checkLabel; $('#dialog-check').checked = false; $('#dialog-check-label').textContent = checkLabel || '';
    const done = (v) => { d.hidden = true; $('#dialog-ok').onclick = null; inp.onkeydown = null; d.onclose = null; resolve(v); };
    $('#dialog-ok').onclick = () => done({ value: inp.value.trim(), checked: $('#dialog-check').checked });
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#dialog-ok').click(); if (e.key === 'Escape') done(null); };
    d.onclose = () => done(null);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

function saveCurrentConfig() { saveConfig({ ...S.st, checkpoint: S.model }, S.lastRecord); }
async function saveConfig(src, rec) {
  const suggestion = (src.prompt || '').split(',')[0].slice(0, 40);
  const ans = await askName('Guardar config', suggestion, src.seed >= 0 ? `Incluir seed (${src.seed})` : '');
  if (!ans || !ans.value) return;
  const settings = { ...snapshot(src), checkpoint: src.checkpoint, vae: src.vae };
  if (!ans.checked) settings.seed = -1;
  try {
    await api('/studio/api/presets', { name: ans.value, settings, thumb: rec ? await smallThumb(rec.blob) : null });
    toast('Config guardada: ' + ans.value, 'ok');
    if ($('#view-configs').classList.contains('active')) renderConfigs();
  } catch (e) { toast('No se pudo guardar: ' + e.message, 'err'); }
}

async function renderConfigs() {
  let items = [];
  try { items = await api('/studio/api/presets'); } catch (e) { toast('No se pudieron leer configs: ' + e.message, 'err'); }
  const g = $('#config-grid'); g.innerHTML = '';
  $('#configs-empty').hidden = items.length > 0;
  items.forEach((p) => {
    const s = p.settings || {};
    const card = el('div', 'm-card');
    const cover = el('div', 'cover', esc((p.name || '?').slice(0, 1).toUpperCase()));
    if (p.thumb) cover.style.backgroundImage = `url("${p.thumb}")`, cover.textContent = '';
    card.append(cover);
    const sub = [shortName(s.checkpoint), s.width && `${s.width}×${s.height}`, (s.loras || []).length && `${s.loras.length} LoRA`].filter(Boolean).join(' · ');
    const body = el('div', 'body', `<div class="title">${esc(p.name)}</div><div class="sub">${esc(sub)}</div><div class="sub" style="opacity:.7">${esc((s.prompt || '').slice(0, 90))}</div>`);
    const row = el('div', 'row');
    const mk = (label, fn, cls = 'ghost-btn') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; row.append(b); return b; };
    mk('Cargar', async () => { await applySettings(s, true); showView('generate'); toast('Config cargada: ' + p.name, 'ok'); });
    mk(icon('bookmark'), async () => {
      const ans = await askName('Renombrar', p.name); if (!ans || !ans.value) return;
      await api('/studio/api/presets', { ...p, name: ans.value }); renderConfigs();
    }).title = 'Renombrar';
    mk(icon('trash'), async () => {
      if (!confirm(`¿Borrar la config "${p.name}"?`)) return;
      await api('/studio/api/presets/' + encodeURIComponent(p.id), undefined, 'DELETE'); renderConfigs();
    }).title = 'Borrar';
    $$('button', row).slice(1).forEach((b) => { b.style.flex = 'none'; b.style.width = '36px'; });
    body.append(row); card.append(body); g.append(card);
  });
}
async function exportConfigs() {
  const items = await api('/studio/api/presets');
  const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }));
  a.download = 'studio-configs.json'; a.click();
}
async function importConfigs(file) {
  if (!file) return;
  try {
    const items = JSON.parse(await file.text());
    if (!Array.isArray(items)) throw new Error('formato inválido');
    for (const p of items) if (p && p.name && p.settings) await api('/studio/api/presets', { id: p.id, name: p.name, settings: p.settings, thumb: p.thumb || null });
    toast(`${items.length} configs importadas.`, 'ok'); renderConfigs();
  } catch (e) { toast('Import falló: ' + e.message, 'err'); }
}

/* ======================================================================= infotext (PNG Info) */
const LORA_RE = /<lora:([^:>]+):([\d.\-]+)(?::[^>]*)?>/g;

/** Parse an A1111-style "parameters" text into { prompt, negative, params{Key: value}, raw }. */
function parseInfotext(text) {
  if (!text || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  const params = {};
  const last = lines[lines.length - 1];
  if (/(^|,\s*)Steps: /.test(last)) {
    lines.pop();
    for (const m of last.matchAll(/\s*([^,:"]+?):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g)) {
      let v = m[2].trim();
      if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
      params[m[1].trim()] = v;
    }
  }
  const pos = [], neg = []; let inNeg = false;
  lines.forEach((l) => {
    if (l.startsWith('Negative prompt:')) { inNeg = true; l = l.slice(16).trim(); }
    (inNeg ? neg : pos).push(l);
  });
  return { prompt: pos.join('\n').trim(), negative: neg.join('\n').trim(), params, raw: text };
}

/** Convert parsed infotext into Studio settings (+ checkpoint / vae for applySettings). */
function infotextToSettings(parsed) {
  const P = parsed.params || {};
  const n = (k) => { const v = parseFloat(P[k]); return Number.isFinite(v) ? v : undefined; };
  const cfg = {
    prompt: parsed.prompt.replace(LORA_RE, '').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim().replace(/,$/, ''),
    negative: parsed.negative,
    loras: [...parsed.prompt.matchAll(LORA_RE)].map((m) => ({ name: m[1], weight: +m[2] })),
  };
  const set = (key, v) => { if (v !== undefined && v !== '') cfg[key] = v; };
  set('steps', n('Steps')); set('cfg', n('CFG scale')); set('seed', n('Seed'));
  cfg.clip = n('Clip skip') ?? 1; // A1111 omits Clip skip when it is 1
  if (P.Sampler) {
    let sm = P.Sampler, sch = P['Schedule type'];
    if (!sch && / Karras$/.test(sm)) { sm = sm.replace(/ Karras$/, ''); sch = 'Karras'; }
    cfg.sampler = sm; if (sch) cfg.scheduler = sch;
  }
  if (P.Size) { const [w, h] = String(P.Size).split('x').map(Number); if (w && h) { cfg.width = w; cfg.height = h; } }
  cfg.hires = P['Hires upscale'] !== undefined || P['Hires upscaler'] !== undefined;
  if (cfg.hires) { set('hrScale', n('Hires upscale')); set('hrUpscaler', P['Hires upscaler']); set('hrSteps', n('Hires steps')); set('hrDenoise', n('Denoising strength')); }
  set('subseed', n('Variation seed')); cfg.subseedStrength = n('Variation seed strength') ?? 0;
  cfg.adetailer = !!(P['ADetailer model'] || P['ADetailer model 2nd']);
  set('adDenoise', n('ADetailer denoising strength')); set('adConfidence', n('ADetailer confidence'));
  cfg.quality = Object.keys(QUALITY).find((q) => QUALITY[q].steps === cfg.steps && QUALITY[q].hires === cfg.hires && QUALITY[q].adetailer === cfg.adetailer) || 'custom';
  if (P.Model) cfg.checkpoint = P.Model;
  if (P.VAE) cfg.vae = P.VAE;
  return cfg;
}

const latin1 = (b) => new TextDecoder('latin1').decode(b);
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
/** Read the "parameters" text chunk straight from PNG bytes (works offline). */
async function readPngText(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.length < 16 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return '';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const found = {}; let o = 8;
  while (o + 8 <= buf.length) {
    const len = dv.getUint32(o); const type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const z = data.indexOf(0); const key = latin1(data.subarray(0, z));
      try {
        if (type === 'tEXt') found[key] = latin1(data.subarray(z + 1));
        else if (type === 'zTXt') found[key] = latin1(await inflate(data.subarray(z + 2)));
        else {
          const comp = data[z + 1]; let q = data.indexOf(0, z + 3) + 1; q = data.indexOf(0, q) + 1;
          let bytes = data.subarray(q); if (comp) bytes = await inflate(bytes);
          found[key] = new TextDecoder().decode(bytes);
        }
      } catch { /* unreadable chunk */ }
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return found.parameters || '';
}
/**
 * Generation parameters of an image, or null.
 * PNG: read locally from text chunks only. Asking the server about a PNG without text would only
 * add its "stealth" pixel scan, which is slow, blocks the server's GIL and stalls running generations.
 * Other formats (JPEG/WebP): ask the server, which reads EXIF.
 */
async function readImageInfo(blob) {
  let text = '';
  try { text = await readPngText(blob); } catch { /* not png */ }
  const sig = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
  if (!text && !isPng && S.apiOk) { try { text = (await api('/sdapi/v1/png-info', { image: await blobToDataURL(blob) })).info || ''; } catch { /* no info */ } }
  return parseInfotext(text);
}

function copyText(text, msg = 'Copiado') {
  const done = () => toast(msg, 'ok');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  function fallback() {
    const ta = el('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('No se pudo copiar', 'err'); } ta.remove();
  }
}

const PARAM_ROWS = [
  ['Seed', 'Seed'], ['Tamaño', 'Size'], ['Pasos', 'Steps'], ['Sampler', 'Sampler'], ['Scheduler', 'Schedule type'], ['CFG', 'CFG scale'],
  ['Modelo', 'Model'], ['Hash modelo', 'Model hash'], ['VAE', 'VAE'], ['Clip skip', 'Clip skip'], ['Denoise', 'Denoising strength'],
  ['Hires escala', 'Hires upscale'], ['Hires upscaler', 'Hires upscaler'], ['Hires pasos', 'Hires steps'],
  ['Seed variación', 'Variation seed'], ['Fuerza variación', 'Variation seed strength'],
  ['ADetailer', 'ADetailer model'], ['ADetailer 2', 'ADetailer model 2nd'], ['ADetailer fuerza', 'ADetailer denoising strength'],
];
/** Render the important generation parameters (with copy buttons) into a <dl class="params">. */
function renderParams(dl, parsed, rec) {
  dl.innerHTML = '';
  const add = (label, value, cls = '') => {
    if (value === undefined || value === null || value === '') return;
    const big = cls === 'big';
    dl.append(el('dt', big ? 'big' : '', esc(label)));
    const dd = el('dd', cls); dd.textContent = value; dl.append(dd);
    const cp = el('button', 'cp', icon('copy')); cp.type = 'button'; cp.title = 'Copiar'; cp.onclick = () => copyText(String(value), label + ' copiado'); dl.append(cp);
  };
  if (rec) add('Tipo', KIND_LABEL[rec.kind] || rec.kind);
  if (rec?.w) add('Resultado', `${rec.w} × ${rec.h}`);
  const P = parsed?.params || {};
  if (Object.keys(P).length) {
    PARAM_ROWS.forEach(([label, key]) => add(label, P[key], key === 'Seed' ? 'seed' : ''));
  } else if (rec?.params) {
    const st = rec.params;
    add('Seed', rec.seed >= 0 ? rec.seed : undefined, 'seed');
    add('Modelo', shortName(rec.model));
    if (st.steps) { add('Pasos', st.steps); add('Sampler', st.sampler); add('Scheduler', st.scheduler); add('CFG', st.cfg); }
  }
  const prompt = parsed ? parsed.prompt : rec?.params?.prompt;
  const loras = parsed ? [...parsed.prompt.matchAll(LORA_RE)].map((m) => `${loraLabel(m[1])} (${m[2]})`) : (rec?.params?.loras || []).map((l) => `${loraLabel(l.name)} (${l.weight})`);
  if (loras.length) add('LoRAs', loras.join(', '));
  add('Prompt', prompt, 'big');
  add('Negativo', parsed ? parsed.negative : rec?.params?.negative, 'big');
  if (rec) add('Fecha', new Date(rec.created).toLocaleString());
  if (!dl.children.length) dl.append(el('dd', 'muted', 'Sin parámetros guardados.'));
}

/* ======================================================================= base image (img2img) */
async function setBase(blob, src) {
  const [dataURL, size] = await Promise.all([blobToDataURL(blob), imgSize(blob)]);
  if (!size.w) { toast('No se pudo leer la imagen.', 'err'); return; }
  if (S.base?.url) URL.revokeObjectURL(S.base.url);
  S.base = { blob, dataURL, w: size.w, h: size.h, src, info: null, url: URL.createObjectURL(blob) };
  closeLightbox(); $('#picker').hidden = true;
  showView('generate'); syncUI(); setStatus();
  $('#base-block').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const info = await readImageInfo(blob);
  if (S.base && S.base.blob === blob) { S.base.info = info; renderBase(); }
}
function clearBase() { if (S.base?.url) URL.revokeObjectURL(S.base.url); S.base = null; syncUI(); setStatus(); }
function renderBase() {
  const b = S.base, st = S.st;
  $('#base-drop').hidden = !!b; $('#base-pick').hidden = !!b; $('#base-set').hidden = !b;
  if (!b) return;
  if ($('#base-img').getAttribute('src') !== b.url) $('#base-img').src = b.url;
  $('#base-dims').textContent = `${b.w} × ${b.h}`;
  $('#base-src').textContent = b.src + (b.info?.params?.Seed ? ` · seed ${b.info.params.Seed}` : '');
  $('#base-useinfo').hidden = !(b.info && b.info.prompt);
  $$('#base-modes button').forEach((x) => x.classList.toggle('active', Math.abs(+x.dataset.d - st.baseDenoise) < 0.001));
  $('#base-tip').hidden = st.baseDenoise < 0.6;
  $$('#base-size .chip').forEach((c) => c.classList.toggle('active', c.dataset.v === st.baseSize));
  $$('#base-fit .chip').forEach((c) => c.classList.toggle('active', +c.dataset.v === +st.baseFit));
}
function bindBase() {
  const drop = $('#base-drop'), file = $('#base-file');
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  file.onchange = (e) => { const f = e.target.files[0]; if (f) setBase(f, 'Subida: ' + f.name); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  $('#base-pick').onclick = () => openPicker('history');
  $('#base-change').onclick = () => file.click();
  $('#base-clear').onclick = clearBase;
  $('#base-useinfo').onclick = async () => { if (!S.base?.info) return; await applySettings(infotextToSettings(S.base.info), true); toast('Prompt y ajustes de la imagen cargados.', 'ok'); };
  $$('#base-modes button').forEach((b) => b.onclick = () => { S.st.baseMode = b.dataset.mode; S.st.baseDenoise = +b.dataset.d; syncUI(); persist(); });
  $$('#base-size .chip').forEach((c) => c.onclick = () => { S.st.baseSize = c.dataset.v; syncUI(); persist(); });
  $$('#base-fit .chip').forEach((c) => c.onclick = () => { S.st.baseFit = +c.dataset.v; syncUI(); persist(); });
}
function renderSeedLast() {
  const b = $('#seed-last'); const sd = S.lastRecord?.seed;
  b.hidden = !(sd >= 0); if (sd >= 0) { b.textContent = `Última: ${sd} ↺`; b.title = 'Usar la seed de la última imagen'; }
}

/* ======================================================================= PNG Info view */
async function showPngInfo(blob) {
  if (S.pngInfo?.url) URL.revokeObjectURL(S.pngInfo.url);
  const url = URL.createObjectURL(blob);
  const parsed = await readImageInfo(blob);
  S.pngInfo = { blob, url, parsed };
  $('#pi-drop').hidden = true; $('#pi-result').hidden = false;
  $('#pi-img').src = url;
  $('#pi-empty').hidden = !!parsed;
  $('#pi-send').disabled = !parsed; $('#pi-copy').disabled = !parsed;
  renderParams($('#pi-params'), parsed, null);
  $('#pi-raw').textContent = parsed?.raw || ''; $('#view-pnginfo .raw').hidden = !parsed;
}
function bindPngInfo() {
  const drop = $('#pi-drop'), file = $('#pi-file');
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  file.onchange = (e) => { const f = e.target.files[0]; if (f) showPngInfo(f); e.target.value = ''; };
  $('#pi-other').onclick = () => file.click();
  $('#pi-send').onclick = async () => { if (!S.pngInfo?.parsed) return; await applySettings(infotextToSettings(S.pngInfo.parsed), true); showView('generate'); toast('Parámetros enviados a Generar.', 'ok'); };
  $('#pi-base').onclick = () => { if (S.pngInfo) setBase(S.pngInfo.blob, 'Desde PNG Info'); };
  $('#pi-copy').onclick = () => { if (S.pngInfo?.parsed) copyText(S.pngInfo.parsed.raw, 'Parámetros copiados'); };
}

/* ======================================================================= navigation & boot */
function showView(v) {
  $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'gallery') renderGallery();
  if (v === 'configs') renderConfigs();
  if (v === 'models') renderModelsPage();
}

function bindGlobal() {
  $$('.nav-btn[data-view]').forEach((b) => b.onclick = () => showView(b.dataset.view));
  $$('[data-close]').forEach((b) => b.onclick = () => {
    const m = b.closest('.modal, .lightbox, .compare'); m.hidden = true;
    if (m.id === 'dialog' && m.onclose) m.onclose();
    if (m.id === 'picker') renderLoraChips();
  });
  $('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') { e.target.hidden = true; renderLoraChips(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#dialog').hidden) return;
      if (!$('#lightbox').hidden) closeLightbox();
      else if (!$('#compare').hidden) $('#compare').hidden = true;
      else if (!$('#picker').hidden) { $('#picker').hidden = true; renderLoraChips(); }
    }
    if (!$('#lightbox').hidden && !e.target.matches('input, textarea')) {
      if (e.key === 'ArrowLeft' && LB.i > 0) { LB.i--; renderLightbox(); }
      if (e.key === 'ArrowRight' && LB.i < LB.list.length - 1) { LB.i++; renderLightbox(); }
    }
  });
  $('#only-favs').onchange = renderGallery;
  $('#upload').onchange = (e) => { handleUpload(e.target.files[0]); e.target.value = ''; };
  $('#refresh-models').onclick = async () => {
    busy('Refrescando…');
    try { await Promise.all([api('/sdapi/v1/refresh-checkpoints', {}), api('/sdapi/v1/refresh-vae', {}), api('/sdapi/v1/refresh-loras', {}).catch(() => {})]); } catch { /* ignore */ }
    busy(''); S.coverBust = Date.now(); await loadServer(); toast('Listas actualizadas.', 'ok');
  };
  $('#lora-search-page').oninput = (e) => renderLoraGrid($('#lora-grid-page'), e.target.value);
  $('#export-configs').onclick = exportConfigs;
  $('#import-configs').onchange = (e) => { importConfigs(e.target.files[0]); e.target.value = ''; };
  // drop an image anywhere -> upload to history
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault(); $$('.dropzone.over').forEach((d) => d.classList.remove('over'));
    const f = e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
    const v = ($('.view.active')?.id || '').slice(5);
    if (v === 'pnginfo') showPngInfo(f);
    else if (v === 'generate') setBase(f, 'Subida: ' + f.name);
    else { showView('gallery'); handleUpload(f); }
  });
  window.addEventListener('beforeunload', (e) => { if (S.running || S.queue.length) { e.preventDefault(); e.returnValue = ''; } });
}

(async function boot() {
  hydrateIcons();
  enhanceRanges();
  document.addEventListener('input', (e) => { if (e.target.matches?.('input[type=range]')) paintRange(e.target); });
  renderStatic(); bindInputs(); bindLightbox(); bindCompare(); bindGlobal(); bindPngInfo();
  syncUI(); setStatus();
  await loadServer();
  setInterval(async () => { if (!S.apiOk) await loadServer(); }, 5000);
})();
