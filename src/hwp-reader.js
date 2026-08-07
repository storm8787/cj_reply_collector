/*
 * HWP 5.0 이상 (한글 바이너리 문서) 읽기 - 부분 지원.
 * CFB(OLE) 컨테이너를 직접 열고 BodyText 레코드에서 문단 텍스트와 표를 추출한다.
 * 외부 변환 서버를 사용하지 않는다.
 *
 * 한계:
 *  - 배포용(문서 보호) 문서, 암호 설정 문서는 읽지 않는다.
 *  - 표 구조는 셀 주소 정보를 기준으로 재구성하며, 복잡한 중첩 표는 정확하지 않을 수 있다.
 *  - 글꼴/서식은 복원하지 않는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var TAG = {
    PARA_HEADER: 66,
    PARA_TEXT: 67,
    CTRL_HEADER: 71,
    LIST_HEADER: 72,
    TABLE: 77,
  };

  function u16(buf, at) {
    return buf[at] | (buf[at + 1] << 8);
  }
  function u32(buf, at) {
    return (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16) | (buf[at + 3] << 24)) >>> 0;
  }

  function cfbLib() {
    var X = global.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
    return X && X.CFB ? X.CFB : null;
  }

  function toU8(content) {
    if (!content) return new Uint8Array(0);
    if (content instanceof Uint8Array) return content;
    if (Array.isArray(content)) return Uint8Array.from(content);
    if (content.buffer) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    return new Uint8Array(content);
  }

  function inflateRaw(u8) {
    if (typeof global.DecompressionStream === 'function' && typeof global.Response === 'function') {
      try {
        var ds = new global.DecompressionStream('deflate-raw');
        var writer = ds.writable.getWriter();
        writer.write(u8);
        writer.close();
        return new global.Response(ds.readable).arrayBuffer().then(function (ab) {
          return new Uint8Array(ab);
        });
      } catch (e) {
        /* 아래 대체 경로 사용 */
      }
    }
    var CFB = cfbLib();
    if (CFB && CFB.utils && CFB.utils._inflateRaw) {
      var guesses = [u8.length * 12, u8.length * 40, u8.length * 120, 8 * 1024 * 1024];
      for (var i = 0; i < guesses.length; i++) {
        try {
          var out = CFB.utils._inflateRaw(u8, Math.max(4096, Math.min(guesses[i], 64 * 1024 * 1024)));
          return Promise.resolve(out);
        } catch (e) {
          /* 다음 크기로 재시도 */
        }
      }
    }
    return Promise.reject(new Error('inflate-unavailable'));
  }

  /** 레코드 스트림 분해 */
  function parseRecords(buf) {
    var recs = [];
    var pos = 0;
    var guard = 0;
    while (pos + 4 <= buf.length) {
      if (guard++ > 2000000) break;
      var head = u32(buf, pos);
      pos += 4;
      if (head === 0) break; // 압축 해제 시 남은 0 패딩
      var tagId = head & 0x3ff;
      var level = (head >> 10) & 0x3ff;
      var size = (head >> 20) & 0xfff;
      if (size === 0xfff) {
        if (pos + 4 > buf.length) break;
        size = u32(buf, pos);
        pos += 4;
      }
      if (size < 0 || pos + size > buf.length) break;
      recs.push({ tag: tagId, level: level, data: buf.subarray(pos, pos + size) });
      pos += size;
    }
    return recs;
  }

  /** PARA_TEXT (UTF-16LE + 제어문자) 를 사람이 읽는 텍스트로 */
  function decodeParaText(data) {
    var out = '';
    var i = 0;
    while (i + 1 < data.length) {
      var code = u16(data, i);
      if (code < 32) {
        if (code === 10 || code === 13) {
          out += '\n';
          i += 2;
        } else if (code === 0) {
          i += 2;
        } else if (
          code === 4 || code === 5 || code === 6 || code === 7 || code === 8 || code === 9 ||
          code === 19 || code === 20 ||
          code === 1 || code === 2 || code === 3 || code === 11 || code === 12 ||
          code === 14 || code === 15 || code === 16 || code === 17 || code === 18 ||
          code === 21 || code === 22 || code === 23
        ) {
          if (code === 9) out += ' ';
          i += 16; // 확장/인라인 컨트롤은 8개의 WCHAR 을 차지한다
        } else {
          i += 2;
        }
      } else {
        out += String.fromCharCode(code);
        i += 2;
      }
    }
    return out;
  }

  function ctrlIdOf(data) {
    if (data.length < 4) return '';
    var a = String.fromCharCode(data[0], data[1], data[2], data[3]);
    var b = String.fromCharCode(data[3], data[2], data[1], data[0]);
    return /tbl/i.test(a) ? a : b;
  }

  function buildGrid(table) {
    var maxRow = 0;
    var maxCol = 0;
    table.cells.forEach(function (c) {
      maxRow = Math.max(maxRow, c.rowAddr + c.rowSpan);
      maxCol = Math.max(maxCol, c.colAddr + c.colSpan);
    });
    var rowCnt = Math.max(table.rowCnt || 0, maxRow);
    var colCnt = Math.max(table.colCnt || 0, maxCol);
    if (!rowCnt || !colCnt) return null;
    if (rowCnt > 5000 || colCnt > 200) return null;
    var grid = [];
    for (var r = 0; r < rowCnt; r++) grid.push(new Array(colCnt).fill(''));
    table.cells.forEach(function (cell) {
      var text = T.collapseSpace(cell.texts.join(' '));
      for (var r = cell.rowAddr; r < Math.min(rowCnt, cell.rowAddr + cell.rowSpan); r++) {
        for (var c = cell.colAddr; c < Math.min(colCnt, cell.colAddr + cell.colSpan); c++) {
          if (grid[r][c] === '') grid[r][c] = text;
        }
      }
    });
    return grid;
  }

  /** 레코드 목록에서 문단과 표를 재구성 */
  function extractContent(recs, paragraphs, tables) {
    var stack = [];
    var seq = 0;
    recs.forEach(function (rec) {
      var top = stack[stack.length - 1];
      while (stack.length && rec.level < stack[stack.length - 1].level) stack.pop();
      top = stack[stack.length - 1];

      if (rec.tag === TAG.CTRL_HEADER) {
        var id = ctrlIdOf(rec.data);
        if (/tbl/i.test(id)) {
          var t = { level: rec.level, rowCnt: 0, colCnt: 0, cells: [], current: null, seq: seq++ };
          tables.push(t);
          stack.push(t);
        }
        return;
      }
      if (rec.tag === TAG.TABLE && top && rec.level === top.level + 1) {
        if (rec.data.length >= 8) {
          top.rowCnt = u16(rec.data, 4);
          top.colCnt = u16(rec.data, 6);
        }
        return;
      }
      if (rec.tag === TAG.LIST_HEADER && top && rec.level === top.level + 1) {
        var d = rec.data;
        var cell = { colAddr: 0, rowAddr: 0, colSpan: 1, rowSpan: 1, texts: [] };
        if (d.length >= 16) {
          var ca = u16(d, 8);
          var ra = u16(d, 10);
          var cs = u16(d, 12) || 1;
          var rs = u16(d, 14) || 1;
          if (ca < 200 && ra < 5000 && cs < 200 && rs < 5000) {
            cell.colAddr = ca;
            cell.rowAddr = ra;
            cell.colSpan = cs;
            cell.rowSpan = rs;
          } else {
            cell.colAddr = top.cells.length % Math.max(1, top.colCnt || 1);
            cell.rowAddr = Math.floor(top.cells.length / Math.max(1, top.colCnt || 1));
          }
        } else {
          cell.colAddr = top.cells.length % Math.max(1, top.colCnt || 1);
          cell.rowAddr = Math.floor(top.cells.length / Math.max(1, top.colCnt || 1));
        }
        top.cells.push(cell);
        top.current = cell;
        return;
      }
      if (rec.tag === TAG.PARA_TEXT) {
        var text = decodeParaText(rec.data);
        text.split('\n').forEach(function (line) {
          var v = T.collapseSpace(line);
          if (!v) return;
          if (top && top.current && rec.level > top.level + 1) top.current.texts.push(v);
          else if (!top) paragraphs.push(v);
        });
        return;
      }
    });
  }

  function decodeUtf16(u8) {
    var out = '';
    for (var i = 0; i + 1 < u8.length; i += 2) {
      var c = u16(u8, i);
      if (c === 0) continue;
      out += String.fromCharCode(c);
    }
    return out;
  }

  /**
   * @returns Promise<doc>
   */
  function read(data, fileName) {
    var CFB = cfbLib();
    if (!CFB) {
      return Promise.resolve({
        support: 'unsupported',
        message: '한글 문서(HWP)를 읽는 기능을 사용할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var cfb;
    try {
      cfb = CFB.read(toU8(data), { type: 'array' });
    } catch (e) {
      return Promise.resolve({
        support: 'corrupt',
        message: '파일을 열 수 없습니다. 손상되었거나 한글 문서(HWP)가 아닙니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var entries = {};
    (cfb.FullPaths || []).forEach(function (p, i) {
      var short = p.replace(/^[^/]*\//, '');
      entries[short] = cfb.FileIndex[i];
    });
    var header = entries['FileHeader'];
    if (!header || !header.content) {
      return Promise.resolve({
        support: 'unsupported',
        message: '이 파일은 한글 문서(HWP)가 아닙니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var hb = toU8(header.content);
    var sig = '';
    for (var i = 0; i < 17 && i < hb.length; i++) sig += String.fromCharCode(hb[i]);
    if (sig.indexOf('HWP Document File') !== 0) {
      return Promise.resolve({
        support: 'unsupported',
        message: '이 파일은 한글 문서(HWP)가 아닙니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var flags = hb.length >= 40 ? u32(hb, 36) : 0;
    var compressed = !!(flags & 0x01);
    var encrypted = !!(flags & 0x02);
    var distributed = !!(flags & 0x04);
    if (encrypted) {
      return Promise.resolve({
        support: 'encrypted',
        message: '암호화된 문서는 처리할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }
    if (distributed) {
      return Promise.resolve({
        support: 'unsupported',
        message: '배포용(보호된) 한글 문서는 처리할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }

    var sectionKeys = Object.keys(entries)
      .filter(function (k) {
        return /^BodyText\/Section\d+$/i.test(k);
      })
      .sort(function (a, b) {
        return (
          parseInt((/Section(\d+)/i.exec(a) || [])[1] || '0', 10) -
          parseInt((/Section(\d+)/i.exec(b) || [])[1] || '0', 10)
        );
      });

    var paragraphs = [];
    var tables = [];
    var chain = Promise.resolve();
    var failed = 0;
    sectionKeys.forEach(function (key) {
      chain = chain.then(function () {
        var raw = toU8(entries[key].content);
        var step = compressed ? inflateRaw(raw) : Promise.resolve(raw);
        return step
          .then(function (buf) {
            extractContent(parseRecords(buf), paragraphs, tables);
          })
          .catch(function () {
            failed++;
          });
      });
    });

    return chain.then(function () {
      var sections = [];
      tables.forEach(function (t, i) {
        var grid = buildGrid(t);
        if (!grid) return;
        sections.push({ kind: 'table', label: '표 ' + (i + 1), textGrid: grid, rawGrid: grid });
      });
      if (!paragraphs.length && entries['PrvText'] && entries['PrvText'].content) {
        decodeUtf16(toU8(entries['PrvText'].content))
          .split(/\r?\n/)
          .forEach(function (l) {
            var v = T.collapseSpace(l);
            if (v) paragraphs.push(v);
          });
      }
      if (!sectionKeys.length || (failed === sectionKeys.length && sectionKeys.length)) {
        return {
          support: 'partial',
          message: '한글 문서(HWP)의 본문을 읽지 못했습니다. 부서를 직접 선택해 주세요.',
          sections: sections,
          paragraphs: paragraphs,
        };
      }
      return {
        support: 'partial',
        message: sections.length ? '' : '이 파일에서 취합할 표를 찾지 못했습니다.',
        sections: sections,
        paragraphs: paragraphs,
      };
    });
  }

  CJ.hwp = {
    read: read,
    parseRecords: parseRecords,
    decodeParaText: decodeParaText,
    extractContent: extractContent,
    buildGrid: buildGrid,
    inflateRaw: inflateRaw,
    TAG: TAG,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
