/*
 * node_modules 에 설치된 라이브러리를 vendor/ 로 복사한다.
 * 최종 배포본은 이 파일들을 HTML 안에 넣어 쓰므로 CDN 을 사용하지 않는다.
 *
 * 실행: node build/vendor.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');

const ASSETS = [
  { from: 'node_modules/xlsx/dist/xlsx.full.min.js', to: 'xlsx.full.min.js' },
  { from: 'node_modules/xlsx/LICENSE', to: 'xlsx.LICENSE.txt' },
  { from: 'node_modules/jszip/dist/jszip.min.js', to: 'jszip.min.js' },
  { from: 'node_modules/jszip/LICENSE.markdown', to: 'jszip.LICENSE.txt' },
  // PDF 읽기(본문 텍스트 추출). 워커 파일도 함께 넣어 메인 스레드에서 동작시킨다.
  { from: 'node_modules/pdfjs-dist/legacy/build/pdf.min.js', to: 'pdf.min.js' },
  { from: 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js', to: 'pdf.worker.min.js' },
  { from: 'node_modules/pdfjs-dist/LICENSE', to: 'pdfjs.LICENSE.txt' },
  // PDF 합치기
  { from: 'node_modules/pdf-lib/dist/pdf-lib.min.js', to: 'pdf-lib.min.js' },
  { from: 'node_modules/pdf-lib/LICENSE.md', to: 'pdf-lib.LICENSE.txt' },
];

if (!fs.existsSync(VENDOR)) fs.mkdirSync(VENDOR, { recursive: true });
ASSETS.forEach((a) => {
  const src = path.join(ROOT, a.from);
  if (!fs.existsSync(src)) throw new Error('먼저 npm install 을 실행하세요. 없는 파일: ' + a.from);
  fs.copyFileSync(src, path.join(VENDOR, a.to));
  console.log('복사: ' + a.to);
});
