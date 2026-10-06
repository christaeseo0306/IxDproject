/* ══════════════════════════════════════════════════════════════
   Virtual FaceTime — 가상 영상통화 프레젠테이션 프로토타입

   상태 흐름 : gate → calling → live(파트1) → cctv(파트2) → ended
   조작      : → 다음 / ← 이전 / R 다시 / F 전체화면 / M 마이크 / C 카메라
               H 발표자 패널 / 1–9 바로가기 / Esc 종료
   ══════════════════════════════════════════════════════════════ */
'use strict';

const $ = (s) => document.querySelector(s);
const body = document.body;

/* ── 기본값 (videos.json 이 덮어씀) ───────────────────────────── */
const DEFAULTS = {
  caller: { name: 'Unknown', avatar: '', initials: '' },
  options: {
    fit: 'cover',              // cover | contain
    glitchMs: 700,             // CCTV 진입 글리치 길이
    showSelfInCctv: true,      // CCTV 파트에 내 카메라 썸네일 표시
    cctvClock: '2026-10-08T21:14:03',
    ringtone: true,
    backdrop: '',              // 창 뒤 바탕화면 이미지 (예: assets/desktop.jpg)
    startFullscreen: false,
  },
  clips: [],
};

/* 영상이 아직 없을 때 쓰는 리허설용 더미 시퀀스 */
const DEMO_CLIPS = [
  { part: 'call', label: 'Connecting — first hello' },
  { part: 'call', label: 'Introduction' },
  { part: 'call', label: 'How the day went' },
  { part: 'call', label: 'Asking a question' },
  { part: 'cctv', label: 'Morning', cam: 'CAM 03', location: 'LIVING ROOM' },
  { part: 'cctv', label: 'Afternoon', cam: 'CAM 05', location: 'STUDIO' },
  { part: 'cctv', label: 'Night', cam: 'CAM 01', location: 'ENTRANCE' },
];

/* ── 상태 ─────────────────────────────────────────────────────── */
const S = {
  cfg: null,
  clips: [],
  idx: -1,
  cur: 0,                 // players[cur] 가 화면에 보이는 비디오
  stream: null,
  camOn: true,
  muted: false,
  callStart: 0,
  bootAt: Date.now(),
  clipStartAt: Date.now(),
  cctvBase: Date.now(),
  gen: 0,
  primed: false,
  objectUrls: [],
  stored: 0,
  audioCtx: null,
  ringTimer: null,
};

// 임베드 환경에서 body 속성이 유실돼도 동작하도록 초기 상태를 보장합니다
if (!body.dataset.state) body.dataset.state = 'gate';
if (!body.dataset.part) body.dataset.part = 'call';

const players = [$('#vA'), $('#vB')];
const selfFeeds = [$('#self-main'), $('#self-pip'), $('#self-cctv')];

const state = () => body.dataset.state;
const setState = (s) => { body.dataset.state = s; };

/* ══════════════ 설정 로드 ══════════════ */
async function loadConfig() {
  for (const url of ['videos.json', 'videos.sample.json']) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json.clips) && json.clips.length) return normalize(json, url);
    } catch (_) { /* 다음 후보로 */ }
  }
  return normalize({ clips: DEMO_CLIPS }, 'demo');
}

/* 경로에서 앞머리 숫자를 읽습니다 — videos/05 - FitnessRoom.mp4 → 5 */
function numberFromSrc(src) {
  const base = decodeURIComponent(String(src || '')).split('/').pop() || '';
  const m = base.match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function normalize(json, source) {
  return {
    caller: { ...DEFAULTS.caller, ...(json.caller || {}) },
    options: { ...DEFAULTS.options, ...(json.options || {}) },
    clips: (json.clips || []).map((c, i) => ({
      src: c.src || '',
      part: c.part === 'cctv' ? 'cctv' : 'call',
      no: Number.isFinite(c.no) ? c.no : numberFromSrc(c.src),
      label: c.label
        || `Clip ${String(Number.isFinite(c.no) ? c.no : (numberFromSrc(c.src) ?? i)).padStart(2, '0')}`,
      auto: !c.label,
      cam: c.cam || `CAM ${String((i % 8) + 1).padStart(2, '0')}`,
      location: c.location || '',
      loop: !!c.loop,
      fit: c.fit || '',
      date: c.date || '',
    })),
    source,
    manifestClips: [],
  };
}

/* ══════════════ 카메라 ══════════════ */
async function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    body.classList.add('cam-off'); S.camOn = false;
    return { ok: false, reason: 'This browser does not support the camera API.' };
  }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,                       // 하울링 방지 — 마이크는 쓰지 않습니다
    });
    selfFeeds.forEach((v) => { v.srcObject = S.stream; v.play().catch(() => {}); });
    body.classList.remove('cam-off');
    S.camOn = true;
    return { ok: true };
  } catch (err) {
    body.classList.add('cam-off');
    S.camOn = false;
    return {
      ok: false,
      reason: err?.name === 'NotAllowedError'
        ? 'Camera permission denied — continuing without preview.'
        : 'No camera found — continuing without preview.',
    };
  }
}

function toggleCam() {
  if (!S.stream) return toast('Camera unavailable');
  S.camOn = !S.camOn;
  S.stream.getVideoTracks().forEach((t) => { t.enabled = S.camOn; });
  body.classList.toggle('cam-off', !S.camOn);
  $('#btn-cam').classList.toggle('is-off', !S.camOn);
}

function toggleMute() {
  S.muted = !S.muted;
  players.forEach((v) => { v.muted = S.muted; v.volume = 1; });
  $('#btn-mute').classList.toggle('is-off', S.muted);
  toast(S.muted ? 'Muted' : 'Unmuted');
}

/* ══════════════ 벨소리 (WebAudio · 외부 파일 없음) ══════════════ */
function audio() {
  if (!S.audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) S.audioCtx = new AC();
  }
  if (S.audioCtx?.state === 'suspended') S.audioCtx.resume();
  return S.audioCtx;
}

function tone(freq, at, dur, gain = 0.12) {
  const ctx = audio(); if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.05);
}

function startRing() {
  stopRing();
  if (!S.cfg.options.ringtone) return;
  const pattern = () => {
    const notes = [880, 1174.7, 1318.5, 1174.7];
    notes.forEach((f, i) => tone(f, i * 0.17, 0.5, 0.09));
    notes.forEach((f, i) => tone(f, 0.85 + i * 0.17, 0.5, 0.09));
  };
  pattern();
  S.ringTimer = setInterval(pattern, 2600);
}
function stopRing() { if (S.ringTimer) clearInterval(S.ringTimer); S.ringTimer = null; }
function blip(up = true) {
  if (!S.cfg?.options.ringtone) return;
  (up ? [659.3, 880] : [587.3, 392]).forEach((f, i) => tone(f, i * 0.1, 0.35, 0.09));
}

/* ══════════════ 저장소 ══════════════
   드롭한 영상을 IndexedDB 에 보관합니다. 새로고침하거나 브라우저를 다시 열어도
   같은 순서로 그대로 재생됩니다. ── */

const DB_NAME = 'virtual-facetime';
const STORE = 'sequence';

function idb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRun(mode, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

/* 현재 재생 목록 중 파일을 가진 클립을 저장합니다 */
async function saveSequence() {
  const rows = S.clips
    .filter((c) => c._blob)
    .map((c) => ({
      name: c._name, blob: c._blob, part: c.part, label: c.label, auto: !!c.auto, no: c.no,
      cam: c.cam, location: c.location,
    }));
  try {
    if (!rows.length) return idbRun('readwrite', (st) => st.delete('clips'));
    await idbRun('readwrite', (st) => st.put(rows, 'clips'));
    S.stored = rows.length;
  } catch (err) {
    S.stored = 0;
    toast(err?.name === 'QuotaExceededError'
      ? 'Not enough browser storage — put the files in videos/ instead'
      : 'Could not save to this browser');
  }
}

async function restoreSequence() {
  let rows;
  try { rows = await idbRun('readonly', (st) => st.get('clips')); }
  catch (_) { return false; }
  if (!Array.isArray(rows) || !rows.length) return false;
  S.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  S.objectUrls = [];
  S.clips = rows.map((r) => {
    const url = URL.createObjectURL(r.blob);
    S.objectUrls.push(url);
    return {
      src: url, part: r.part === 'cctv' ? 'cctv' : 'call', label: r.label, auto: !!r.auto,
      no: Number.isFinite(r.no) ? r.no : null,
      cam: r.cam, location: r.location || '', loop: false, fit: '', date: '',
      _blob: r.blob, _name: r.name,
    };
  });
  S.cfg.clips = S.clips;
  S.stored = rows.length;
  return true;
}

async function clearSequence() {
  try { await idbRun('readwrite', (st) => st.delete('clips')); } catch (_) { /* 이미 없음 */ }
  S.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  S.objectUrls = [];
  S.stored = 0;
  S.clips = S.cfg.manifestClips.slice();
  S.cfg.clips = S.clips;
  S.idx = -1;
  renderPresenter();
  updateGateNote();
  restart({ silent: true });
  toast('Cleared — using videos/ again');
}

/* ══════════════ 드래그 앤 드롭 ══════════════
   폴더를 만지지 않고 영상 파일(또는 videos 폴더)을 창에 끌어다 놓으면
   파일명 순서대로 재생 목록이 만들어집니다. ── */

const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

/* 빌더(tools/build-manifest.mjs)와 같은 파일명 규칙 */
function parseName(name) {
  const stem = name.replace(/\.[^.]+$/, '');
  const num = stem.match(/^\s*(\d+)/);
  const order = num ? Number(num[1]) : Number.POSITIVE_INFINITY;
  let rest = stem.replace(/^\s*\d+\s*[-_.\s]*/, '');

  let cam = '';
  const camMatch = rest.match(/@\s*cam\s*[-_]?\s*(\d+)/i);
  if (camMatch) { cam = `CAM ${String(camMatch[1]).padStart(2, '0')}`; rest = rest.replace(camMatch[0], ''); }

  let part = '';
  const partMatch = rest.match(/(^|[-_\s])(call|cctv|rec|talk)([-_\s]|$)/i);
  if (partMatch) {
    const tok = partMatch[2].toLowerCase();
    part = (tok === 'cctv' || tok === 'rec') ? 'cctv' : 'call';
    rest = rest.replace(partMatch[0], ' ');
  }
  const label = rest.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  // 숫자만으로 된 파일명(00.mp4)은 보여 줄 제목이 없는 것으로 둡니다
  const bare = /^\s*\d+\s*$/.test(stem);
  return { order, part, cam, label: bare ? '' : (label || stem), no: num ? order : null };
}

/* 드롭된 항목에서 영상 파일만 긁어냅니다 (폴더 1단계까지) */
async function filesFromDrop(dt) {
  const out = [];
  const items = dt.items ? [...dt.items] : [];
  const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);

  if (entries.length) {
    const readDir = (dirReader) => new Promise((res) => dirReader.readEntries(res, () => res([])));
    const asFile = (entry) => new Promise((res) => entry.file(res, () => res(null)));
    for (const entry of entries) {
      if (entry.isFile) { const f = await asFile(entry); if (f) out.push(f); }
      else if (entry.isDirectory) {
        for (const child of await readDir(entry.createReader())) {
          if (child.isFile) { const f = await asFile(child); if (f) out.push(f); }
        }
      }
    }
  }
  if (!out.length && dt.files) out.push(...dt.files);
  return out.filter((f) => VIDEO_RE.test(f.name));
}

function loadDroppedFiles(files) {
  if (!files.length) { toast('No video files found'); return false; }

  const cctvFrom = Number(S.cfg.options.cctvFrom);
  const parsed = files.map((file) => ({ file, ...parseName(file.name) }));
  parsed.sort((a, b) =>
    a.order - b.order || a.file.name.localeCompare(b.file.name, 'en', { numeric: true }));

  let cam = 0;
  S.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  S.objectUrls = [];

  S.clips = parsed.map((p) => {
    const url = URL.createObjectURL(p.file);
    S.objectUrls.push(url);
    let part = p.part;
    if (!part) part = (Number.isFinite(cctvFrom) && p.order >= cctvFrom) ? 'cctv' : 'call';
    const auto = !p.label;
    const clip = {
      src: url, part, auto, no: Number.isFinite(p.no) ? p.no : null,
      label: p.label || `Clip ${pad(Number.isFinite(p.no) ? p.no : 0)}`,
      loop: false, fit: '', date: '',
      _blob: p.file, _name: p.file.name,
    };
    clip.cam = part === 'cctv'
      ? (p.cam || `CAM ${String((cam++ % 8) + 1).padStart(2, '0')}`)
      : `CAM ${String((cam % 8) + 1).padStart(2, '0')}`;
    clip.location = part === 'cctv' ? (p.label ? p.label.toUpperCase() : clip.cam) : '';
    return clip;
  });
  S.cfg.clips = S.clips;

  const n = S.clips.filter((c) => c.part === 'cctv').length;
  $('#warn').hidden = true;
  S.idx = -1;
  renderPresenter();
  updateGateNote();
  saveSequence();
  toast(`${S.clips.length} clips loaded — ${S.clips.length - n} call, ${n} CCTV`);
  return true;
}

/* 재생 목록이 바뀌면 화면 안내도 같이 갱신합니다 */
function updateGateNote() {
  const el = $('#gate-ready');
  if (!el) return;
  if (S.stored) {
    el.textContent = `${S.stored} videos saved in this browser — ready to go`;
    el.classList.add('is-ready');
  } else {
    el.textContent = 'or drag your video files here';
    el.classList.remove('is-ready');
  }
}

function wireDropZone() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const droppable = () => state() === 'gate' || state() === 'ended';

  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (!droppable() || !e.dataTransfer?.types?.includes('Files')) return;
    stop(e);
    e.dataTransfer.dropEffect = 'copy';
    body.classList.add('dropping');
  }));
  ['dragleave', 'dragend'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (e.relatedTarget) return;
    body.classList.remove('dropping');
  }));
  document.addEventListener('drop', async (e) => {
    if (!droppable()) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;   // 목록 순서 변경은 제외
    stop(e);
    body.classList.remove('dropping');
    const files = await filesFromDrop(e.dataTransfer);
    if (loadDroppedFiles(files) && state() === 'ended') restart({ silent: true });
  });
}

/* ══════════════ 소리 ══════════════
   브라우저 자동재생 정책은 사용자 제스처 없이 소리 있는 재생을 막습니다.
   게이트 클릭(진짜 제스처) 시점에 비디오 엘리먼트를 한 번 재생시켜 잠금을
   풀어두면, 이후 방향키로 넘길 때도 소리가 그대로 나옵니다. ── */

async function primeMedia() {
  // goto(0)은 players[1]을 쓰므로 거기에 첫 클립을 미리 물려둡니다
  const order = [S.clips[1], S.clips[0]];
  await Promise.allSettled(players.map(async (v, i) => {
    v.volume = 1;
    const clip = order[i];
    const src = clip ? resolveSrc(clip) : '';
    if (!src) return;
    v.dataset.src = src; v.src = src;
    v.muted = true;                       // 잠금 해제용 무음 재생
    try { await v.play(); } catch (_) { /* 막혀도 아래에서 되살립니다 */ }
    v.pause();
    try { v.currentTime = 0; } catch (_) { /* 메타데이터 전 */ }
    v.muted = S.muted;                    // 다시 소리 켬
  }));
  S.primed = true;
}

/* 이 클립에 오디오 트랙이 실제로 있는지 (브라우저별 신호, 모르면 null) */
function hasAudioTrack(v) {
  if (typeof v.webkitAudioDecodedByteCount === 'number') {
    return v.webkitAudioDecodedByteCount > 0;
  }
  if (typeof v.mozHasAudio === 'boolean') return v.mozHasAudio;
  if (v.audioTracks) return v.audioTracks.length > 0;
  return null;
}

/* 재생 직후 소리가 실제로 나오는지 점검하고, 아니면 이유를 알려줍니다 */
function auditAudio(v, clip, gen) {
  setTimeout(() => {
    if (gen !== S.gen || !clip.src) return;
    if (v.error || v.readyState < 2) return;   // 파일 문제는 플레이스홀더가 알립니다
    if (v.paused && !v.ended) {
      toast('Click the screen to play with sound');
      return;
    }
    if (S.muted) return;                  // 발표자가 직접 끈 경우
    if (hasAudioTrack(v) === false && !clip.noAudio) {
      clip.noAudio = true;                // 발표자 패널에 표시
      renderPresenter();
      toast(`No audio track in '${clip.label}'`);
    }
  }, 1400);
}

/* ══════════════ 재생 엔진 ══════════════ */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveSrc(clip) {
  if (!clip.src) return '';
  if (/^(blob:|data:|https?:)/.test(clip.src)) return clip.src;   // 드롭한 파일 등
  // 한글·공백이 들어간 파일명 안전 처리 (이미 인코딩된 경로는 그대로)
  return clip.src.split('/').map((seg) =>
    /%[0-9A-Fa-f]{2}/.test(seg) ? seg : encodeURIComponent(seg)
  ).join('/');
}

function setPlaceholder(clip, i, on) {
  const ph = $('#placeholder');
  if (!on) { ph.hidden = true; return; }
  ph.querySelector('.ph-index').textContent = clipNo(clip, i);
  ph.querySelector('.ph-label').textContent = clip.auto ? '' : clip.label;
  ph.querySelector('.ph-note').textContent = clip.src
    ? `Could not load — ${clip.src}`
    : 'Drop your videos into videos/ and run: node tools/build-manifest.mjs';
  ph.hidden = false;
}

function preload(i) {
  const clip = S.clips[i];
  if (!clip?.src) return;
  const spare = players[1 - S.cur];
  const src = resolveSrc(clip);
  if (spare.dataset.src === src) return;
  spare.dataset.src = src;
  spare.src = src;
  spare.load();
}

function once(el, type, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { el.removeEventListener(type, h); resolve(null); }, ms);
    const h = () => { clearTimeout(t); resolve(type); };
    el.addEventListener(type, h, { once: true });
  });
}

/* 클립을 띄웁니다. 로딩이 늦어도 입력을 막지 않습니다. */
async function goto(i, opts = {}) {
  if (i < 0) return;
  if (i >= S.clips.length) { toast('Last clip'); return; }

  const gen = ++S.gen;
  const clip = S.clips[i];
  const prevPart = S.idx >= 0 ? S.clips[S.idx].part : null;

  // 영상통화 → CCTV 로 넘어가는 순간엔 신호 획득 글리치
  if (clip.part === 'cctv' && prevPart === 'call' && !opts.silent) {
    $('#glitch').hidden = false;
    blip(false);
    await wait(S.cfg.options.glitchMs);
    if (gen !== S.gen) return;          // 그사이 다른 클립으로 넘어갔다면 중단
  }

  const next = players[1 - S.cur];
  const src = resolveSrc(clip);
  let failed = !src;

  if (src) {
    if (next.dataset.src !== src) { next.dataset.src = src; next.src = src; }
    next.loop = clip.loop;
    next.muted = S.muted;
    next.volume = 1;
    try { next.currentTime = 0; } catch (_) { /* 메타데이터 전 */ }
    if (next.readyState < 2) {
      // 미리 받아둔 클립이면 즉시, 아니면 잠깐만 기다렸다 전환합니다
      const r = await Promise.race([
        once(next, 'loadeddata', 700),
        once(next, 'error', 700),
      ]);
      if (gen !== S.gen) return;
      if (r === 'error') failed = true;
    }
    next.play().catch(() => { /* 사용자 제스처 전이면 조용히 무시 */ });
    auditAudio(next, clip, gen);
  }

  // 비디오 교체
  players[S.cur].classList.remove('is-active');
  next.classList.add('is-active');
  if (!players[S.cur].paused) players[S.cur].pause();
  S.cur = 1 - S.cur;
  S.idx = i;
  S.clipStartAt = Date.now();

  // 스킨 전환
  setState(clip.part === 'cctv' ? 'cctv' : 'live');
  if (clip.part === 'cctv') {            // CCTV 화면 위에 FaceTime 컨트롤이 남지 않게
    clearTimeout(uiTimer);
    body.classList.remove('ui-visible');
    body.classList.add('hide-cursor');
  }
  bodyPart(clip);
  $('#glitch').hidden = true;
  setPlaceholder(clip, i, failed);
  renderPresenter();
  preload(i + 1);

  // 전환 후에도 재생이 안 되면 플레이스홀더로 알려줍니다
  if (!failed && src) {
    setTimeout(() => {
      if (gen !== S.gen) return;
      const v = players[S.cur];
      if (v.error || v.readyState < 2) setPlaceholder(clip, i, true);
    }, 1500);
  }
}

function bodyPart(clip) {
  body.dataset.part = clip.part;
  document.documentElement.style.setProperty('--fit', clip.fit || S.cfg.options.fit);
  if (clip.part === 'cctv') {
    $('#cctv-cam').textContent = clip.cam;
    $('#cctv-loc').textContent = clip.location || (clip.auto ? clip.cam : clip.label);
    $('#cctv-meta').textContent = `1080P · 30FPS · CH ${(clip.cam.match(/\d+/) || ['01'])[0]}/08`;
  }
}

function next() { goto(S.idx + 1); }
function prev() { goto(S.idx - 1); }
function replay() {
  const v = players[S.cur];
  if (v.currentSrc) { v.currentTime = 0; v.play().catch(() => {}); toast('Replaying clip'); }
}

/* ══════════════ 통화 흐름 ══════════════ */
async function startCalling() {
  $('#gate-btn').disabled = true;
  $('#gate-note').textContent = 'Checking camera permission…';
  audio();                                     // 사용자 제스처로 오디오 잠금 해제
  const cam = await initCamera();
  await primeMedia();                     // 제스처가 살아 있는 동안 소리 잠금 해제
  $('#gate').classList.remove('is-on');
  setState('calling');
  $('#status-text').textContent = 'Connecting';
  if (!cam.ok) toast(cam.reason);
  if (S.cfg.options.startFullscreen) enterFull();
  startRing();
}

async function connect() {
  if (state() !== 'calling') return;
  stopRing();
  blip(true);
  S.callStart = Date.now();
  await goto(0, { silent: true });
}

function endCall() {
  stopRing();
  players.forEach((v) => { try { v.pause(); } catch (_) { /* noop */ } });
  blip(false);
  $('#ended-name').textContent = S.cfg.caller.name;
  $('#ended-dur').textContent = S.callStart ? fmt(Date.now() - S.callStart) : '00:00';
  setState('ended');
  body.classList.remove('hide-cursor');
}

/* 어느 상태에서든 맨 처음(발신 화면)으로 되돌립니다. */
function restart(opts = {}) {
  S.idx = -1; S.callStart = 0; S.gen++;
  players.forEach((v) => {
    v.classList.remove('is-active');
    v.pause();
    v.removeAttribute('src'); delete v.dataset.src; v.load();
  });
  players[0].classList.add('is-active');
  S.cur = 0;
  body.dataset.part = 'call';
  document.documentElement.style.setProperty('--fit', S.cfg.options.fit);
  $('#glitch').hidden = true;
  $('#pill-timer').textContent = '00:00';
  setPlaceholder({}, 0, false);
  clearTimeout(uiTimer);
  body.classList.remove('ui-visible', 'hide-cursor');
  $('#presenter').hidden = true;
  renderPresenter();
  setState('calling');
  $('#status-text').textContent = 'Connecting';
  startRing();
  if (!opts.silent) toast('Restarted');
}

/* ══════════════ 시계 ══════════════ */
const pad = (n) => String(n).padStart(2, '0');
/* 목록과 플레이스홀더에 보여 줄 번호 — 파일명의 숫자를 그대로 씁니다 */
const clipNo = (c, i) => pad(Number.isFinite(c?.no) ? c.no : i);
function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? `${h}:${pad(m)}` : pad(m)) + ':' + pad(s % 60);
}

function tick() {
  if (S.callStart && state() !== 'ended') {
    $('#pill-timer').textContent = fmt(Date.now() - S.callStart);
  }
  const clip = S.clips[S.idx];
  const override = clip?.date ? Date.parse(clip.date) : NaN;
  const d = Number.isNaN(override)
    ? new Date(S.cctvBase + (Date.now() - S.bootAt))
    : new Date(override + (Date.now() - S.clipStartAt));
  $('#cctv-date').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $('#cctv-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ══════════════ UI 자동 숨김 (CCTV 파트) ══════════════ */
let uiTimer = null;
function bumpUI() {
  body.classList.add('ui-visible');
  body.classList.remove('hide-cursor');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    body.classList.remove('ui-visible');
    if (state() === 'cctv' || state() === 'live') body.classList.add('hide-cursor');
  }, 2600);
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
}

/* ══════════════ 발표자 패널 ══════════════ */
function renderPresenter() {
  const list = $('#presenter-list');
  list.innerHTML = '';
  S.clips.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = (i === S.idx ? 'is-cur ' : '') + (c.src ? '' : 'is-missing');
    li.innerHTML = `<span class="p-num">${clipNo(c, i)}</span>`
      + '<span class="p-label"></span>'
      + (c.noAudio ? '<span class="p-mute" title="No audio track">NO AUDIO</span>' : '')
      + `<button class="p-part ${c.part}" type="button" title="Switch part">${c.part.toUpperCase()}</button>`
      + '<span class="p-move">'
      +   `<button type="button" title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>`
      +   `<button type="button" title="Move down"${i === S.clips.length - 1 ? ' disabled' : ''}>↓</button>`
      + '</span>';
    const lab = li.querySelector('.p-label');
    lab.textContent = c.auto ? '—' : c.label;
    lab.classList.toggle('is-auto', !!c.auto);
    li.addEventListener('click', () => { if (state() !== 'gate') goto(i); });
    li.querySelector('.p-part').addEventListener('click', (e) => {
      e.stopPropagation(); setPart(i, c.part === 'cctv' ? 'call' : 'cctv');
    });
    const [up, down] = li.querySelectorAll('.p-move button');
    up.addEventListener('click', (e) => { e.stopPropagation(); move(i, -1); });
    down.addEventListener('click', (e) => { e.stopPropagation(); move(i, 1); });
    list.appendChild(li);
  });
  $('#presenter-clear').hidden = !S.stored;
  list.querySelector('.is-cur')?.scrollIntoView({ block: 'nearest' });
}

/* 현재 보고 있는 클립을 놓치지 않도록 인덱스를 따라 옮깁니다 */
function reindex(from, to) {
  if (S.idx === from) S.idx = to;
  else if (from < S.idx && to >= S.idx) S.idx -= 1;
  else if (from > S.idx && to <= S.idx) S.idx += 1;
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= S.clips.length) return;
  const [c] = S.clips.splice(i, 1);
  S.clips.splice(j, 0, c);
  reindex(i, j);
  S.cfg.clips = S.clips;
  renderPresenter();
  saveSequence();
}

function setPart(i, part) {
  const c = S.clips[i];
  c.part = part;
  if (part === 'cctv' && !c.location) c.location = c.auto ? c.cam : c.label.toUpperCase();
  if (i === S.idx) { setState(part === 'cctv' ? 'cctv' : 'live'); bodyPart(c); }
  renderPresenter();
  saveSequence();
}

function togglePresenter() {
  const p = $('#presenter');
  p.hidden = !p.hidden;
  if (!p.hidden) renderPresenter();
}

/* ══════════════ 전체화면 ══════════════ */
function enterFull() { document.documentElement.requestFullscreen?.().catch(() => {}); }
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.()
    .catch(() => toast('Fullscreen unavailable'));
}
document.addEventListener('fullscreenchange', () => {
  body.classList.toggle('is-full', !!document.fullscreenElement);
});

/* ══════════════ 키보드 ══════════════ */
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const st = state();

  if (st === 'gate') {
    if (NEXT_KEYS.includes(k)) { e.preventDefault(); startCalling(); }
    return;
  }
  if (st === 'calling') {
    if (NEXT_KEYS.includes(k)) { e.preventDefault(); connect(); }
    else if (k === 'Escape') { e.preventDefault(); endCall(); }
    else if (k === 'c' || k === 'C') { e.preventDefault(); toggleCam(); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); restart(); }
    return;
  }
  if (st === 'ended') {
    if (NEXT_KEYS.includes(k) || k === 'r' || k === 'R') { e.preventDefault(); restart({ silent: true }); }
    else if (k === 'h' || k === 'H' || k === '?') { e.preventDefault(); togglePresenter(); }
    return;
  }

  // live / cctv
  if (NEXT_KEYS.includes(k)) { e.preventDefault(); next(); if (st === 'live') bumpUI(); return; }
  if (PREV_KEYS.includes(k)) { e.preventDefault(); prev(); if (st === 'live') bumpUI(); return; }
  switch (k) {
    case 'Escape': if (!document.fullscreenElement) { e.preventDefault(); endCall(); } break;
    case 'f': case 'F': e.preventDefault(); toggleFull(); break;
    case 'm': case 'M': e.preventDefault(); toggleMute(); break;
    case 'c': case 'C': e.preventDefault(); toggleCam(); break;
    case 'r': case 'R': e.preventDefault(); restart(); break;
    case '.': case ',': e.preventDefault(); replay(); break;
    case 'h': case 'H': case '?': e.preventDefault(); togglePresenter(); break;
    case 'Home': e.preventDefault(); goto(0); break;
    case 'End': e.preventDefault(); goto(S.clips.length - 1); break;
    default:
      if (/^[0-9]$/.test(k)) {                       // 보이는 번호로 이동
        e.preventDefault();
        const n = Number(k);
        const hit = S.clips.findIndex((c) => c.no === n);
        goto(hit >= 0 ? hit : n);
      }
  }
});

/* ══════════════ 포인터 ══════════════ */
$('#gate').addEventListener('click', () => { if (!$('#gate-btn').disabled) startCalling(); });

$('#window').addEventListener('click', (e) => {
  if (e.target.closest('.controls') || e.target.closest('.ended')) return;
  const st = state();
  if (st === 'calling') connect();
  else if (st === 'live' || st === 'cctv') next();
});
$('#window').addEventListener('mousemove', bumpUI);
$('#window').addEventListener('contextmenu', (e) => e.preventDefault());

const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
$('#btn-cam').addEventListener('click', stop(toggleCam));
$('#btn-mute').addEventListener('click', stop(toggleMute));
$('#btn-more').addEventListener('click', stop(togglePresenter));
$('#btn-end').addEventListener('click', stop(endCall));
$('#btn-shutter').addEventListener('click', stop(toggleFull));
$('#restart-btn').addEventListener('click', stop(() => restart({ silent: true })));
$('#presenter-restart').addEventListener('click', () => restart());
$('#presenter-close').addEventListener('click', togglePresenter);
$('#presenter-clear').addEventListener('click', clearSequence);

/* 클립이 끝나면 마지막 프레임에서 멈추고 방향키를 기다립니다 */
players.forEach((v) => {
  v.addEventListener('ended', () => { if (!v.loop) v.pause(); });
  v.addEventListener('error', () => {
    if (v.classList.contains('is-active') && S.idx >= 0) setPlaceholder(S.clips[S.idx], S.idx, true);
  });
});

/* ══════════════ 부트 ══════════════ */
(async function boot() {
  S.cfg = await loadConfig();
  S.clips = S.cfg.clips;
  S.bootAt = Date.now();
  const parsed = Date.parse(S.cfg.options.cctvClock);
  S.cctvBase = Number.isNaN(parsed) ? Date.now() : parsed;

  const c = S.cfg.caller;
  const initials = c.initials || c.name.replace(/\s/g, '').slice(0, 2);
  $('#gate-name').textContent = c.name;
  $('#pill-name').textContent = c.name;
  $('#ended-name').textContent = c.name;
  $('#pill-avatar').textContent = initials;
  if (c.avatar) {
    const img = new Image();
    img.alt = '';
    img.onload = () => { $('#pill-avatar').textContent = ''; $('#pill-avatar').appendChild(img); };
    img.src = c.avatar;
  }

  if (S.cfg.options.backdrop) {
    $('#desktop').style.backgroundImage = `url("${S.cfg.options.backdrop}")`;
    body.dataset.backdrop = '1';
  }
  if (!S.cfg.options.showSelfInCctv) body.classList.add('no-cctv-self');
  document.documentElement.style.setProperty('--fit', S.cfg.options.fit);

  S.cfg.manifestClips = S.clips.slice();
  await restoreSequence();                 // 전에 넣어둔 영상이 있으면 그대로 이어서
  S.clips = S.cfg.clips;

  renderPresenter();
  updateGateNote();
  wireDropZone();
  setInterval(tick, 250);

  const warns = [];
  if (!window.isSecureContext) {
    warns.push('Not a secure context, so the camera is blocked. Open it from localhost with <code>./serve.sh</code>, or over HTTPS.');
  }
  if (S.cfg.source === 'demo') {
    warns.push('No manifest found — running in <strong>rehearsal mode</strong>. Drop your videos into <code>videos/</code> and run <code>node tools/build-manifest.mjs</code>.');
  } else if (S.cfg.source === 'videos.sample.json') {
    warns.push('Running on the sample manifest (<code>videos.sample.json</code>). Add your real videos and generate <code>videos.json</code>.');
  }
  if (S.stored) warns.length = 0;          // 브라우저에 저장된 영상으로 재생 중
  if (warns.length) { $('#warn').innerHTML = warns.join('<br>'); $('#warn').hidden = false; }

  window.__ft = S;   // 디버그용
})();
