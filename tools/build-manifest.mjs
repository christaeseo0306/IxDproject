#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   videos/ 폴더를 훑어 videos.json 을 만듭니다. (의존성 없음)

   사용법:
     node tools/build-manifest.mjs
     node tools/build-manifest.mjs --cctv-from=5
     node tools/build-manifest.mjs --name="서지민" --dir=videos

   파일명 규칙 (앞의 숫자가 재생 순서):
     01_call_첫인사.mp4          → 1번, 영상통화 파트
     05_cctv_거실.mp4            → 5번, CCTV 파트
     05_cctv_거실@CAM03.mp4      → CAM 03 으로 표기
     03_자기소개.mp4             → 3번, 파트는 --cctv-from 기준으로 결정

   caller/options 는 기존 videos.json 값을 그대로 보존합니다.
   ══════════════════════════════════════════════════════════════ */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const dir = String(args.dir || 'videos');
const out = String(args.out || 'videos.json');
const cctvFrom = args['cctv-from'] ? Number(args['cctv-from']) : null;

if (!existsSync(dir)) {
  console.error(`✗ '${dir}' 폴더가 없습니다.`);
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()) && !f.startsWith('.'));

if (!files.length) {
  console.error(`✗ '${dir}' 폴더에 영상 파일이 없습니다. (${[...VIDEO_EXT].join(', ')})`);
  process.exit(1);
}

const parsed = files.map((file) => {
  const stem = basename(file, extname(file));
  const numMatch = stem.match(/^\s*(\d+)/);
  const order = numMatch ? Number(numMatch[1]) : Number.POSITIVE_INFINITY;

  let rest = stem.replace(/^\s*\d+\s*[-_.\s]*/, '');

  // @CAM03 / @CAM 03 형태의 카메라 지정
  let cam = '';
  const camMatch = rest.match(/@\s*cam\s*[-_]?\s*(\d+)/i);
  if (camMatch) { cam = `CAM ${String(camMatch[1]).padStart(2, '0')}`; rest = rest.replace(camMatch[0], ''); }

  // 파트 토큰
  let part = '';
  const partMatch = rest.match(/(^|[-_\s])(call|cctv|rec|talk)([-_\s]|$)/i);
  if (partMatch) {
    const tok = partMatch[2].toLowerCase();
    part = (tok === 'cctv' || tok === 'rec') ? 'cctv' : 'call';
    rest = rest.replace(partMatch[0], ' ');
  }

  const label = rest.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { file, order, part, cam, label, stem };
});

parsed.sort((a, b) =>
  a.order - b.order || a.file.localeCompare(b.file, 'ko', { numeric: true })
);

// 파트 토큰이 전혀 없으면 --cctv-from 으로 가른다
const anyPart = parsed.some((p) => p.part);
if (!anyPart && cctvFrom == null) {
  console.warn('⚠ 파일명에 call/cctv 표기가 없습니다. 전부 영상통화 파트로 둡니다.');
  console.warn('  두 번째 파트를 나누려면: node tools/build-manifest.mjs --cctv-from=5');
}

let camCounter = 0;
const clips = parsed.map((p, i) => {
  let part = p.part;
  if (!part) part = (cctvFrom != null && p.order >= cctvFrom) ? 'cctv' : 'call';
  const clip = {
    src: `${dir}/${p.file}`,
    part,
    label: p.label || p.stem,
  };
  if (part === 'cctv') {
    clip.cam = p.cam || `CAM ${String((camCounter++ % 8) + 1).padStart(2, '0')}`;
    clip.location = (p.label || '').toUpperCase() || clip.cam;
  }
  return clip;
});

// 기존 caller/options 보존
let prev = {};
if (existsSync(out)) {
  try { prev = JSON.parse(readFileSync(out, 'utf8')); }
  catch { console.warn(`⚠ 기존 ${out} 을 읽을 수 없어 새로 만듭니다.`); }
}
const sample = existsSync('videos.sample.json')
  ? JSON.parse(readFileSync('videos.sample.json', 'utf8')) : {};

const manifest = {
  caller: { ...(sample.caller || {}), ...(prev.caller || {}) },
  options: { ...(sample.options || {}), ...(prev.options || {}) },
  clips,
};
if (args.name) manifest.caller.name = String(args.name);

writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`✓ ${out} 생성 — 클립 ${clips.length}개`);
const w = String(clips.length).length;
clips.forEach((c, i) => {
  const tag = c.part === 'cctv' ? `CCTV ${c.cam}` : 'CALL';
  console.log(`  ${String(i + 1).padStart(w, ' ')}. [${tag.padEnd(12)}] ${c.label}  ← ${c.src}`);
});
const n = clips.filter((c) => c.part === 'cctv').length;
console.log(`\n  파트1 영상통화 ${clips.length - n}개 · 파트2 CCTV ${n}개`);
console.log(`  발신자: ${manifest.caller.name || '(미설정)'} — videos.json 에서 수정할 수 있습니다.`);
