/*
 * 테스트용 회신자료 샘플 생성.
 * 실제 행정자료와 비슷한 형태로 만들되 개인정보는 넣지 않는다.
 */
'use strict';
const XLSX = require('../node_modules/xlsx');
const JSZip = require('../node_modules/jszip');
const zlib = require('zlib');

function xlsxFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    if (s.merges) ws['!merges'] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(out);
}

function csvFile(text) {
  return Buffer.from(text, 'utf8');
}

const BASE_HEADER = ['관리번호', '시설명', '주소', '비고'];

function dataRows(prefix, n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push([prefix + '-' + String(i).padStart(3, '0'), prefix + ' 시설 ' + i, '충주시 ' + prefix + '로 ' + i, '']);
  }
  return rows;
}

/* ------------------------------ HWPX ------------------------------ */
const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const HS = 'http://www.hancom.co.kr/hwpml/2011/section';

function tc(text, col, row, colSpan, rowSpan) {
  return (
    '<hp:tc><hp:cellAddr colAddr="' + col + '" rowAddr="' + row + '"/>' +
    '<hp:cellSpan colSpan="' + (colSpan || 1) + '" rowSpan="' + (rowSpan || 1) + '"/>' +
    '<hp:subList><hp:p><hp:run><hp:t>' + String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</hp:t></hp:run></hp:p></hp:subList></hp:tc>'
  );
}

function hwpxTable(aoa) {
  const rows = aoa
    .map((row, r) => '<hp:tr>' + row.map((v, c) => tc(v, c, r)).join('') + '</hp:tr>')
    .join('');
  return '<hp:tbl rowCnt="' + aoa.length + '" colCnt="' + (aoa[0] || []).length + '">' + rows + '</hp:tbl>';
}

function hwpxSection(paragraphs, tables) {
  let body = paragraphs
    .map((p) => '<hp:p><hp:run><hp:t>' + String(p).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</hp:t></hp:run></hp:p>')
    .join('');
  body += tables.map((t) => '<hp:p><hp:run>' + hwpxTable(t) + '</hp:run></hp:p>').join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<hs:sec xmlns:hs="' + HS + '" xmlns:hp="' + HP + '">' + body + '</hs:sec>'
  );
}

async function hwpxFile(paragraphs, tables, opts) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('version.xml', '<?xml version="1.0" encoding="UTF-8"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0"/>');
  const encryption = opts && opts.encrypted
    ? '<odf:encryption-data xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" checksum-type="SHA1"/>'
    : '';
  zip.file(
    'META-INF/manifest.xml',
    '<?xml version="1.0" encoding="UTF-8"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
      '<odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>' + encryption + '</odf:manifest>'
  );
  zip.file('Contents/content.hpf', '<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"/>');
  zip.file('Contents/section0.xml', hwpxSection(paragraphs, tables));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  return new Uint8Array(buf);
}

/* ------------------------------- HWP ------------------------------- */
function recHeader(tag, level, size) {
  const v = (tag & 0x3ff) | ((level & 0x3ff) << 10) | ((size & 0xfff) << 20);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function record(tag, level, payload) {
  const data = Buffer.from(payload);
  if (data.length >= 0xfff) {
    const head = recHeader(tag, level, 0xfff);
    const big = Buffer.alloc(4);
    big.writeUInt32LE(data.length, 0);
    return Buffer.concat([head, big, data]);
  }
  return Buffer.concat([recHeader(tag, level, data.length), data]);
}

function utf16(text) {
  const b = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) b.writeUInt16LE(text.charCodeAt(i), i * 2);
  return b;
}

function paraRecords(text, level) {
  return Buffer.concat([record(66, level, Buffer.alloc(22)), record(67, level + 1, utf16(text))]);
}

function hwpTableRecords(aoa, level) {
  const rowCnt = aoa.length;
  const colCnt = (aoa[0] || []).length;
  const ctrlId = Buffer.from([0x20, 0x6c, 0x62, 0x74]); // 'tbl ' (LE)
  const parts = [record(71, level, ctrlId)];
  const tableBody = Buffer.alloc(12);
  tableBody.writeUInt16LE(rowCnt, 4);
  tableBody.writeUInt16LE(colCnt, 6);
  parts.push(record(77, level + 1, tableBody));
  for (let r = 0; r < rowCnt; r++) {
    for (let c = 0; c < colCnt; c++) {
      const lh = Buffer.alloc(26);
      lh.writeUInt32LE(1, 0); // 문단 수
      lh.writeUInt16LE(c, 8); // colAddr
      lh.writeUInt16LE(r, 10); // rowAddr
      lh.writeUInt16LE(1, 12); // colSpan
      lh.writeUInt16LE(1, 14); // rowSpan
      parts.push(record(72, level + 1, lh));
      parts.push(paraRecords(String(aoa[r][c]), level + 2));
    }
  }
  return Buffer.concat(parts);
}

function hwpFile(paragraphs, tables, opts) {
  const options = opts || {};
  const parts = [];
  paragraphs.forEach((p) => parts.push(paraRecords(p, 0)));
  tables.forEach((t) => {
    parts.push(record(66, 0, Buffer.alloc(22)));
    parts.push(record(67, 1, utf16('')));
    parts.push(hwpTableRecords(t, 1));
  });
  let section = Buffer.concat(parts);
  const compressed = options.compressed !== false;
  if (compressed) section = zlib.deflateRawSync(section);

  const header = Buffer.alloc(256);
  header.write('HWP Document File', 0, 'ascii');
  header[31] = 0x1a;
  header.writeUInt32LE(0x05000300, 32);
  let flags = 0;
  if (compressed) flags |= 0x01;
  if (options.encrypted) flags |= 0x02;
  if (options.distributed) flags |= 0x04;
  header.writeUInt32LE(flags, 36);

  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, '/FileHeader', header);
  XLSX.CFB.utils.cfb_add(cfb, '/BodyText/Section0', section);
  XLSX.CFB.utils.cfb_add(cfb, '/DocInfo', Buffer.alloc(16));
  const out = XLSX.CFB.write(cfb, { type: 'array' });
  return Uint8Array.from(out);
}

/* --------------------------- 샘플 파일 세트 --------------------------- */
async function buildSamples() {
  const files = [];
  const add = (name, data) => files.push({ name, data });

  // 1) 파일명에 공식 부서명
  add(
    '정보통신과_회신자료.xlsx',
    xlsxFromSheets([{ name: '회신', aoa: [BASE_HEADER, ...dataRows('정보', 3)] }])
  );

  // 2) 파일명에 부서 없음 + 상단 세로형 부서명 필드
  add(
    '회신자료_01.xlsx',
    xlsxFromSheets([
      {
        name: 'Sheet1',
        aoa: [
          ['2026년 공공시설 현황 제출'],
          ['부서명', '복지정책과'],
          ['작성일', '2026-08-07'],
          [],
          BASE_HEADER,
          ...dataRows('복지', 4),
        ],
      },
    ])
  );

  // 3) HWPX: 본문에 담당부서, 작은 안내표 + 실제 데이터표
  add(
    '자료제출.hwpx',
    await hwpxFile(
      ['2026년 도로시설 현황 제출', '담당부서 : 도로과', '작성일 : 2026-08-07'],
      [
        [['작성자', '담당'], ['연락처', '내선']],
        [BASE_HEADER, ...dataRows('도로', 4)],
      ]
    )
  );

  // 4) 부서 판별 불가
  add('부서미상.xlsx', xlsxFromSheets([{ name: 'Sheet1', aoa: [BASE_HEADER, ...dataRows('기타', 2)] }]));

  // 5) 동일 부서 복수 제출
  add(
    '정보통신과_수정본.xlsx',
    xlsxFromSheets([{ name: '회신', aoa: [BASE_HEADER, ...dataRows('정보수정', 2)] }])
  );

  // 6) 서식이 다른 파일
  add(
    '체육진흥과_서식다름.xlsx',
    xlsxFromSheets([{ name: 'Sheet1', aoa: [['번호', '시설', '소재지'], ['1', '체육관', '충주시 체육로 1']] }])
  );

  // 7) 컬럼 순서 차이
  add(
    '관광과_회신.xlsx',
    xlsxFromSheets([
      {
        name: 'Sheet1',
        aoa: [
          ['시설명', '관리번호', '비고', '주소'],
          ['관광 시설 1', '관광-001', '', '충주시 관광로 1'],
          ['관광 시설 2', '관광-002', '', '충주시 관광로 2'],
        ],
      },
    ])
  );

  // 8) 컬럼명 공백·줄바꿈 차이 + 빈 행 포함
  add(
    '산림과_회신.xlsx',
    xlsxFromSheets([
      {
        name: 'Sheet1',
        aoa: [
          ['관리 번호', '시설명 ', '주\n소', '비고'],
          ['산림-001', '산림 시설 1', '충주시 산림로 1', ''],
          ['', '', '', ''],
          ['산림-002', '산림 시설 2', '충주시 산림로 2', ''],
        ],
      },
    ])
  );

  // 9) 컬럼 누락
  add(
    '하천과_회신.xlsx',
    xlsxFromSheets([
      { name: 'Sheet1', aoa: [['관리번호', '시설명', '주소'], ['하천-001', '하천 시설 1', '충주시 하천로 1']] },
    ])
  );

  // 10) 다중 시트 (안내 시트 + 실제 데이터 시트)
  add(
    '세정과_회신.xlsx',
    xlsxFromSheets([
      {
        name: '작성안내',
        aoa: [
          ['구분', '내용'],
          ['제출기한', '2026-08-20'],
          ['문의', '내선번호로 문의'],
        ],
      },
      { name: '제출자료', aoa: [BASE_HEADER, ...dataRows('세정', 5)] },
    ])
  );

  // 11) 헤더가 1행이 아닌 파일 (상단 안내 + 병합 제목)
  add(
    '회계과_제출.xlsx',
    xlsxFromSheets([
      {
        name: 'Sheet1',
        aoa: [
          ['2026년 공공시설 현황'],
          [],
          ['※ 아래 표에 작성'],
          BASE_HEADER,
          ...dataRows('회계', 3),
        ],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }],
      },
    ])
  );

  // 12) 팀명만 있는 파일 (상위 부서 추론 금지)
  add(
    '회신03.xlsx',
    xlsxFromSheets([
      { name: 'Sheet1', aoa: [['작성팀', '정보기획팀'], [], BASE_HEADER, ...dataRows('팀', 2)] },
    ])
  );

  // 12-2) 문서 상단 제목에서만 부서명이 보이는 파일 (확인 권장)
  add(
    '회신05.xlsx',
    xlsxFromSheets([
      {
        name: 'Sheet1',
        aoa: [['2026년 자원순환과 재활용시설 현황'], [], BASE_HEADER, ...dataRows('순환', 3)],
      },
    ])
  );

  // 13) 파일명에 두 부서가 동시에 존재
  add(
    '정보통신과_도로과_합동회신.xlsx',
    xlsxFromSheets([{ name: 'Sheet1', aoa: [BASE_HEADER, ...dataRows('합동', 2)] }])
  );

  // 14) CSV
  add(
    '농정과_회신.csv',
    csvFile('관리번호,시설명,주소,비고\n농정-001,농정 시설 1,충주시 농정로 1,\n농정-002,농정 시설 2,충주시 농정로 2,\n')
  );

  // 15) HWP (바이너리)
  add(
    '건축과_회신.hwp',
    hwpFile(['2026년 건축물 현황 제출', '부서명 : 건축과'], [[BASE_HEADER, ...dataRows('건축', 3)]])
  );

  return files;
}

module.exports = {
  BASE_HEADER,
  dataRows,
  xlsxFromSheets,
  csvFile,
  hwpxFile,
  hwpxSection,
  hwpFile,
  buildSamples,
};
