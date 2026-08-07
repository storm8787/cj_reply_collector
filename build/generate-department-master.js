/*
 * 충주시 부서순서 엑셀(data/충주시_부서순서.xlsx)을 실제로 읽어
 * src/department-master.js (기본 부서 마스터)를 생성한다.
 *
 * 실행: node build/generate-department-master.js
 *
 * 파일명이나 예상 구조에 의존하지 않고, 시트를 훑어 헤더 행과
 * 순번/부서명/소속 컬럼 위치를 스스로 찾아낸다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('../node_modules/xlsx');

const ROOT = path.resolve(__dirname, '..');
const SRC_XLSX = path.join(ROOT, 'data', '충주시_부서순서.xlsx');
const OUT_JS = path.join(ROOT, 'src', 'department-master.js');

function norm(v) {
  return String(v == null ? '' : v)
    .normalize('NFKC')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

const ORDER_LABELS = ['순번', '연번', '순서', '번호', 'no', 'no.'];
const NAME_LABELS = ['부서명', '부서', '과명', '실과명', '기관명', '부서명(과)'];
const BUREAU_LABELS = ['소속', '국', '실', '소속(국/실)', '국실', '실국'];

function labelMatches(cell, labels) {
  const c = norm(cell).toLowerCase().replace(/\s+/g, '');
  if (!c) return false;
  return labels.some((l) => c === l || c.startsWith(l) || c.indexOf(l) >= 0);
}

function main() {
  const buf = fs.readFileSync(SRC_XLSX);
  const wb = XLSX.read(buf, { type: 'buffer' });

  const report = [];
  report.push(`파일: ${path.relative(ROOT, SRC_XLSX)}`);
  report.push(`시트: ${wb.SheetNames.join(', ')}`);

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const merges = ws['!merges'] || [];
  report.push(`병합 셀: ${merges.length}개`);
  report.push(`전체 행: ${grid.length}`);

  // 헤더 행 탐색: 부서명 계열 라벨이 있는 첫 행
  let headerRow = -1;
  let nameCol = -1;
  let orderCol = -1;
  let bureauCol = -1;
  for (let r = 0; r < Math.min(grid.length, 20) && headerRow < 0; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (labelMatches(row[c], NAME_LABELS)) {
        headerRow = r;
        nameCol = c;
        break;
      }
    }
    if (headerRow >= 0) {
      const row2 = grid[headerRow] || [];
      for (let c = 0; c < row2.length; c++) {
        if (c !== nameCol && orderCol < 0 && labelMatches(row2[c], ORDER_LABELS)) orderCol = c;
        if (c !== nameCol && bureauCol < 0 && labelMatches(row2[c], BUREAU_LABELS)) bureauCol = c;
      }
    }
  }
  if (headerRow < 0) throw new Error('부서명 컬럼을 찾지 못했습니다.');
  report.push(
    `헤더 행: ${headerRow + 1}행 / 순번 컬럼: ${orderCol >= 0 ? XLSX.utils.encode_col(orderCol) : '없음'}` +
      ` / 부서명 컬럼: ${XLSX.utils.encode_col(nameCol)}` +
      ` / 소속 컬럼: ${bureauCol >= 0 ? XLSX.utils.encode_col(bureauCol) : '없음'}`
  );

  const departments = [];
  const seen = new Set();
  let blankRows = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = norm(row[nameCol]);
    if (!name) {
      blankRows++;
      continue;
    }
    if (seen.has(name)) {
      report.push(`중복 부서명 무시: ${name} (${r + 1}행)`);
      continue;
    }
    seen.add(name);
    const bureau = bureauCol >= 0 ? norm(row[bureauCol]) : '';
    departments.push({
      order: departments.length + 1,
      name,
      bureau,
      aliases: [],
      enabled: true,
    });
  }
  report.push(`빈 행: ${blankRows}`);
  report.push(`부서 수: ${departments.length}`);

  // 부서명이 다른 부서명의 부분문자열인 경우(판별 시 주의 대상) 점검
  const contained = [];
  for (const a of departments) {
    for (const b of departments) {
      if (a !== b && b.name.indexOf(a.name) >= 0) contained.push(`${a.name} ⊂ ${b.name}`);
    }
  }
  report.push(`부분문자열 관계: ${contained.length ? contained.join(', ') : '없음'}`);

  const title = norm((grid[0] || [])[0]) || sheetName;
  const banner =
    '/*\n' +
    ' * 자동 생성 파일 - 직접 수정하지 마세요.\n' +
    ' * 생성: node build/generate-department-master.js\n' +
    ' * 원본: data/충주시_부서순서.xlsx\n' +
    report.map((l) => ' * ' + l).join('\n') +
    '\n */\n';

  const body =
    banner +
    "(function (global) {\n" +
    "  'use strict';\n" +
    '  var CJ = (global.CJ = global.CJ || {});\n' +
    `  CJ.DEPARTMENT_SOURCE = ${JSON.stringify({ title, sheet: sheetName, count: departments.length })};\n` +
    '  CJ.DEFAULT_DEPARTMENTS = [\n' +
    departments
      .map(
        (d) =>
          `    { order: ${d.order}, name: ${JSON.stringify(d.name)}, bureau: ${JSON.stringify(
            d.bureau
          )}, aliases: [], enabled: true }`
      )
      .join(',\n') +
    '\n  ];\n' +
    '})(typeof globalThis !== "undefined" ? globalThis : this);\n';

  fs.writeFileSync(OUT_JS, body, 'utf8');
  console.log(report.join('\n'));
  console.log(`\n생성: ${path.relative(ROOT, OUT_JS)}`);
}

main();
