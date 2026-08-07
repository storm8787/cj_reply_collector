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
  zip.file(
    'Contents/content.hpf',
    '<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/">' +
      '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
      '</opf:manifest></opf:package>'
  );
  zip.file('Contents/header.xml', styledHeaderXml());
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



/*
 * 서식이 들어있는 HWPX. 원본 서식이 취합본에 옮겨지는지 확인하는 데 쓴다.
 * 실제 한/글이 저장하는 것과 같은 구조(header.xml 번호표 + 본문의 번호 참조)를 갖춘다.
 */
function styledHeaderXml() {
  const langs = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
  const fontface = (lang) =>
    '<hh:fontface lang="' + lang + '" fontCnt="2">' +
    '<hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/>' +
    '<hh:font id="1" face="맑은 고딕" type="TTF" isEmbedded="0"/>' +
    '</hh:fontface>';
  const fontRef = (n) =>
    '<hh:fontRef ' + langs.map((l) => l.toLowerCase() + '="' + n + '"').join(' ') + '/>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"' +
    ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" version="1.4" secCnt="1">' +
    '<hh:refList>' +
    '<hh:fontfaces itemCnt="7">' + langs.map(fontface).join('') + '</hh:fontfaces>' +
    '<hh:borderFills itemCnt="1"><hh:borderFill id="7" threeD="0" shadow="0"/></hh:borderFills>' +
    '<hh:charProperties itemCnt="2">' +
    '<hh:charPr id="8" height="1000" textColor="#000000" borderFillIDRef="7">' + fontRef(0) + '</hh:charPr>' +
    '<hh:charPr id="9" height="1600" textColor="#FF0000" borderFillIDRef="7">' + fontRef(1) + '</hh:charPr>' +
    '</hh:charProperties>' +
    '<hh:tabProperties itemCnt="1"><hh:tabPr id="5" autoTabLeft="0"/></hh:tabProperties>' +
    '<hh:numberings itemCnt="1"><hh:numbering id="4" start="0"/></hh:numberings>' +
    '<hh:paraProperties itemCnt="1">' +
    '<hh:paraPr id="6" tabPrIDRef="5" condense="0">' +
    '<hh:align horizontal="CENTER" vertical="BASELINE"/>' +
    '<hh:heading type="OUTLINE" idRef="4" level="0"/>' +
    '<hh:border borderFillIDRef="7"/>' +
    '</hh:paraPr></hh:paraProperties>' +
    '<hh:styles itemCnt="1">' +
    '<hh:style id="3" type="PARA" name="본문" engName="Body" paraPrIDRef="6" charPrIDRef="9" nextStyleIDRef="3"/>' +
    '</hh:styles>' +
    '</hh:refList></hh:head>'
  );
}

function styledSectionXml(extraRun) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"' +
    ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"' +
    ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">' +
    '<hp:p id="1" paraPrIDRef="6" styleIDRef="3">' +
    '<hp:run charPrIDRef="9">' +
    '<hp:secPr id="" textDirection="HORIZONTAL" outlineShapeIDRef="4" memoShapeIDRef="0">' +
    '<hp:pagePr landscape="WIDELY" width="59528" height="84188"/>' +
    '</hp:secPr>' +
    '<hp:t>붉은 굵은 제목</hp:t>' +
    '</hp:run></hp:p>' +
    '<hp:p id="2" paraPrIDRef="6" styleIDRef="3">' +
    '<hp:run charPrIDRef="8"><hp:t>담당부서 : 도로과</hp:t></hp:run>' +
    '</hp:p>' +
    (extraRun || '') +
    '</hs:sec>'
  );
}

async function hwpxPackage(headerXml, sectionXml, extraFiles) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('version.xml', '<?xml version="1.0" encoding="UTF-8"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5" minor="1"/>');
  zip.file(
    'META-INF/manifest.xml',
    '<?xml version="1.0" encoding="UTF-8"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
      '<odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/></odf:manifest>'
  );
  zip.file(
    'Contents/content.hpf',
    '<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/">' +
      '<opf:manifest>' +
      '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
      '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
      Object.keys(extraFiles || {})
        .filter((n) => /^BinData\//.test(n))
        .map((n) => '<opf:item id="' + n.split('/').pop().replace(/\.[^.]+$/, '') + '" href="' + n + '" media-type="image/png"/>')
        .join('') +
      '</opf:manifest><opf:spine><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>'
  );
  zip.file('Contents/header.xml', headerXml);
  zip.file('Contents/section0.xml', sectionXml);
  Object.keys(extraFiles || {}).forEach((n) => zip.file(n, extraFiles[n]));
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
}

function hwpxStyledFile(extra) {
  return hwpxPackage(styledHeaderXml(), styledSectionXml(), extra);
}

/* 실제 한/글 문서처럼 부가 설정 파일이 붙어 있는 HWPX */
function hwpxRichFile() {
  return hwpxPackage(styledHeaderXml(), styledSectionXml(), {
    'settings.xml': '<?xml version="1.0" encoding="UTF-8"?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>',
    'Preview/PrvText.txt': '미리보기 텍스트',
    'DocOptions/DrmLicense.xml': '<?xml version="1.0" encoding="UTF-8"?><license/>',
  });
}

function hwpxImageFile() {
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const run =
    '<hp:p id="3" paraPrIDRef="6" styleIDRef="3"><hp:run charPrIDRef="8">' +
    '<hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic>' +
    '</hp:run></hp:p>';
  return hwpxPackage(styledHeaderXml(), styledSectionXml(run), { 'BinData/image1.png': png });
}

/* -------------------------------- PDF -------------------------------- */
/*
 * 한글이 들어있는 최소 PDF 를 직접 만든다.
 * 실제 글꼴을 넣지 않고 ToUnicode CMap 으로만 매핑하므로 화면에 그려지지는 않지만,
 * PDF 본문 텍스트 추출(부서 판별) 경로를 그대로 검증할 수 있다.
 */
function pdfFile(lines, pageCount) {
  const pages = Math.max(1, pageCount || 1);
  const text = lines.join('\n');
  const chars = [...text.replace(/\n/g, '')];
  const bf = chars
    .map((c, i) => '<' + (i + 1).toString(16).padStart(4, '0') + '> <' + c.codePointAt(0).toString(16).padStart(4, '0') + '>')
    .join(' ');
  const cmap =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /A def /CMapType 2 def ' +
    '1 begincodespacerange <0000><FFFF> endcodespacerange ' +
    chars.length + ' beginbfchar ' + bf + ' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';

  let cursor = 0;
  const contents = lines.map((line) => {
    const hex = [...line].map(() => (++cursor).toString(16).padStart(4, '0')).join('');
    return hex;
  });

  const objs = [];
  const pageObjIds = [];
  let nextId = 100;
  const pageContents = [];
  for (let p = 0; p < pages; p++) {
    const body =
      'BT /F1 14 Tf ' +
      contents.map((hex, i) => '1 0 0 1 50 ' + (760 - i * 24) + ' Tm <' + hex + '> Tj ').join('') +
      'ET';
    pageContents.push(body);
  }

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  let kids = [];
  for (let p = 0; p < pages; p++) {
    const pageId = 10 + p * 2;
    const contentId = pageId + 1;
    pageObjIds.push(pageId);
    kids.push(pageId + ' 0 R');
    objs[pageId] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents ' +
      contentId + ' 0 R >>';
    objs[contentId] =
      '<< /Length ' + pageContents[p].length + ' >>\nstream\n' + pageContents[p] + '\nendstream';
  }
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>';
  objs[5] =
    '<< /Type /Font /Subtype /Type0 /BaseFont /Dummy /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>';
  objs[6] =
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Dummy /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 >>';
  objs[7] = '<< /Length ' + cmap.length + ' >>\nstream\n' + cmap + '\nendstream';
  objs[8] =
    '<< /Type /FontDescriptor /FontName /Dummy /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>';

  const maxId = objs.length;
  let out = '%PDF-1.4\n';
  const off = [];
  for (let i = 1; i < maxId; i++) {
    if (!objs[i]) continue;
    off[i] = out.length;
    out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
  }
  const xrefPos = out.length;
  out += 'xref\n0 ' + maxId + '\n0000000000 65535 f \n';
  for (let i = 1; i < maxId; i++) {
    out += objs[i]
      ? String(off[i]).padStart(10, '0') + ' 00000 n \n'
      : '0000000000 65535 f \n';
  }
  out += 'trailer\n<< /Size ' + maxId + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return new Uint8Array(Buffer.from(out, 'latin1'));
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

  // 16) PDF (본문에 담당부서)
  add('회신자료_08.pdf', pdfFile(['2026년 상수도 시설 현황 제출', '담당부서 : 상수도사업소', '작성일 : 2026-08-07'], 2));

  // 17) PDF (파일명으로 부서 판별)
  add('민원봉사과_회신.pdf', pdfFile(['민원 처리 현황 제출', '항목별 건수는 붙임 참조'], 1));

  return files;
}

module.exports = {
  hwpxStyledFile,
  hwpxRichFile,
  hwpxImageFile,
  hwpxPackage,
  styledHeaderXml,
  styledSectionXml,
  pdfFile,
  BASE_HEADER,
  dataRows,
  xlsxFromSheets,
  csvFile,
  hwpxFile,
  hwpxSection,
  hwpFile,
  buildSamples,
};
