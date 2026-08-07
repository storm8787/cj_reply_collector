/*
 * 단일 HTML 배포본 빌드.
 * index.html 이 참조하는 CSS/JS 를 모두 HTML 안에 넣어 파일 1개로 만든다.
 * 외부 CDN 이나 네트워크 참조는 남기지 않는다.
 *
 * 실행: node build/build.js
 * 결과: dist/부서회신자료_자동취합기.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_HTML = path.join(OUT_DIR, '부서회신자료_자동취합기.html');

function readAsset(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('파일을 찾을 수 없습니다: ' + rel);
  return fs.readFileSync(p, 'utf8');
}

function safeForScript(js) {
  // 인라인 스크립트 안에서 </script> 가 나오면 태그가 조기 종료되므로 escape
  return js.replace(/<\/script/gi, '<\\/script');
}

function build() {
  let html = fs.readFileSync(SRC_HTML, 'utf8');
  const inlined = [];

  html = html.replace(/[ \t]*<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>\s*/gi, (m, href) => {
    inlined.push(href);
    return '<style>\n' + readAsset(href) + '\n</style>\n';
  });

  html = html.replace(/[ \t]*<script[^>]*src=["']([^"']+)["'][^>]*><\/script>\s*/gi, (m, src) => {
    inlined.push(src);
    return '<script>\n' + safeForScript(readAsset(src)) + '\n</script>\n';
  });

  // 검증: HTML 안에 남아있는 외부 참조가 없어야 한다.
  // (스크립트·스타일 안의 문자열은 코드 내용이므로 검사 대상에서 뺀다)
  const markupOnly = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');

  const leftovers = [];
  const reSrc = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = reSrc.exec(markupOnly))) {
    const v = m[1];
    if (v.startsWith('#') || v.startsWith('data:')) continue;
    leftovers.push(v);
  }
  if (leftovers.length) throw new Error('인라인되지 않은 외부 참조가 있습니다: ' + leftovers.join(', '));

  const cdnHits = (markupOnly.match(/<(script|link)[^>]*(https?:)/gi) || []).filter(Boolean);
  if (cdnHits.length) throw new Error('CDN 참조가 남아 있습니다: ' + cdnHits.join(', '));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  console.log('포함한 파일 ' + inlined.length + '개');
  inlined.forEach((f) => console.log('  - ' + f));
  console.log('생성: ' + path.relative(ROOT, OUT_HTML) + ' (' + kb + ' KB)');
}

build();
