/*
 * 엑셀(XLSX/XLSM/XLS)과 CSV 읽기.
 * SheetJS 를 로컬에 포함해 사용하며 네트워크 요청은 하지 않는다.
 * 판별용 텍스트 격자(textGrid)와 결과 출력용 원본값 격자(rawGrid)를 함께 만든다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var MAX_ROWS = 50000;
  var MAX_COLS = 200;

  function lib() {
    return global.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  }

  /** CSV 인코딩 추정: UTF-8 우선, 실패하면 EUC-KR(CP949) */
  function decodeCsv(u8) {
    var text = null;
    if (typeof TextDecoder !== 'undefined') {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      } catch (e) {
        text = null;
      }
      if (text === null) {
        try {
          text = new TextDecoder('euc-kr').decode(u8);
        } catch (e2) {
          text = null;
        }
      }
    }
    if (text === null) {
      text = '';
      for (var i = 0; i < u8.length; i++) text += String.fromCharCode(u8[i]);
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  }

  function cellText(cell) {
    if (!cell) return '';
    if (cell.w !== undefined && cell.w !== null) return String(cell.w);
    if (cell.v === undefined || cell.v === null) return '';
    if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
    return String(cell.v);
  }

  function cellValue(cell) {
    if (!cell) return '';
    if (cell.v === undefined || cell.v === null) return '';
    if (cell.t === 'n' && cell.w && /^[\d.,-]+$/.test(String(cell.w)) === false) return cell.w;
    return cell.v;
  }

  function sheetToGrids(XLSXRef, ws) {
    var ref = ws['!ref'];
    if (!ref) return { textGrid: [], rawGrid: [] };
    var range = XLSXRef.utils.decode_range(ref);
    var rowEnd = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
    var colEnd = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
    var textGrid = [];
    var rawGrid = [];
    for (var r = range.s.r; r <= rowEnd; r++) {
      var trow = [];
      var vrow = [];
      for (var c = range.s.c; c <= colEnd; c++) {
        var addr = XLSXRef.utils.encode_cell({ r: r, c: c });
        var cell = ws[addr];
        trow.push(cellText(cell));
        vrow.push(cellValue(cell));
      }
      textGrid.push(trow);
      rawGrid.push(vrow);
    }
    // 병합 셀: 좌측 상단 값을 병합 영역 전체에 채운다
    (ws['!merges'] || []).forEach(function (m) {
      var sr = m.s.r - range.s.r;
      var sc = m.s.c - range.s.c;
      if (sr < 0 || sc < 0 || sr >= textGrid.length || sc >= (textGrid[sr] || []).length) return;
      var tv = textGrid[sr][sc];
      var rv = rawGrid[sr][sc];
      if (T.isBlank(tv)) return;
      for (var r2 = m.s.r - range.s.r; r2 <= Math.min(m.e.r - range.s.r, textGrid.length - 1); r2++) {
        for (var c2 = m.s.c - range.s.c; c2 <= Math.min(m.e.c - range.s.c, (textGrid[r2] || []).length - 1); c2++) {
          if (T.isBlank(textGrid[r2][c2])) {
            textGrid[r2][c2] = tv;
            rawGrid[r2][c2] = rv;
          }
        }
      }
    });
    return { textGrid: textGrid, rawGrid: rawGrid };
  }

  /**
   * 확장자와 실제 파일 내용이 맞는지 확인한다.
   * (SheetJS 는 알 수 없는 내용을 텍스트로 해석해 버리는 경우가 있어 먼저 걸러낸다.)
   */
  function looksLikeSpreadsheet(u8, ext) {
    if (ext === 'csv' || ext === 'txt') return true;
    if (u8.length < 8) return false;
    var isZip = u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7);
    var isCfb =
      u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0 &&
      u8[4] === 0xa1 && u8[5] === 0xb1 && u8[6] === 0x1a && u8[7] === 0xe1;
    // 오래된 BIFF(xls) 는 CFB 가 아닌 형태도 있다
    var isBiff = u8[0] === 0x09 && (u8[1] === 0x00 || u8[1] === 0x02 || u8[1] === 0x04 || u8[1] === 0x08);
    if (ext === 'xls') return isCfb || isBiff || isZip;
    return isZip || isCfb;
  }

  function friendlyError(err) {
    var msg = String((err && err.message) || err || '');
    if (/password|encrypt/i.test(msg)) return { support: 'encrypted', message: '암호화된 문서는 처리할 수 없습니다.' };
    if (/unsupported/i.test(msg)) return { support: 'unsupported', message: '지원하지 않는 파일 형식입니다.' };
    return { support: 'corrupt', message: '파일을 열 수 없습니다. 손상되었거나 형식이 다른 파일입니다.' };
  }

  /**
   * @returns Promise<doc>
   */
  function read(data, fileName) {
    var XLSXRef = lib();
    if (!XLSXRef) {
      return Promise.resolve({
        support: 'unsupported',
        message: '엑셀을 읽는 기능을 사용할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var ext = T.fileExtension(fileName);
    var wb;
    try {
      if (ext === 'csv' || ext === 'txt') {
        var text = decodeCsv(toU8(data));
        if (!T.collapseSpace(text)) {
          return Promise.resolve({ support: 'empty', message: '내용이 없는 파일입니다.', sections: [], paragraphs: [] });
        }
        wb = XLSXRef.read(text, { type: 'string', raw: false, cellDates: true });
      } else {
        var u8 = toU8(data);
        if (!u8.length) {
          return Promise.resolve({ support: 'empty', message: '내용이 없는 파일입니다.', sections: [], paragraphs: [] });
        }
        if (!looksLikeSpreadsheet(u8, ext)) {
          return Promise.resolve({
            support: 'corrupt',
            message: '파일을 열 수 없습니다. 손상되었거나 형식이 다른 파일입니다.',
            sections: [],
            paragraphs: [],
          });
        }
        wb = XLSXRef.read(u8, { type: 'array', cellDates: true, cellStyles: false });
      }
    } catch (e) {
      var f = friendlyError(e);
      return Promise.resolve({ support: f.support, message: f.message, sections: [], paragraphs: [] });
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
      return Promise.resolve({ support: 'empty', message: '내용이 없는 파일입니다.', sections: [], paragraphs: [] });
    }
    var sections = [];
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws) return;
      var grids = sheetToGrids(XLSXRef, ws);
      if (!grids.textGrid.length) return;
      var hasValue = grids.textGrid.some(function (row) {
        return row.some(function (v) {
          return !T.isBlank(v);
        });
      });
      if (!hasValue) return;
      sections.push({ kind: 'sheet', label: name, textGrid: grids.textGrid, rawGrid: grids.rawGrid });
    });
    if (!sections.length) {
      return Promise.resolve({ support: 'empty', message: '내용이 없는 파일입니다.', sections: [], paragraphs: [] });
    }
    return Promise.resolve({ support: 'supported', message: '', sections: sections, paragraphs: [] });
  }

  CJ.excel = { read: read, sheetToGrids: sheetToGrids, decodeCsv: decodeCsv };
})(typeof globalThis !== 'undefined' ? globalThis : this);
