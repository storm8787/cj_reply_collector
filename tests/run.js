/*
 * 핵심 기능 자동 테스트.
 * 실행: node tests/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CJ = require('./load');
const F = require('./fixtures');
const { group, test, assert, run } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const options = CJ.store.defaultOptions();

function newStore() {
  return new CJ.store.Store(null); // localStorage 없이 기본 부서목록 사용
}

const store = newStore();
const departments = store.departments;
const index = CJ.detector.buildIndex(departments);

let SAMPLES = null;
let RESULTS = null;

async function analyzeSamples() {
  if (RESULTS) return RESULTS;
  SAMPLES = await F.buildSamples();
  RESULTS = [];
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const r = await CJ.analyzer.analyzeFile({ id: 'f' + i, name: s.name, data: s.data }, { index, options });
    r.uploadIndex = i;
    RESULTS.push(r);
  }
  return RESULTS;
}

function byName(name) {
  return RESULTS.filter((r) => r.fileName === name)[0];
}

/** 결과물 생성 시 원본 바이트를 다시 읽어오는 함수 (브라우저에서는 File 객체를 다시 읽는다) */
function readBytes(file) {
  const s = SAMPLES.filter((x) => x.name === file.fileName)[0];
  if (!s) return Promise.reject(new Error('원본 없음: ' + file.fileName));
  return Promise.resolve(new Uint8Array(s.data));
}

/* ===================== 0. 부서 마스터 ===================== */
group('0. 충주시 부서목록');

test('첨부 엑셀에서 만든 기본 부서목록이 들어있다', () => {
  assert.equal(departments.length, 76, '부서 수 (엑셀 75 + 의회사무국)');
  assert.equal(departments[0].name, '홍보담당관');
  assert.equal(departments[0].order, 1);
  assert.equal(departments[74].name, '목행용탄동');
  assert.equal(departments[74].order, 75);
});

test('의회사무국이 맨 마지막 76번으로 들어있다', () => {
  assert.equal(departments[75].name, '의회사무국');
  assert.equal(departments[75].order, 76);
  assert.equal(departments[75].enabled, true);
});

test('원본 엑셀의 부서 순서와 완전히 일치한다', () => {
  const XLSX = global.XLSX;
  const wb = XLSX.read(fs.readFileSync(path.join(ROOT, 'data', '충주시_부서순서.xlsx')), { type: 'buffer' });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  const fromXlsx = grid.slice(2).map((r) => String(r[2] || '').trim()).filter(Boolean);
  assert.equal(fromXlsx.length, 75, '엑셀의 부서 수');
  assert.deepEqual(departments.slice(0, 75).map((d) => d.name), fromXlsx, '엑셀 부분의 부서 순서');
});

test('팀 단위는 관리하지 않는다', () => {
  const teams = departments.filter((d) => /팀$/.test(d.name));
  assert.equal(teams.length, 0, '팀으로 끝나는 부서');
});

test('부서 추가·수정·삭제·이동이 동작한다', () => {
  const s = newStore();
  assert.ok(s.add('테스트과').ok);
  assert.equal(s.departments.length, 77);
  assert.equal(s.departments[76].name, '테스트과');
  assert.ok(!s.add('테스트과').ok, '중복 부서명은 거부');
  assert.ok(s.rename(76, '테스트담당관').ok);
  assert.equal(s.departments[76].name, '테스트담당관');
  s.move(76, 0);
  assert.equal(s.departments[0].name, '테스트담당관');
  assert.equal(s.departments[0].order, 1);
  assert.equal(s.departments[1].name, '홍보담당관');
  s.remove(0);
  assert.equal(s.departments.length, 76);
  assert.equal(s.departments[0].name, '홍보담당관');
});

test('부서설정 JSON 내보내기·가져오기', () => {
  const s = newStore();
  s.setAliases(5, ['정보과', '전산과']);
  s.departments[6].enabled = false;
  const json = s.toJSON();
  const s2 = newStore();
  const res = s2.fromJSON(json);
  assert.ok(res.ok, '가져오기 성공');
  assert.equal(res.count, 76);
  assert.deepEqual(s2.departments[5].aliases, ['정보과', '전산과']);
  assert.equal(s2.departments[6].enabled, false);
  assert.ok(!s2.fromJSON('이건 JSON 이 아닙니다').ok, '잘못된 파일은 거부');
});

/* ===================== 1. 부서 자동판별 ===================== */
group('1. 부서 자동판별');

test('1) 파일명에 공식 부서명이 있으면 확정', () => {
  const r = CJ.detector.detectFromFileName('정보통신과_회신자료.xlsx', index);
  assert.equal(r.department, '정보통신과');
  assert.equal(r.method, '파일명');
  assert.equal(r.status, 'confirmed');
  ['[정보통신과] 제출자료.xlsx', '2026년 자료제출_정보통신과.xlsx', '정보통신과 회신.hwpx'].forEach((n) => {
    assert.equal(CJ.detector.detectFromFileName(n, index).department, '정보통신과', n);
  });
});

test('2) 파일명에 별칭이 있으면 확정', () => {
  const s = newStore();
  s.setAliases(5, ['정보과']);
  const idx = CJ.detector.buildIndex(s.departments);
  const r = CJ.detector.detectFromFileName('2026년 실적_정보과.xlsx', idx);
  assert.equal(r.department, '정보통신과');
  assert.equal(r.method, '파일명');
});

test('3) 파일명에 부서명이 없으면 판별하지 않는다', () => {
  assert.equal(CJ.detector.detectFromFileName('회신자료_01.xlsx', index), null);
});

test('4) 파일명에 두 부서가 있으면 확정하지 않는다', () => {
  const r = CJ.detector.detectFromFileName('정보통신과_도로과_합동회신.xlsx', index);
  assert.equal(r.department, null);
  assert.equal(r.status, 'select');
  assert.equal(r.candidates.length, 2);
});

test('5) 대표 필드에서 부서를 찾는다', async () => {
  await analyzeSamples();
  const r = byName('회신자료_01.xlsx');
  assert.equal(r.detection.department, '복지정책과');
  assert.equal(r.detection.method, '대표 필드');
  assert.equal(r.detection.status, 'confirmed');
});

test('5-2) 표 머리글 아래 값에서도 부서를 찾는다', () => {
  const doc = {
    sections: [
      {
        kind: 'sheet',
        label: 'Sheet1',
        textGrid: [
          ['부서명', '사업명', '실적'],
          ['정보통신과', '공공데이터', '10'],
        ],
      },
    ],
    paragraphs: [],
  };
  const r = CJ.detector.detectFromFields(doc, index, options);
  assert.equal(r.department, '정보통신과');
});

test('6) 문서 상단에서 찾으면 확인 권장', () => {
  const doc = {
    sections: [
      {
        kind: 'sheet',
        label: 'Sheet1',
        textGrid: [['2026년 도로과 시설 현황'], [], ['관리번호', '시설명'], ['1', 'A']],
      },
    ],
    paragraphs: [],
  };
  const r = CJ.detector.detectDepartment(doc, '회신99.xlsx', index, options);
  assert.equal(r.department, '도로과');
  assert.equal(r.method, '문서 상단');
  assert.equal(r.status, 'review');
});

test('6-2) 문서 상단에 부서가 둘이면 확정하지 않는다', () => {
  const doc = {
    sections: [{ kind: 'sheet', label: 'S', textGrid: [['도로과 · 건축과 합동자료'], ['관리번호'], ['1']] }],
    paragraphs: [],
  };
  const r = CJ.detector.detectDepartment(doc, '회신98.xlsx', index, options);
  assert.equal(r.department, null);
  assert.equal(r.status, 'select');
});

test('6-3) 실제 파일에서도 문서 상단 판별은 확인 권장으로 남는다', async () => {
  await analyzeSamples();
  const r = byName('회신05.xlsx');
  assert.equal(r.detection.department, '자원순환과');
  assert.equal(r.detection.method, '문서 상단');
  assert.equal(r.detection.status, 'review');
  assert.ok(
    r.errors.some((e) => e.type === '부서'),
    '확인이 필요하다는 안내가 붙는다'
  );
});

test('7) 어디에서도 찾지 못하면 미확인', async () => {
  await analyzeSamples();
  const r = byName('부서미상.xlsx');
  assert.equal(CJ.analyzer.finalDepartment(r), null);
  assert.equal(CJ.analyzer.finalMethod(r), '미확인');
  assert.equal(CJ.analyzer.finalStatus(r), 'select');
});

test('8) 사용자가 직접 고른 부서가 최종값이 된다', async () => {
  await analyzeSamples();
  const r = byName('부서미상.xlsx');
  r.userDepartment = '기획예산과';
  assert.equal(CJ.analyzer.finalDepartment(r), '기획예산과');
  assert.equal(CJ.analyzer.finalMethod(r), '사용자 지정');
  assert.equal(CJ.analyzer.finalStatus(r), 'confirmed');
  r.userDepartment = null;
});

test('9) 팀명만 있으면 상위 부서를 추론하지 않는다', async () => {
  await analyzeSamples();
  const r = byName('회신03.xlsx');
  assert.equal(CJ.analyzer.finalDepartment(r), null, '정보기획팀 → 정보통신과로 바꾸지 않는다');
});

/* ===================== 2. 파일 읽기·데이터표 탐지 ===================== */
group('2. 파일 읽기와 데이터표 탐지');

test('10) 정상 XLSX 를 읽는다', async () => {
  await analyzeSamples();
  const r = byName('정보통신과_회신자료.xlsx');
  assert.equal(r.support, 'supported');
  const t = CJ.analyzer.selectedTable(r);
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 3);
});

test('11) 다중 시트에서 실제 데이터표를 고른다', async () => {
  await analyzeSamples();
  const r = byName('세정과_회신.xlsx');
  assert.ok(r.tables.length >= 2, '후보가 2개 이상');
  const t = CJ.analyzer.selectedTable(r);
  assert.equal(t.sectionLabel, '제출자료');
  assert.equal(t.rowCount, 5);
});

test('12) 헤더가 1행이 아니어도 찾는다 (병합 제목 포함)', async () => {
  await analyzeSamples();
  const r = byName('회계과_제출.xlsx');
  const t = CJ.analyzer.selectedTable(r);
  assert.equal(t.headerRow, 3, '4행이 머리글');
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 3);
});

test('13) 위쪽 부서정보 + 아래쪽 데이터표를 구분한다', async () => {
  await analyzeSamples();
  const r = byName('회신자료_01.xlsx');
  const t = CJ.analyzer.selectedTable(r);
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 4);
  assert.equal(t.rows[0][0], '복지-001');
});

test('14) HWPX 문서를 읽는다', async () => {
  await analyzeSamples();
  const r = byName('자료제출.hwpx');
  assert.equal(r.support, 'supported');
  assert.equal(r.detection.department, '도로과');
  assert.equal(r.detection.method, '대표 필드');
});

test('15) 복수 표 HWPX 에서 실제 데이터표를 고른다', async () => {
  await analyzeSamples();
  const r = byName('자료제출.hwpx');
  assert.ok(r.tables.length >= 2, '표 후보 2개 이상');
  const t = CJ.analyzer.selectedTable(r);
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 4);
});

test('15-2) 암호화된 HWPX 는 명확히 구분한다', async () => {
  const data = await F.hwpxFile(['부서명 : 도로과'], [[F.BASE_HEADER]], { encrypted: true });
  const r = await CJ.analyzer.analyzeFile({ id: 'enc', name: '암호문서.hwpx', data }, { index, options });
  assert.equal(r.support, 'encrypted');
  assert.equal(r.supportLabel, '암호화 문서');
  assert.equal(r.include, false);
});

test('15-3) HWP(바이너리) 문서에서 부서와 표를 읽는다', async () => {
  await analyzeSamples();
  const r = byName('건축과_회신.hwp');
  assert.equal(r.support, 'partial', '한글 hwp 는 일부 지원으로 표시');
  assert.equal(CJ.analyzer.finalDepartment(r), '건축과');
  const t = CJ.analyzer.selectedTable(r);
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 3);
});

test('15-4) 손상된 파일과 지원하지 않는 형식을 구분한다', async () => {
  const bad = await CJ.analyzer.analyzeFile(
    { id: 'x1', name: '깨진파일.xlsx', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { index, options }
  );
  assert.equal(bad.support, 'corrupt');
  const word = await CJ.analyzer.analyzeFile(
    { id: 'x2', name: '자료.docx', data: new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]) },
    { index, options }
  );
  assert.equal(word.support, 'unsupported');
  assert.ok(word.errors.length > 0);
  const badPdf = await CJ.analyzer.analyzeFile(
    { id: 'x3', name: '깨진문서.pdf', data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
    { index, options }
  );
  assert.equal(badPdf.support, 'corrupt');
});

test('16) 빈 행은 제외한다', async () => {
  await analyzeSamples();
  const t = CJ.analyzer.selectedTable(byName('산림과_회신.xlsx'));
  assert.equal(t.rowCount, 2, '중간의 빈 행 제외');
});

test('CSV 파일을 읽는다', async () => {
  await analyzeSamples();
  const r = byName('농정과_회신.csv');
  assert.equal(r.support, 'supported');
  const t = CJ.analyzer.selectedTable(r);
  assert.deepEqual(t.headers, F.BASE_HEADER);
  assert.equal(t.rowCount, 2);
});

/* ===================== 3. 공통 서식과 컬럼 매칭 ===================== */
group('3. 공통 서식 판별과 컬럼 매칭');

test('가장 많은 파일이 쓰는 서식을 기준으로 고른다 (첫 파일 아님)', async () => {
  await analyzeSamples();
  const files = RESULTS.slice();
  const base = CJ.aggregate.determineBaseSchema(files);
  assert.deepEqual(base.headers, F.BASE_HEADER);
  assert.ok(base.memberCount >= 8, '기준 서식 파일 수: ' + base.memberCount);
});

test('업로드 순서를 바꿔도 기준 서식은 같다', async () => {
  await analyzeSamples();
  const reversed = RESULTS.slice().reverse();
  const base = CJ.aggregate.determineBaseSchema(reversed);
  assert.deepEqual(base.headers, F.BASE_HEADER);
});

test('17) 컬럼 순서가 달라도 같은 서식으로 본다', async () => {
  await analyzeSamples();
  const t = CJ.analyzer.selectedTable(byName('관광과_회신.xlsx'));
  const m = CJ.schema.matchToBase(t.headers, F.BASE_HEADER);
  assert.equal(m.sameSignature, true);
  assert.equal(m.orderDiffers, true);
  assert.deepEqual(m.mapping, [1, 0, 3, 2]);
  assert.equal(m.missing.length, 0);
});

test('18) 컬럼명의 공백·줄바꿈 차이는 같은 컬럼으로 본다', async () => {
  await analyzeSamples();
  const t = CJ.analyzer.selectedTable(byName('산림과_회신.xlsx'));
  const m = CJ.schema.matchToBase(t.headers, F.BASE_HEADER);
  assert.equal(m.missing.length, 0, '누락 없음');
  assert.deepEqual(m.mapping, [0, 1, 2, 3]);
});

test('19) 컬럼이 누락되면 알려준다', async () => {
  await analyzeSamples();
  const t = CJ.analyzer.selectedTable(byName('하천과_회신.xlsx'));
  const m = CJ.schema.matchToBase(t.headers, F.BASE_HEADER);
  assert.deepEqual(m.missing, ['비고']);
  assert.equal(m.sameSignature, false);
});

test('의미가 비슷하다고 임의로 매핑하지 않는다', async () => {
  await analyzeSamples();
  const t = CJ.analyzer.selectedTable(byName('체육진흥과_서식다름.xlsx'));
  const m = CJ.schema.matchToBase(t.headers, F.BASE_HEADER);
  assert.deepEqual(m.mapping, [null, null, null, null], '주소↔소재지 등 자동 매핑 금지');
  assert.equal(m.missing.length, 4);
});

test('사용자가 지정한 컬럼 매핑이 적용된다', async () => {
  await analyzeSamples();
  const f = byName('체육진흥과_서식다름.xlsx');
  const t = CJ.analyzer.selectedTable(f);
  const m = CJ.schema.matchToBase(t.headers, F.BASE_HEADER);
  const mapped = CJ.schema.applyManualMapping(m, { 0: 0, 1: 1, 2: 2 });
  assert.deepEqual(mapped, [0, 1, 2, null]);
});

/* ===================== 4. 취합 결과 ===================== */
group('4. 취합 결과');

function aggregateAll(files) {
  const list = files || RESULTS;
  const result = CJ.aggregate.aggregate(list, departments, {});
  const status = CJ.aggregate.replyStatus(departments, list, result.countByFile);
  return { result, status };
}

test('20) 동일 부서 복수 파일을 알려준다 (자동 삭제하지 않음)', async () => {
  await analyzeSamples();
  const dups = CJ.aggregate.findDuplicates(RESULTS);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].department, '정보통신과');
  assert.equal(dups[0].files.length, 2);
  const { result } = aggregateAll();
  const rows = result.rows.filter((r) => r[0] === '정보통신과');
  assert.equal(rows.length, 5, '두 파일 모두 취합 (3 + 2)');
});

test('21) 결과는 부서 마스터 순서대로 정렬된다', async () => {
  await analyzeSamples();
  const { result } = aggregateAll();
  const orderMap = {};
  departments.forEach((d) => (orderMap[d.name] = d.order));
  let last = -1;
  result.rows.forEach((row) => {
    const o = orderMap[row[0]] === undefined ? Number.MAX_SAFE_INTEGER : orderMap[row[0]];
    assert.ok(o >= last, '부서 순서 역전: ' + row[0]);
    last = o;
  });
  const names = [];
  result.rows.forEach((r) => {
    if (names[names.length - 1] !== r[0]) names.push(r[0]);
  });
  const expectedOrder = names.slice().sort((a, b) => {
    const oa = orderMap[a] === undefined ? 1e9 : orderMap[a];
    const ob = orderMap[b] === undefined ? 1e9 : orderMap[b];
    return oa - ob;
  });
  assert.deepEqual(names, expectedOrder);
});

test('22) 업로드 순서가 달라도 결과가 같다', async () => {
  await analyzeSamples();
  const a = aggregateAll(RESULTS).result;
  const shuffled = RESULTS.slice().reverse();
  const b = CJ.aggregate.aggregate(shuffled, departments, {});
  assert.deepEqual(b.headers, a.headers);
  assert.deepEqual(b.rows, a.rows);
});

test('23) 각 파일의 머리글이 데이터로 반복되지 않는다', async () => {
  await analyzeSamples();
  const { result } = aggregateAll();
  const headerKeys = F.BASE_HEADER.join('|');
  result.rows.forEach((row) => {
    assert.ok(row.slice(3).join('|') !== headerKeys, '머리글이 데이터로 들어감: ' + row.join(','));
  });
  assert.deepEqual(result.headers.slice(0, 3), ['부서명', '원본파일명', '원본시트/표']);
  assert.deepEqual(result.headers.slice(3), F.BASE_HEADER);
});

test('24) 미회신 부서를 정확히 계산한다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const replied = status.rows.filter((r) => r.replied).map((r) => r.name).sort();
  const expected = [];
  RESULTS.forEach((f) => {
    const d = CJ.analyzer.finalDepartment(f);
    if (f.include && d && expected.indexOf(d) < 0) expected.push(d);
  });
  assert.deepEqual(replied, expected.sort());
  assert.equal(status.repliedCount + status.notRepliedCount, 76, '사용 중인 부서 전체');
  assert.ok(status.rows.filter((r) => r.name === '기획예산과')[0].replied === false, '미회신 부서 확인');
  assert.ok(result.rows.length > 0);
});

test('25) 부서별 파일수와 취합건수가 정확하다', async () => {
  await analyzeSamples();
  const { status } = aggregateAll();
  const info = status.rows.filter((r) => r.name === '정보통신과')[0];
  assert.equal(info.fileCount, 2);
  assert.equal(info.rowCount, 5);
  const road = status.rows.filter((r) => r.name === '도로과')[0];
  assert.equal(road.fileCount, 1);
  assert.equal(road.rowCount, 4);
  const arch = status.rows.filter((r) => r.name === '건축과')[0];
  assert.equal(arch.fileCount, 1);
  assert.equal(arch.rowCount, 3);
});

test('26) 미확인 파일은 맨 아래에 미확인으로 표시된다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const unknownRows = result.rows.filter((r) => r[0] === '미확인');
  assert.ok(unknownRows.length > 0, '미확인 행 존재');
  const firstUnknown = result.rows.findIndex((r) => r[0] === '미확인');
  assert.equal(firstUnknown + unknownRows.length, result.rows.length, '미확인은 마지막에 위치');
  assert.ok(status.unknownFileCount >= 2);
});

test('취합 대상에서 제외한 파일은 결과에 없다', async () => {
  await analyzeSamples();
  const files = RESULTS.map((f) => Object.assign({}, f));
  const target = files.filter((f) => f.fileName === '정보통신과_수정본.xlsx')[0];
  target.include = false;
  const result = CJ.aggregate.aggregate(files, departments, {});
  assert.equal(result.rows.filter((r) => r[1] === '정보통신과_수정본.xlsx').length, 0);
  assert.equal(result.rows.filter((r) => r[0] === '정보통신과').length, 3);
  assert.equal(
    result.excluded.filter((e) => !e.documentOnly).length,
    1,
    '사용자가 제외한 파일 1개 (PDF 는 원본 취합본으로 가므로 별도)'
  );
});

test('컬럼을 맞추지 못한 파일의 자료도 사라지지 않는다', async () => {
  await analyzeSamples();
  const { result } = aggregateAll();
  const rows = result.rows.filter((r) => r[1] === '체육진흥과_서식다름.xlsx');
  assert.equal(rows.length, 1, '행이 없어지지 않고 남아있다');
  assert.equal(rows[0][0], '체육진흥과');
  assert.ok(
    result.warnings.some((w) => w.file.fileName === '체육진흥과_서식다름.xlsx' && w.type === '서식'),
    '서식이 다르다는 경고가 함께 나온다'
  );
});

test('서식이 다른 파일은 경고로 알려준다', async () => {
  await analyzeSamples();
  const { result } = aggregateAll();
  const w = result.warnings.filter((x) => x.type === '서식').map((x) => x.file.fileName);
  assert.includes(w, '체육진흥과_서식다름.xlsx');
  assert.includes(w, '하천과_회신.xlsx');
});

/* ===================== 5. 결과 엑셀 ===================== */
group('5. 결과 엑셀');

test('27) 결과 XLSX 를 만들고 다시 읽을 수 있다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const wb = CJ.writer.buildWorkbook({ result, status, files: RESULTS });
  assert.deepEqual(wb.SheetNames, ['통합자료', '회신현황', '파일별처리결과', '오류및경고']);
  const XLSX = global.XLSX;
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const back = XLSX.read(buf, { type: 'buffer' });
  const merged = XLSX.utils.sheet_to_json(back.Sheets['통합자료'], { header: 1, defval: '', raw: false });
  assert.deepEqual(merged[0], result.headers);
  assert.equal(merged.length - 1, result.rows.length);
  const st = XLSX.utils.sheet_to_json(back.Sheets['회신현황'], { header: 1, defval: '', raw: false });
  assert.deepEqual(st[0], ['순서', '부서명', '사용여부', '회신여부', '파일수', '취합건수']);
  assert.ok(st.length >= 77, '미회신 부서 포함');
  const fr = XLSX.utils.sheet_to_json(back.Sheets['파일별처리결과'], { header: 1, defval: '', raw: false });
  assert.deepEqual(fr[0], ['파일명', '판별부서', '판별방법', '사용여부', '선택 데이터표', '취합건수', '상태']);
  assert.equal(fr.length - 1, RESULTS.length);
  const er = XLSX.utils.sheet_to_json(back.Sheets['오류및경고'], { header: 1, defval: '', raw: false });
  assert.deepEqual(er[0], ['파일명', '구분', '내용']);
  assert.ok(er.length > 1, '오류·경고 내역 존재');
});

test('28) 한글 파일명과 한글 데이터가 그대로 유지된다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const name = CJ.writer.defaultFileName(new Date(2026, 7, 7));
  assert.equal(name, '부서회신자료_통합결과_20260807.xlsx');
  const XLSX = global.XLSX;
  const wb = CJ.writer.buildWorkbook({ result, status, files: RESULTS });
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' });
  const merged = XLSX.utils.sheet_to_json(back.Sheets['통합자료'], { header: 1, defval: '', raw: false });
  const road = merged.filter((r) => r[0] === '도로과')[0];
  assert.equal(road[1], '자료제출.hwpx');
  assert.ok(String(road[3]).indexOf('도로-') === 0, '한글 관리번호 유지: ' + road[3]);
  assert.equal(road[4], '도로 시설 1');
});

/* ===================== 6. 오프라인·배포본 ===================== */
group('6. 오프라인 실행과 단일 HTML');

test('29) 배포본 HTML 에 외부 참조가 없다', () => {
  const p = path.join(ROOT, 'dist', '부서회신자료_자동취합기.html');
  assert.ok(fs.existsSync(p), '먼저 node build/build.js 를 실행하세요.');
  const html = fs.readFileSync(p, 'utf8');
  // 스크립트·스타일 안의 문자열은 코드 내용이므로 검사에서 제외한다
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const refs = [];
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(markup))) {
    if (!m[1].startsWith('#') && !m[1].startsWith('data:')) refs.push(m[1]);
  }
  assert.deepEqual(refs, [], '외부 참조: ' + refs.join(', '));
  assert.ok(html.indexOf('Content-Security-Policy') > 0, 'CSP 적용');
  assert.ok(html.indexOf("connect-src 'none'") > 0, '네트워크 연결 차단');
});

test('소스 코드에 네트워크 호출이 없다', () => {
  const dir = path.join(ROOT, 'src');
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => {
      const code = fs.readFileSync(path.join(dir, f), 'utf8');
      ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'importScripts'].forEach((bad) => {
        assert.ok(code.indexOf(bad) < 0, f + ' 안에 ' + bad + ' 사용');
      });
    });
});

test('업로드 자료를 브라우저 저장소에 저장하지 않는다', () => {
  const dir = path.join(ROOT, 'src');
  const users = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /localStorage/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(users, ['department-store.js'], '저장소 접근은 부서설정 모듈에만 있어야 한다');
});

/* ===================== 7. PDF 회신자료 ===================== */
group('7. PDF 회신자료');

test('30) PDF 본문에서 부서를 찾는다', async () => {
  await analyzeSamples();
  const r = byName('회신자료_08.pdf');
  assert.equal(r.support, 'supported');
  assert.equal(r.detection.department, '상수도사업소');
  assert.equal(r.detection.method, '대표 필드');
  assert.equal(r.pageCount, 2, '쪽수');
});

test('31) PDF 는 표를 추측하지 않고 원본 문서를 취합한다', async () => {
  await analyzeSamples();
  const r = byName('회신자료_08.pdf');
  assert.equal(r.documentOnly, true);
  assert.equal(r.tables.length, 0, '표를 만들어내지 않는다');
  assert.ok(
    !r.errors.some((e) => e.type === '자료'),
    'PDF 에는 표를 못 찾았다는 오류를 붙이지 않는다'
  );
});

test('32) 파일명으로 판별한 PDF 도 회신으로 집계된다', async () => {
  await analyzeSamples();
  const r = byName('민원봉사과_회신.pdf');
  assert.equal(CJ.analyzer.finalDepartment(r), '민원봉사과');
  const { status } = aggregateAll();
  const row = status.rows.filter((x) => x.name === '민원봉사과')[0];
  assert.equal(row.replied, true);
  assert.equal(row.fileCount, 1);
});

test('33) PDF 취합본을 만들고 쪽 순서가 부서순서를 따른다', async () => {
  await analyzeSamples();
  const entries = CJ.output.plan(RESULTS, departments).pdf;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.department), ['민원봉사과', '상수도사업소'], '21번 < 47번');
  const res = await CJ.output.buildMergedPdf(entries, readBytes);
  assert.equal(res.pageMap.length, 2);
  assert.equal(res.pageMap[0].from, 1);
  assert.equal(res.pageMap[0].count, 1);
  assert.equal(res.pageMap[1].from, 2);
  assert.equal(res.pageMap[1].count, 2);
  const back = await global.PDFLib.PDFDocument.load(res.bytes);
  assert.equal(back.getPageCount(), 3, '전체 쪽수');
});

/* ===================== 8. 한글 취합본 ===================== */
group('8. 한글 취합본과 원본 묶음');

test('34) HWPX 취합본을 만들고 다시 읽을 수 있다', async () => {
  await analyzeSamples();
  const entries = CJ.output.plan(RESULTS, departments).hwp;
  assert.equal(entries.length, 2, '한글 회신자료 수');
  assert.deepEqual(entries.map((e) => e.department), ['도로과', '건축과'], '15번 < 16번');
  const blob = await CJ.hwpxWriter.build(
    entries.map((e) => ({
      department: e.department,
      fileName: e.file.fileName,
      paragraphs: (e.file.doc.paragraphs || []).slice(),
      tables: (e.file.doc.sections || []).map((sec) => sec.textGrid),
    })),
    { title: '테스트 통합본' }
  );
  const bytes = Buffer.from(await blob.arrayBuffer());
  // 만들어진 HWPX 를 이 프로그램의 HWPX 읽기로 되읽어 본다
  const doc = await CJ.hwpx.read(new Uint8Array(bytes), '취합본.hwpx');
  assert.equal(doc.support, 'supported');
  const text = doc.paragraphs.join(' ');
  assert.ok(text.indexOf('도로과') >= 0, '도로과 구간 존재');
  assert.ok(text.indexOf('건축과') >= 0, '건축과 구간 존재');
  const gridText = doc.sections.map((s) => s.textGrid.map((r) => r.join('|')).join(' ')).join(' ');
  assert.ok(gridText.indexOf('관리번호') >= 0, '표 머리글이 옮겨졌다');
  assert.ok(gridText.indexOf('도로-001') >= 0, '표 내용이 옮겨졌다');
});

test('35) HWPX 취합본의 필수 구성요소가 모두 들어있다', async () => {
  await analyzeSamples();
  const blob = await CJ.hwpxWriter.build(
    [{ department: '도로과', fileName: 'a.hwpx', paragraphs: ['내용'], tables: [[['가', '나']]] }],
    {}
  );
  const zip = await global.JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const names = Object.keys(zip.files);
  ['mimetype', 'version.xml', 'META-INF/container.xml', 'META-INF/manifest.xml',
   'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml'].forEach((n) => {
    assert.ok(names.indexOf(n) >= 0, n + ' 누락');
  });
  assert.equal(await zip.file('mimetype').async('string'), 'application/hwp+zip');
  // 모든 XML 이 형식에 맞는지 확인
  for (const n of names.filter((x) => /\.(xml|hpf)$/.test(x))) {
    const xml = await zip.file(n).async('string');
    assert.ok(CJ.xml.parse(xml) !== null, n + ' 형식 오류');
  }
});

test('36) 원본 한글파일 묶음(ZIP)에 원본이 그대로 들어간다', async () => {
  await analyzeSamples();
  const entries = CJ.output.plan(RESULTS, departments).hwp;
  const buf = await CJ.output.buildOriginalZip(entries, readBytes, 'nodebuffer');
  const zip = await global.JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 3, '원본 2개 + 취합순서 안내');
  assert.equal(names[0], '00_취합순서.txt');
  assert.equal(names[1], '01_도로과_자료제출.hwpx');
  assert.equal(names[2], '02_건축과_건축과_회신.hwp');
  const original = SAMPLES.filter((s) => s.name === '자료제출.hwpx')[0];
  const stored = await zip.file('01_도로과_자료제출.hwpx').async('uint8array');
  assert.equal(stored.length, original.data.length, '원본 크기 그대로');
  assert.deepEqual(Array.from(stored.slice(0, 32)), Array.from(original.data.slice(0, 32)), '원본 내용 그대로');
});

/* ===================== 9. 결과물 구성 ===================== */
group('9. 결과물 구성');

test('37) 자료 종류에 맞는 결과물이 만들어진다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const built = await CJ.output.buildAll({
    result,
    status,
    files: RESULTS,
    departments,
    readBytes,
    zipType: 'nodebuffer',
    blobFactory: (data) => ({ data, size: data.length || data.byteLength || 0 }),
    workbookToData: (wb) => global.XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }),
  });
  const kinds = built.outputs.map((o) => o.kind);
  assert.deepEqual(kinds, ['xlsx', 'pdf', 'hwpx', 'zip'], '결과물 구성');
  assert.equal(built.outputs[0].name.indexOf('부서회신자료_통합결과_'), 0);
  assert.ok(/부서회신자료_PDF취합본_\d{8}\.pdf/.test(built.outputs[1].name));
  assert.ok(/부서회신자료_한글취합본_\d{8}\.hwpx/.test(built.outputs[2].name));
  assert.ok(/부서회신자료_한글원본_\d{8}\.zip/.test(built.outputs[3].name));
});

test('38) 엑셀만 올리면 엑셀 결과 하나만 만들어진다', async () => {
  await analyzeSamples();
  const excelOnly = RESULTS.filter((f) => CJ.output.groupOf(f) === 'excel');
  const result = CJ.aggregate.aggregate(excelOnly, departments, {});
  const status = CJ.aggregate.replyStatus(departments, excelOnly, result.countByFile);
  const built = await CJ.output.buildAll({
    result,
    status,
    files: excelOnly,
    departments,
    readBytes,
    zipType: 'nodebuffer',
    blobFactory: (data) => ({ data, size: data.length || 0 }),
    workbookToData: (wb) => global.XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }),
  });
  assert.deepEqual(built.outputs.map((o) => o.kind), ['xlsx'], '엑셀 결과만');
  assert.deepEqual(built.outputs[0].workbook.SheetNames, [
    '통합자료', '회신현황', '파일별처리결과', '오류및경고',
  ], '엑셀만 있을 때는 기존과 동일한 4개 시트');
});

test('39) 한글·PDF 취합본이 있으면 취합순서 시트가 붙는다', async () => {
  await analyzeSamples();
  const { result, status } = aggregateAll();
  const built = await CJ.output.buildAll({
    result, status, files: RESULTS, departments, readBytes,
    zipType: 'nodebuffer',
    blobFactory: (data) => ({ data, size: data.length || 0 }),
    workbookToData: (wb) => global.XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }),
  });
  const wb = built.outputs[0].workbook;
  assert.includes(wb.SheetNames, '취합순서');
  const rows = global.XLSX.utils.sheet_to_json(wb.Sheets['취합순서'], { header: 1, defval: '', raw: false });
  assert.deepEqual(rows[0], ['취합본', '순서', '부서명', '원본파일명', '위치']);
  const pdfRows = rows.filter((r) => r[0] === 'PDF취합본');
  assert.equal(pdfRows.length, 2);
  assert.equal(pdfRows[0][2], '민원봉사과');
  assert.equal(pdfRows[0][4], '1~1쪽 (1쪽)');
  assert.equal(pdfRows[1][4], '2~3쪽 (2쪽)');
  const hwpRows = rows.filter((r) => r[0] === '한글취합본');
  assert.equal(hwpRows.length, 2);
  assert.equal(hwpRows[0][2], '도로과');
});

test('40) PDF 는 통합자료 표에 섞이지 않는다', async () => {
  await analyzeSamples();
  const { result } = aggregateAll();
  assert.equal(result.rows.filter((r) => /\.pdf$/.test(r[1])).length, 0, '표 데이터로 들어가지 않는다');
  const excludedPdf = result.excluded.filter((e) => e.documentOnly);
  assert.equal(excludedPdf.length, 2);
  assert.ok(excludedPdf.every((e) => /원본 문서를 그대로/.test(e.reason)));
});

run();
