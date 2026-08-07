/*
 * 실제 취합 대상 데이터표 자동 탐지.
 * 제목/부서정보/담당자정보 같은 상단 안내영역과 실제 회신 데이터표를 구분한다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  function occupiedCols(row, maxCols) {
    var cols = [];
    var n = Math.min((row || []).length, maxCols || 1000);
    for (var c = 0; c < n; c++) {
      if (!T.isBlank(row[c])) cols.push(c);
    }
    return cols;
  }

  function isNumericLike(v) {
    var s = T.normalizeText(v).replace(/[,%\s]/g, '');
    return s !== '' && !isNaN(Number(s));
  }

  /** 헤더 행으로 쓸 만한 행인지 */
  function headerLike(row, cols) {
    if (cols.length < 2) return false;
    var textish = 0;
    var distinct = Object.create(null);
    var distinctCount = 0;
    for (var i = 0; i < cols.length; i++) {
      var v = row[cols[i]];
      if (!isNumericLike(v) && T.normalizeText(v).length <= 60) textish++;
      var k = T.headerKey(v);
      if (!distinct[k]) {
        distinct[k] = true;
        distinctCount++;
      }
    }
    // 여러 칸을 합친 제목 행(모든 칸의 값이 같음)은 머리글이 아니다
    if (distinctCount < 2) return false;
    return textish >= Math.ceil(cols.length / 2);
  }

  function overlapRatio(a, bSet) {
    if (!a.length) return 0;
    var hit = 0;
    for (var i = 0; i < a.length; i++) if (bSet[a[i]]) hit++;
    return hit / a.length;
  }

  /**
   * 격자에서 표 후보들을 찾는다.
   * 반환: [{headerRow, cols, dataStart, dataEnd, dataRowCount, score}]
   */
  function findTableBlocks(grid, options) {
    var maxCols = (options && options.maxCols) || 200;
    var maxRows = grid.length;
    var candidates = [];
    var labelCheck = CJ.detector ? CJ.detector.isFieldLabel : function () { return false; };

    for (var r = 0; r < maxRows; r++) {
      var row = grid[r] || [];
      var cols = occupiedCols(row, maxCols);
      if (!headerLike(row, cols)) continue;
      var colSet = Object.create(null);
      cols.forEach(function (c) {
        colSet[c] = true;
      });
      var dataRows = 0;
      var lastData = r;
      var blankRun = 0;
      var rr = r + 1;
      for (; rr < maxRows; rr++) {
        var next = grid[rr] || [];
        var ncols = occupiedCols(next, maxCols);
        if (!ncols.length) {
          // 표 중간의 빈 행 1줄은 넘어가고, 2줄 이상이면 블록 종료
          blankRun++;
          if (blankRun >= 2) break;
          continue;
        }
        blankRun = 0;
        if (ncols.length > cols.length) break; // 헤더보다 넓어지면 다른 구조
        if (overlapRatio(ncols, colSet) < 0.5) break;
        dataRows++;
        lastData = rr;
      }
      if (dataRows < 1) continue;
      var score = dataRows * cols.length + cols.length;
      // 상단 안내영역(부서명 : 값)처럼 보이면 감점
      if (cols.length <= 2 && labelCheck(row[cols[0]])) score = score * 0.2;
      candidates.push({
        headerRow: r,
        cols: cols,
        dataStart: r + 1,
        dataEnd: lastData,
        dataRowCount: dataRows,
        score: score,
      });
    }

    // 겹치는 후보는 점수가 높은 것만 남긴다
    candidates.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.headerRow - b.headerRow;
    });
    var picked = [];
    candidates.forEach(function (c) {
      var clash = picked.some(function (p) {
        return !(c.dataEnd < p.headerRow || c.headerRow > p.dataEnd);
      });
      if (!clash) picked.push(c);
    });
    picked.sort(function (a, b) {
      return a.headerRow - b.headerRow;
    });
    return picked;
  }

  function uniqueHeaders(names) {
    var seen = Object.create(null);
    return names.map(function (n) {
      var base = n;
      var key = T.headerKey(base);
      if (!key) return base;
      if (!seen[key]) {
        seen[key] = 1;
        return base;
      }
      seen[key] += 1;
      return base + '(' + seen[key] + ')';
    });
  }

  /**
   * 표 후보 하나를 헤더/데이터로 변환한다.
   * textGrid 는 판별용, rawGrid 는 결과 출력용 값이다.
   */
  function materialize(section, block) {
    var textGrid = section.textGrid;
    var rawGrid = section.rawGrid || section.textGrid;
    var headerRow = textGrid[block.headerRow] || [];

    // 사용할 열 결정: 헤더가 있거나 데이터가 있는 열
    var minCol = Math.min.apply(null, block.cols);
    var maxCol = Math.max.apply(null, block.cols);
    var useCols = [];
    for (var c = minCol; c <= maxCol; c++) {
      var hasHeader = !T.isBlank(headerRow[c]);
      var hasData = false;
      for (var r = block.dataStart; r <= block.dataEnd; r++) {
        if (!T.isBlank((textGrid[r] || [])[c])) {
          hasData = true;
          break;
        }
      }
      if (hasHeader || hasData) useCols.push(c);
    }
    var headers = uniqueHeaders(
      useCols.map(function (c, i) {
        var h = T.normalizeText(headerRow[c]);
        return h || '(이름없는 열' + (i + 1) + ')';
      })
    );

    var rows = [];
    for (var r2 = block.dataStart; r2 <= block.dataEnd; r2++) {
      var trow = textGrid[r2] || [];
      var rrow = (rawGrid && rawGrid[r2]) || trow;
      var allBlank = useCols.every(function (c) {
        return T.isBlank(trow[c]);
      });
      if (allBlank) continue; // 완전히 빈 행 제외
      rows.push(
        useCols.map(function (c) {
          var v = rrow[c];
          return v === undefined ? '' : v;
        })
      );
    }
    return { headers: headers, rows: rows, useCols: useCols };
  }

  /**
   * 문서(doc) 전체에서 표 후보 목록을 만든다.
   * 각 후보는 UI 에서 사용자가 다시 선택할 수 있다.
   */
  function detectTables(doc, options) {
    var out = [];
    (doc.sections || []).forEach(function (sec, si) {
      if (!sec.textGrid || !sec.textGrid.length) return;
      var blocks;
      if (sec.kind === 'table') {
        // 한글 문서의 표는 표 전체가 하나의 후보
        var cols0 = occupiedCols(sec.textGrid[0] || [], 200);
        var width = Math.max.apply(
          null,
          sec.textGrid.map(function (r) {
            return (r || []).length;
          })
        );
        var allCols = [];
        for (var i = 0; i < width; i++) allCols.push(i);
        blocks = [
          {
            headerRow: 0,
            cols: cols0.length ? cols0 : allCols,
            dataStart: 1,
            dataEnd: sec.textGrid.length - 1,
            dataRowCount: Math.max(0, sec.textGrid.length - 1),
            score: Math.max(0, sec.textGrid.length - 1) * width + width,
          },
        ];
        if (sec.textGrid.length < 2) blocks = [];
        // 제목/작성자용 소형 표는 점수가 낮아 자동 선택에서 밀린다
        if (blocks.length && CJ.detector && CJ.detector.isFieldLabel((sec.textGrid[0] || [])[0])) {
          blocks[0].score *= 0.2;
        }
      } else {
        blocks = findTableBlocks(sec.textGrid, options);
      }
      blocks.forEach(function (b, bi) {
        var mat = materialize(sec, b);
        if (!mat.headers.length || !mat.rows.length) return;
        out.push({
          id: si + ':' + bi,
          sectionIndex: si,
          sectionLabel: sec.label,
          sectionKind: sec.kind,
          label:
            sec.kind === 'table'
              ? sec.label
              : sec.label + ' (' + (b.headerRow + 1) + '행 머리글, ' + mat.rows.length + '행)',
          headerRow: b.headerRow,
          headers: mat.headers,
          rows: mat.rows,
          rowCount: mat.rows.length,
          colCount: mat.headers.length,
          score: b.score,
        });
      });
    });
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    return out;
  }

  CJ.tableDetector = {
    detectTables: detectTables,
    findTableBlocks: findTableBlocks,
    occupiedCols: occupiedCols,
    isNumericLike: isNumericLike,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
