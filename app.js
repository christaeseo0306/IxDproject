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
  caller: { name: '가상 인물', avatar: '', initials: '' },
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
  { part: 'call', label: '통화 연결 — 첫 인사' },
  { part: 'call', label: '자기소개' },
  { part: 'call', label: '오늘 하루 이야기' },
  { part: 'call', label: '질문을 건네다' },
  { part: 'cctv', label: '아침', cam: 'CAM 03', location: 'LIVING ROOM' },
  { part: 'cctv', label: '오후', cam: 'CAM 05', location: 'STUDIO' },
  { part: 'cctv', label: '밤', cam: 'CAM 01', location: 'ENTRANCE' },
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

function normalize(json, source) {
  return {
    caller: { ...DEFAULTS.caller, ...(json.caller || {}) },
    options: { ...DEFAULTS.options, ...(json.options || {}) },
    clips: (json.clips || []).map((c, i) => ({
      src: c.src || '',
      part: c.part === 'cctv' ? 'cctv' : 'call',
      label: c.label || `클립 ${String(i + 1).padStart(2, '0')}`,
      cam: c.cam || `CAM ${String((i % 8) + 1).padStart(2, '0')}`,
      location: c.location || '',
      loop: !!c.loop,
      fit: c.fit || '',
      date: c.date || '',
    })),
    source,
  };
}

/* ══════════════ 카메라 ══════════════ */
async function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    body.classList.add('cam-off'); S.camOn = false;
    return { ok: false, reason: '이 브라우저는 카메라 API를 지원하지 않습니다.' };
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
        ? '카메라 권한이 거부되었습니다. 프리뷰 없이 진행합니다.'
        : '카메라를 찾을 수 없습니다. 프리뷰 없이 진행합니다.',
    };
  }
}

function toggleCam() {
  if (!S.stream) return toast('카메라를 사용할 수 없습니다');
  S.camOn = !S.camOn;
  S.stream.getVideoTracks().forEach((t) => { t.enabled = S.camOn; });
  body.classList.toggle('cam-off', !S.camOn);
  $('#btn-cam').classList.toggle('is-off', !S.camOn);
}

function toggleMute() {
  S.muted = !S.muted;
  players.forEach((v) => { v.muted = S.muted; });
  $('#btn-mute').classList.toggle('is-off', S.muted);
  toast(S.muted ? '음소거' : '음소거 해제');
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

/* ══════════════ 재생 엔진 ══════════════ */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveSrc(clip) {
  if (!clip.src) return '';
  // 한글·공백이 들어간 파일명 안전 처리 (이미 인코딩된 경로는 그대로)
  return clip.src.split('/').map((seg) =>
    /%[0-9A-Fa-f]{2}/.test(seg) ? seg : encodeURIComponent(seg)
  ).join('/');
}

function setPlaceholder(clip, i, on) {
  const ph = $('#placeholder');
  if (!on) { ph.hidden = true; return; }
  ph.querySelector('.ph-index').textContent = String(i + 1).padStart(2, '0');
  ph.querySelector('.ph-label').textContent = clip.label;
  ph.querySelector('.ph-note').textContent = clip.src
    ? `영상을 불러올 수 없습니다 — ${clip.src}`
    : 'videos/ 폴더에 영상을 넣고 node tools/build-manifest.mjs 를 실행하세요';
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
  if (i >= S.clips.length) { toast('마지막 클립입니다'); return; }

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
    $('#cctv-loc').textContent = clip.location || clip.label;
    $('#cctv-meta').textContent = `1080P · 30FPS · CH ${(clip.cam.match(/\d+/) || ['01'])[0]}/08`;
  }
}

function next() { goto(S.idx + 1); }
function prev() { goto(S.idx - 1); }
function replay() {
  const v = players[S.cur];
  if (v.currentSrc) { v.currentTime = 0; v.play().catch(() => {}); toast('클립 다시 재생'); }
}

/* ══════════════ 통화 흐름 ══════════════ */
async function startCalling() {
  $('#gate-btn').disabled = true;
  $('#gate-note').textContent = '카메라 권한을 확인하는 중…';
  audio();                                     // 사용자 제스처로 오디오 잠금 해제
  const cam = await initCamera();
  $('#gate').classList.remove('is-on');
  setState('calling');
  $('#status-text').textContent = '연결 중';
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

function restart() {
  S.idx = -1; S.callStart = 0; S.gen++;
  players.forEach((v) => {
    v.classList.remove('is-active');
    v.removeAttribute('src'); delete v.dataset.src; v.load();
  });
  players[0].classList.add('is-active');
  S.cur = 0;
  body.dataset.part = 'call';
  setPlaceholder({}, 0, false);
  renderPresenter();
  setState('calling');
  startRing();
}

/* ══════════════ 시계 ══════════════ */
const pad = (n) => String(n).padStart(2, '0');
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
    li.innerHTML = `<span class="p-num">${pad(i + 1)}</span>`
      + '<span class="p-label"></span>'
      + `<span class="p-part ${c.part}">${c.part.toUpperCase()}</span>`;
    li.querySelector('.p-label').textContent = c.label;
    li.addEventListener('click', () => { if (state() !== 'gate') goto(i); });
    list.appendChild(li);
  });
  list.querySelector('.is-cur')?.scrollIntoView({ block: 'nearest' });
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
    .catch(() => toast('전체화면을 사용할 수 없습니다'));
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
    return;
  }
  if (st === 'ended') {
    if (NEXT_KEYS.includes(k) || k === 'r' || k === 'R') { e.preventDefault(); restart(); }
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
    case 'r': case 'R': e.preventDefault(); replay(); break;
    case 'h': case 'H': case '?': e.preventDefault(); togglePresenter(); break;
    case 'Home': e.preventDefault(); goto(0); break;
    case 'End': e.preventDefault(); goto(S.clips.length - 1); break;
    default:
      if (/^[1-9]$/.test(k)) { e.preventDefault(); goto(Number(k) - 1); }
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
$('#restart-btn').addEventListener('click', stop(restart));
$('#presenter-close').addEventListener('click', togglePresenter);

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

  renderPresenter();
  setInterval(tick, 250);

  const warns = [];
  if (!window.isSecureContext) {
    warns.push('보안 컨텍스트가 아니라 카메라를 쓸 수 없습니다. <code>./serve.sh</code> 로 localhost 에서 열거나 HTTPS 로 접속하세요.');
  }
  if (S.cfg.source === 'demo') {
    warns.push('매니페스트를 찾지 못해 <strong>리허설 모드</strong>로 실행 중입니다. <code>videos/</code> 에 영상을 넣고 <code>node tools/build-manifest.mjs</code> 를 실행하세요.');
  } else if (S.cfg.source === 'videos.sample.json') {
    warns.push('예시 매니페스트(<code>videos.sample.json</code>)로 실행 중입니다. 실제 영상을 넣고 <code>videos.json</code> 을 생성하세요.');
  }
  if (warns.length) { $('#warn').innerHTML = warns.join('<br>'); $('#warn').hidden = false; }

  window.__ft = S;   // 디버그용
})();
