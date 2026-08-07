/*
 * 부서 자동판별.
 *   1순위 파일명 → 2순위 대표 필드 → 3순위 문서 상단 → 4순위 사용자 직접 선택
 * 확정할 수 없는 경우 임의로 추측하지 않고 '확인 필요' 상태로 남긴다.
 * 팀명으로부터 상위 부서를 추론하지 않는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var METHOD = {
    FILENAME: '파일명',
    FIELD: '대표 필드',
    TOP: '문서 상단',
    MANUAL: '사용자 지정',
    NONE: '미확인',
  };

  // 상태: confirmed(확정) / review(확인 권장) / select(선택 필요)
  var STATUS = { CONFIRMED: 'confirmed', REVIEW: 'review', SELECT: 'select' };
  var STATUS_LABEL = { confirmed: '✅ 확정', review: '⚠ 확인 권장', select: '❌ 선택 필요' };

  // 2순위 대표 필드 라벨
  var FIELD_LABELS = [
    '부서명',
    '부서',
    '담당부서',
    '소관부서',
    '제출부서',
    '작성부서',
    '회신부서',
    '담당과',
    '소관과',
    '제출과',
    '작성과',
    '실과명',
    '부서(과)',
    '과명',
  ];
  var FIELD_LABEL_SET = (function () {
    var s = Object.create(null);
    FIELD_LABELS.forEach(function (l) {
      s[T.labelKey(l)] = true;
    });
    return s;
  })();

  function isFieldLabel(text) {
    if (T.isBlank(text)) return false;
    var k = T.labelKey(text);
    return !!FIELD_LABEL_SET[k];
  }

  /**
   * 부서 마스터로부터 검색용 인덱스를 만든다.
   * enabled=true 인 부서의 공식 부서명과 별칭만 대상으로 한다.
   */
  function buildIndex(departments) {
    var terms = [];
    (departments || []).forEach(function (d) {
      if (!d || !d.enabled) return;
      var name = T.normalizeText(d.name);
      if (!name) return;
      terms.push({ key: T.squeeze(name), display: name, dept: name, kind: 'name' });
      (d.aliases || []).forEach(function (a) {
        var v = T.normalizeText(a);
        if (!v) return;
        terms.push({ key: T.squeeze(v), display: v, dept: name, kind: 'alias' });
      });
    });
    terms = terms.filter(function (t) {
      return t.key.length >= 2;
    });
    // 긴 용어부터 검사하여 짧은 부분문자열 오탐을 줄인다.
    terms.sort(function (a, b) {
      return b.key.length - a.key.length;
    });
    return { terms: terms, departments: departments || [] };
  }

  /**
   * 텍스트에서 부서명/별칭을 모두 찾는다.
   * 긴 용어에 완전히 포함되는 짧은 용어의 매치는 버린다.
   */
  function findTerms(text, index, opts) {
    var namesOnly = opts && opts.namesOnly;
    var hay = T.squeeze(text);
    if (!hay) return [];
    var hits = [];
    index.terms.forEach(function (term) {
      if (namesOnly && term.kind !== 'name') return;
      var from = 0;
      for (;;) {
        var at = hay.indexOf(term.key, from);
        if (at < 0) break;
        hits.push({ term: term, start: at, end: at + term.key.length });
        from = at + 1;
      }
    });
    // 다른 매치에 완전히 포함되는 매치 제거
    var kept = hits.filter(function (h) {
      return !hits.some(function (o) {
        return o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start;
      });
    });
    return kept;
  }

  function distinctDepts(hits) {
    var seen = Object.create(null);
    var out = [];
    hits.forEach(function (h) {
      var d = h.term.dept;
      if (seen[d]) return;
      seen[d] = true;
      out.push(d);
    });
    return out;
  }

  function result(dept, method, status, extra) {
    var r = {
      department: dept || null,
      method: method,
      status: status,
      candidates: (extra && extra.candidates) || [],
      note: (extra && extra.note) || '',
      matchedTerm: (extra && extra.matchedTerm) || '',
    };
    return r;
  }

  /** 1순위: 파일명 */
  function detectFromFileName(fileName, index) {
    var normalized = T.normalizeFileName(fileName);
    var hits = findTerms(normalized, index);
    var depts = distinctDepts(hits);
    if (depts.length === 1) {
      return result(depts[0], METHOD.FILENAME, STATUS.CONFIRMED, { matchedTerm: hits[0].term.display });
    }
    if (depts.length > 1) {
      return result(null, METHOD.FILENAME, STATUS.SELECT, {
        candidates: depts,
        note: '파일명에서 여러 부서명이 발견되어 자동으로 확정하지 않았습니다.',
      });
    }
    return null;
  }

  /** 값 문자열에서 부서 판별 (정확히 일치 우선, 없으면 포함관계) */
  function matchValue(value, index) {
    if (T.isBlank(value)) return [];
    var key = T.squeeze(value);
    var exact = index.terms.filter(function (t) {
      return t.key === key;
    });
    if (exact.length) return distinctDepts(exact.map(function (t) { return { term: t }; }));
    if (key.length > 40) return []; // 문장 수준의 긴 값은 대표 필드 값으로 보지 않는다
    return distinctDepts(findTerms(value, index));
  }

  /** 표/시트 격자에서 대표 필드 후보를 수집 */
  function collectGridFieldHits(grid, index, options) {
    var maxRow = Math.min(grid.length, (options && options.scanRows) || 30);
    var maxCol = (options && options.scanCols) || 12;
    var scanDown = (options && options.scanDown) || 20;
    var hits = [];
    for (var r = 0; r < maxRow; r++) {
      var row = grid[r] || [];
      var cols = Math.min(row.length, maxCol);
      for (var c = 0; c < cols; c++) {
        var cell = row[c];
        if (T.isBlank(cell)) continue;
        var text = T.normalizeText(cell);
        var inlineSplit = splitLabelValue(text);
        if (inlineSplit) {
          // 한 셀 안에 "부서명 : 정보통신과" 형태
          matchValue(inlineSplit.value, index).forEach(function (d) {
            hits.push({ dept: d, at: '셀 내부', row: r, col: c });
          });
          continue;
        }
        if (!isFieldLabel(text)) continue;
        // 오른쪽 인접 셀
        for (var rc = c + 1; rc < Math.min(row.length, c + 4); rc++) {
          if (T.isBlank(row[rc])) continue;
          matchValue(row[rc], index).forEach(function (d) {
            hits.push({ dept: d, at: '오른쪽 셀', row: r, col: rc });
          });
          break;
        }
        // 아래쪽 셀 (표 헤더형)
        for (var dr = r + 1; dr < Math.min(grid.length, r + 1 + scanDown); dr++) {
          var v = (grid[dr] || [])[c];
          if (T.isBlank(v)) continue;
          matchValue(v, index).forEach(function (d) {
            hits.push({ dept: d, at: '아래쪽 셀', row: dr, col: c });
          });
        }
      }
    }
    return hits;
  }

  /** "부서명 : 정보통신과" / "담당부서 정보통신과" 를 라벨과 값으로 분리 */
  function splitLabelValue(line) {
    var text = T.normalizeText(line);
    if (!text) return null;
    var m = /^([^:：]{1,20})[:：]\s*(.+)$/.exec(text);
    if (m && isFieldLabel(m[1])) return { label: T.normalizeText(m[1]), value: T.normalizeText(m[2]) };
    // 구분자 없이 "담당부서 정보통신과"
    var m2 = /^(\S{2,10})\s+(.+)$/.exec(text);
    if (m2 && isFieldLabel(m2[1])) return { label: T.normalizeText(m2[1]), value: T.normalizeText(m2[2]) };
    return null;
  }

  /** 2순위: 문서 내부 대표 필드 */
  function detectFromFields(doc, index, options) {
    var hits = [];
    (doc.paragraphs || []).forEach(function (line, i) {
      var sp = splitLabelValue(line);
      if (!sp) return;
      matchValue(sp.value, index).forEach(function (d) {
        hits.push({ dept: d, at: '본문 ' + (i + 1) + '번째 줄' });
      });
    });
    (doc.sections || []).forEach(function (sec) {
      if (!sec.textGrid) return;
      collectGridFieldHits(sec.textGrid, index, options).forEach(function (h) {
        h.section = sec.label;
        hits.push(h);
      });
    });
    var depts = [];
    var seen = Object.create(null);
    hits.forEach(function (h) {
      if (seen[h.dept]) return;
      seen[h.dept] = true;
      depts.push(h.dept);
    });
    if (depts.length === 1) return result(depts[0], METHOD.FIELD, STATUS.CONFIRMED, { matchedTerm: depts[0] });
    if (depts.length > 1) {
      return result(null, METHOD.FIELD, STATUS.SELECT, {
        candidates: depts,
        note: '문서 안의 부서 항목에서 여러 부서명이 발견되었습니다.',
      });
    }
    return null;
  }

  /** 3순위: 문서 상단 영역의 공식 부서명 */
  function detectFromTopArea(doc, index, options) {
    var topRows = (options && options.topAreaRows) || 15;
    var chunks = [];
    (doc.paragraphs || []).slice(0, 30).forEach(function (p) {
      chunks.push(p);
    });
    (doc.sections || []).forEach(function (sec, si) {
      if (!sec.textGrid) return;
      var limit = sec.kind === 'sheet' ? topRows : sec.textGrid.length;
      if (sec.kind !== 'sheet' && si > 0) return; // 문서형은 첫 번째 표까지만
      for (var r = 0; r < Math.min(sec.textGrid.length, limit); r++) {
        (sec.textGrid[r] || []).forEach(function (v) {
          if (!T.isBlank(v)) chunks.push(String(v));
        });
      }
    });
    var text = chunks.join('  ');
    var hits = findTerms(text, index, { namesOnly: true });
    var depts = distinctDepts(hits);
    if (depts.length === 1) {
      return result(depts[0], METHOD.TOP, STATUS.REVIEW, {
        matchedTerm: depts[0],
        note: '문서 상단에서 부서명을 찾았습니다. 확인을 권장합니다.',
      });
    }
    if (depts.length > 1) {
      return result(null, METHOD.TOP, STATUS.SELECT, {
        candidates: depts,
        note: '문서 상단에서 여러 부서명이 발견되어 자동으로 확정하지 않았습니다.',
      });
    }
    return null;
  }

  /** 전체 판별 (우선순위 적용) */
  function detectDepartment(doc, fileName, index, options) {
    var byName = detectFromFileName(fileName, index);
    if (byName && byName.department) return byName;

    var byField = detectFromFields(doc, index, options);
    if (byField && byField.department) return byField;

    var byTop = detectFromTopArea(doc, index, options);
    if (byTop && byTop.department) return byTop;

    var failed = byName || byField || byTop;
    if (failed) return failed;
    return result(null, METHOD.NONE, STATUS.SELECT, {
      note: '부서를 자동으로 확인할 수 없습니다. 부서를 직접 선택해 주세요.',
    });
  }

  CJ.detector = {
    METHOD: METHOD,
    STATUS: STATUS,
    STATUS_LABEL: STATUS_LABEL,
    FIELD_LABELS: FIELD_LABELS,
    buildIndex: buildIndex,
    findTerms: findTerms,
    isFieldLabel: isFieldLabel,
    splitLabelValue: splitLabelValue,
    matchValue: matchValue,
    detectFromFileName: detectFromFileName,
    detectFromFields: detectFromFields,
    detectFromTopArea: detectFromTopArea,
    detectDepartment: detectDepartment,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
