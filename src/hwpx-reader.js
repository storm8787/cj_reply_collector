/*
 * HWPX 읽기.
 * HWPX 는 ZIP + XML 구조이므로 브라우저 안에서 직접 압축을 풀고 XML 을 분석한다.
 * 목적은 (1) 부서명 판별 (2) 문서 안의 표 데이터를 취합 대상으로 읽기 이며,
 * 글꼴/색상/테두리 같은 서식 복원은 목적이 아니다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  function zipLib() {
    return global.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
  }

  function sortSectionNames(names) {
    return names.slice().sort(function (a, b) {
      var na = parseInt((/section(\d+)/i.exec(a) || [])[1] || '0', 10);
      var nb = parseInt((/section(\d+)/i.exec(b) || [])[1] || '0', 10);
      if (na !== nb) return na - nb;
      return a < b ? -1 : 1;
    });
  }

  function cellText(tc, xml) {
    var lines = [];
    (function walk(node) {
      if (!node) return;
      if (node.local === 'tbl') return; // 중첩 표는 별도로 수집
      if (node.local === 'p') {
        lines.push(runText(node, xml));
        return;
      }
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    })(tc);
    return T.collapseSpace(lines.join(' '));
  }

  function runText(p, xml) {
    var buf = '';
    (function walk(node) {
      if (!node) return;
      if (node.local === 'tbl') return;
      if (node.local === 't') {
        buf += xml.textOf(node);
        return;
      }
      if (node.local === 'lineBreak' || node.local === 'linesegarray') {
        buf += ' ';
      }
      if (node.local === 'tab') buf += ' ';
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    })(p);
    return T.collapseSpace(buf);
  }

  function buildTable(tbl, xml, label) {
    var trs = xml.childrenOf(tbl, 'tr');
    if (!trs.length) {
      // 일부 문서는 tr 이 한 단계 더 들어가 있다
      trs = xml.findAll(tbl, 'tr').filter(function (tr) {
        return xml.findAll(tr, 'tbl').length === 0 || true;
      });
    }
    var cells = [];
    var maxRow = 0;
    var maxCol = 0;
    trs.forEach(function (tr, ri) {
      var tcs = xml.childrenOf(tr, 'tc');
      if (!tcs.length) tcs = xml.findAll(tr, 'tc');
      var autoCol = 0;
      tcs.forEach(function (tc) {
        var addr = xml.childrenOf(tc, 'cellAddr')[0];
        var span = xml.childrenOf(tc, 'cellSpan')[0];
        var rowAddr = addr && addr.attrs.rowAddr !== undefined ? parseInt(addr.attrs.rowAddr, 10) : ri;
        var colAddr = addr && addr.attrs.colAddr !== undefined ? parseInt(addr.attrs.colAddr, 10) : autoCol;
        var rowSpan = span && span.attrs.rowSpan ? parseInt(span.attrs.rowSpan, 10) || 1 : 1;
        var colSpan = span && span.attrs.colSpan ? parseInt(span.attrs.colSpan, 10) || 1 : 1;
        if (isNaN(rowAddr)) rowAddr = ri;
        if (isNaN(colAddr)) colAddr = autoCol;
        autoCol = colAddr + colSpan;
        var text = cellText(tc, xml);
        cells.push({ r: rowAddr, c: colAddr, rs: rowSpan, cs: colSpan, text: text });
        maxRow = Math.max(maxRow, rowAddr + rowSpan);
        maxCol = Math.max(maxCol, colAddr + colSpan);
      });
    });
    var rowCnt = parseInt(tbl.attrs.rowCnt, 10) || maxRow;
    var colCnt = parseInt(tbl.attrs.colCnt, 10) || maxCol;
    rowCnt = Math.max(rowCnt, maxRow);
    colCnt = Math.max(colCnt, maxCol);
    var grid = [];
    for (var r = 0; r < rowCnt; r++) {
      grid.push(new Array(colCnt).fill(''));
    }
    cells.forEach(function (cell) {
      for (var r = cell.r; r < Math.min(rowCnt, cell.r + cell.rs); r++) {
        for (var c = cell.c; c < Math.min(colCnt, cell.c + cell.cs); c++) {
          if (grid[r][c] === '') grid[r][c] = cell.text;
        }
      }
    });
    return { kind: 'table', label: label, textGrid: grid, rawGrid: grid };
  }

  function parseSection(xmlText, xml, tableCounter, paragraphs, sections) {
    var root = xml.parse(xmlText);
    if (!root) return false;

    function collectTable(tblNode) {
      tableCounter.n += 1;
      sections.push(buildTable(tblNode, xml, '표 ' + tableCounter.n));
      // 셀 안에 들어있는 중첩 표도 별도 후보로 수집
      xml.findAll(tblNode, 'tbl').forEach(function (inner) {
        tableCounter.n += 1;
        sections.push(buildTable(inner, xml, '표 ' + tableCounter.n));
      });
    }

    (function walk(node) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c.local === 'tbl') {
          collectTable(c);
          continue;
        }
        if (c.local === 'p') {
          var line = runText(c, xml);
          if (line) paragraphs.push(line);
          // 문단(run) 안에 들어있는 표 수집
          (function scan(node2) {
            for (var j = 0; j < node2.children.length; j++) {
              var d = node2.children[j];
              if (d.local === 'tbl') {
                collectTable(d);
                continue;
              }
              scan(d);
            }
          })(c);
          continue;
        }
        walk(c);
      }
    })(root);
    return true;
  }

  /**
   * @returns Promise<doc>
   */
  function read(data, fileName) {
    var xml = CJ.xml;
    var JSZipRef = zipLib();
    if (!JSZipRef) {
      return Promise.resolve({
        support: 'unsupported',
        message: '한글 문서를 읽는 기능을 사용할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }
    return JSZipRef.loadAsync(data)
      .then(function (zip) {
        var names = Object.keys(zip.files);
        var manifest = names.filter(function (n) {
          return /META-INF\/manifest\.xml$/i.test(n);
        })[0];
        var chain = Promise.resolve(null);
        if (manifest) {
          chain = zip
            .file(manifest)
            .async('string')
            .catch(function () {
              return '';
            });
        }
        return chain.then(function (manifestText) {
          if (manifestText && /encryption-data|encryption_data/i.test(manifestText)) {
            return {
              support: 'encrypted',
              message: '암호화된 문서는 처리할 수 없습니다.',
              sections: [],
              paragraphs: [],
            };
          }
          var sectionNames = sortSectionNames(
            names.filter(function (n) {
              return /Contents\/section\d*\.xml$/i.test(n);
            })
          );
          if (!sectionNames.length) {
            sectionNames = sortSectionNames(
              names.filter(function (n) {
                return /\.xml$/i.test(n) && /section/i.test(n);
              })
            );
          }
          if (!sectionNames.length) {
            var isDocx = names.some(function (n) {
              return /^word\/document\.xml$/i.test(n);
            });
            return {
              support: 'unsupported',
              message: isDocx
                ? '이 파일은 한글 문서(HWPX)가 아닙니다.'
                : '한글 문서(HWPX)의 본문을 찾지 못했습니다.',
              sections: [],
              paragraphs: [],
            };
          }
          var paragraphs = [];
          var sections = [];
          var counter = { n: 0 };
          var seq = Promise.resolve();
          var failures = 0;
          sectionNames.forEach(function (name) {
            seq = seq.then(function () {
              return zip
                .file(name)
                .async('string')
                .then(function (text) {
                  if (!parseSection(text, xml, counter, paragraphs, sections)) failures++;
                })
                .catch(function () {
                  failures++;
                });
            });
          });
          return seq.then(function () {
            if (failures === sectionNames.length) {
              return {
                support: 'corrupt',
                message: '문서가 손상되어 내용을 읽지 못했습니다.',
                sections: [],
                paragraphs: [],
              };
            }
            return {
              support: failures ? 'partial' : 'supported',
              message: failures ? '일부 내용을 읽지 못했습니다.' : '',
              sections: sections,
              paragraphs: paragraphs,
            };
          });
        });
      })
      .catch(function () {
        return {
          support: 'corrupt',
          message: '파일을 열 수 없습니다. 손상되었거나 한글 문서(HWPX)가 아닙니다.',
          sections: [],
          paragraphs: [],
        };
      });
  }

  CJ.hwpx = { read: read, buildTable: buildTable };
})(typeof globalThis !== 'undefined' ? globalThis : this);
