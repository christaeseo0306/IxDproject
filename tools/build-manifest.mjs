#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   videos/ 폴더를 훑어 videos.json 을 만듭니다. (의존성 없음)

   사용법:
     node tools/build-manifest.mjs
     node tools/build-manifest.mjs --cctv-from=5
     node tools/build-manifest.mjs --if-changed   # 구성이 바뀌었을 때만 갱신
     node tools/build-manifest.mjs --name="서지민" --dir=videos

   파일명 규칙 (앞의 숫자가 재생 순서):
     00.mp4                      → 0번, 제목 없이 번호만 (가장 간단)
     00 - 첫인사.mp4             → 0번, 파트는 --cctv-from 기준으로 결정
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

// 기존 매니페스트의 caller / options 는 보존하고, 파트 경계도 기억해 둡니다
let prev = {};
if (existsSync(out)) {
  try { prev = JSON.parse(readFileSync(out, 'utf8')); }
  catch { console.warn(`⚠ 기존 ${out} 을 읽을 수 없어 새로 만듭니다.`); }
}
let sample = {};
if (existsSync('videos.sample.json')) {
  try { sample = JSON.parse(readFileSync('videos.sample.json', 'utf8')); } catch { /* 없어도 됩니다 */ }
}

// 파트 경계: 명령줄 > 기존 videos.json > videos.sample.json 순으로 찾습니다
const storedFrom = Number(prev?.options?.cctvFrom);
const sampleFrom = Number(sample?.options?.cctvFrom);
const cctvFrom = args['cctv-from'] != null
  ? Number(args['cctv-from'])
  : (Number.isFinite(storedFrom) ? storedFrom
    : (Number.isFinite(sampleFrom) ? sampleFrom : null));

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
  // 숫자만으로 된 파일명(00.mp4)은 보여 줄 제목이 없는 것으로 둡니다
  const bare = /^\s*\d+\s*$/.test(stem);
  return { file, order, part, cam, label: bare ? '' : label, stem, bare };
});

parsed.sort((a, b) =>
  a.order - b.order || a.file.localeCompare(b.file, 'ko', { numeric: true })
);

// 같은 번호가 두 번 나오면 멈춥니다 — Finder 로 인코딩하면 원본이 함께 남습니다
const byNo = new Map();
for (const p of parsed) {
  if (!Number.isFinite(p.order)) continue;
  if (!byNo.has(p.order)) byNo.set(p.order, []);
  byNo.get(p.order).push(p.file);
}
const dupes = [...byNo.entries()].filter(([, files]) => files.length > 1);
if (dupes.length) {
  console.error('✗ 같은 번호의 영상이 여러 개 있습니다. 그대로 두면 같은 장면이 두 번 재생됩니다.\n');
  for (const [no, files] of dupes) {
    console.error(`  ${String(no).padStart(2, '0')}번`);
    for (const f of files) console.error(`    ${dir}/${f}`);
  }
  console.error('\n  남길 것 하나만 두고 나머지는 지우거나 다른 폴더로 옮겨주세요.');
  console.error('  (Finder 로 인코딩하면 원본 .mp4 와 변환본 .m4v 가 같이 남습니다)');
  process.exit(1);
}

// 파트 토큰이 전혀 없으면 --cctv-from 으로 가른다
const anyPart = parsed.some((p) => p.part);
if (!anyPart && cctvFrom == null) {
  console.warn('⚠ 파일명에 call/cctv 표기가 없습니다. 전부 영상통화 파트로 둡니다.');
  console.warn('  두 번째 파트를 나누려면: node tools/build-manifest.mjs --cctv-from=5');
  console.warn('  (한 번 지정하면 videos.json 에 기억되어 다음부터는 생략할 수 있습니다)');
} else if (!anyPart && args['cctv-from'] == null) {
  console.log(`· 파트 경계: ${cctvFrom}번부터 CCTV (바꾸려면 --cctv-from=숫자)`);
}

let camCounter = 0;
const clips = parsed.map((p, i) => {
  let part = p.part;
  if (!part) part = (cctvFrom != null && p.order >= cctvFrom) ? 'cctv' : 'call';
  const clip = { src: `${dir}/${p.file}`, part };
  if (Number.isFinite(p.order)) clip.no = p.order;    // 화면에 보일 번호 = 파일명의 숫자
  if (!p.bare) clip.label = p.label || p.stem;        // 숫자뿐이면 제목 없음
  if (part === 'cctv') {
    clip.cam = p.cam || `CAM ${String((camCounter++ % 8) + 1).padStart(2, '0')}`;
    clip.location = p.label ? p.label.toUpperCase() : clip.cam;
  }
  return clip;
});

const manifest = {
  caller: { ...(sample.caller || {}), ...(prev.caller || {}) },
  options: { ...(sample.options || {}), ...(prev.options || {}) },
  clips,
};
if (args.name) manifest.caller.name = String(args.name);
if (cctvFrom != null) manifest.options.cctvFrom = cctvFrom;

// --if-changed : videos/ 의 구성이 그대로면 아무것도 건드리지 않습니다
if (args['if-changed'] && Array.isArray(prev?.clips)) {
  const before = prev.clips.map((c) => c.src).join('\n');
  const after = clips.map((c) => c.src).join('\n');
  if (before === after) {
    if (!args.quiet) console.log(`· ${out} 그대로 — 영상 ${clips.length}개`);
    process.exit(0);
  }
}

writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`✓ ${out} 생성 — 클립 ${clips.length}개`);
const w = String(clips.length).length;
clips.forEach((c, i) => {
  const tag = c.part === 'cctv' ? `CCTV ${c.cam}` : 'CALL';
  const name = c.label || `(제목 없음 · ${String(c.no ?? i).padStart(2, '0')}번)`;
  console.log(`  ${String(i).padStart(w, ' ')}. [${tag.padEnd(12)}] ${name}  ← ${c.src}`);
});
const n = clips.filter((c) => c.part === 'cctv').length;
console.log(`\n  파트1 영상통화 ${clips.length - n}개 · 파트2 CCTV ${n}개`);
console.log(`  발신자: ${manifest.caller.name || '(미설정)'} — videos.json 에서 수정할 수 있습니다.`);
