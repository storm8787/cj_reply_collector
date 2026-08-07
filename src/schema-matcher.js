/*
 * 공통 서식(기준 스키마) 판별과 컬럼 매칭.
 * - 정확히 같은 컬럼명, 공백/줄바꿈/유니코드 차이만 있는 컬럼명만 자동 매칭한다.
 * - 의미가 비슷하다는 이유로 임의 매핑하지 않는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  function keysOf(headers) {
    return (headers || []).map(function (h) {
      return T.headerKey(h);
    });
  }

  /** 컬럼 순서와 무관한 서식 지문 */
  function signature(headers) {
    return keysOf(headers)
      .filter(function (k) {
        return k !== '';
      })
      .slice()
      .sort()
      .join('|');
  }

  /**
   * 여러 파일의 표에서 가장 많이 쓰인 컬럼 구조를 기준 스키마로 선택한다.
   * entries: [{ id, headers }]  (업로드 순서)
   */
  function chooseBaseSchema(entries) {
    var groups = [];
    var byKey = Object.create(null);
    (entries || []).forEach(function (e, i) {
      if (!e || !e.headers || !e.headers.length) return;
      var sig = signature(e.headers);
      if (!sig) return;
      if (!byKey[sig]) {
        byKey[sig] = { signature: sig, headers: e.headers.slice(), members: [], firstIndex: i };
        groups.push(byKey[sig]);
      }
      byKey[sig].members.push(e.id);
    });
    if (!groups.length) return null;
    groups.sort(function (a, b) {
      if (b.members.length !== a.members.length) return b.members.length - a.members.length;
      if (b.headers.length !== a.headers.length) return b.headers.length - a.headers.length;
      return a.firstIndex - b.firstIndex;
    });
    var best = groups[0];
    return {
      headers: best.headers.slice(),
      signature: best.signature,
      memberCount: best.members.length,
      members: best.members.slice(),
      totalCount: entries.length,
      groups: groups.map(function (g) {
        return { signature: g.signature, headers: g.headers, count: g.members.length, members: g.members };
      }),
    };
  }

  /**
   * 파일의 컬럼을 기준 스키마에 매칭한다.
   * 반환 mapping[i] = 원본 컬럼 인덱스 또는 null(누락)
   */
  function matchToBase(fileHeaders, baseHeaders) {
    var fileKeys = keysOf(fileHeaders);
    var baseKeys = keysOf(baseHeaders);
    var used = Object.create(null);
    var mapping = baseKeys.map(function (bk) {
      if (!bk) return null;
      for (var i = 0; i < fileKeys.length; i++) {
        if (used[i]) continue;
        if (fileKeys[i] === bk) {
          used[i] = true;
          return i;
        }
      }
      return null;
    });
    var missing = [];
    mapping.forEach(function (m, i) {
      if (m === null) missing.push(baseHeaders[i]);
    });
    var extra = [];
    fileHeaders.forEach(function (h, i) {
      if (!used[i]) extra.push(h);
    });
    var orderDiffers = mapping.some(function (m, i) {
      return m !== null && m !== i;
    });
    return {
      mapping: mapping,
      missing: missing,
      extra: extra,
      exact: missing.length === 0 && extra.length === 0,
      orderDiffers: orderDiffers,
      sameSignature: signature(fileHeaders) === signature(baseHeaders),
    };
  }

  /** 사용자 수동 매핑을 반영한 최종 매핑 */
  function applyManualMapping(auto, manual) {
    if (!manual) return auto.mapping.slice();
    return auto.mapping.map(function (m, i) {
      var v = manual[i];
      if (v === undefined || v === null || v === '') return m;
      var n = Number(v);
      return isNaN(n) || n < 0 ? m : n;
    });
  }

  CJ.schema = {
    keysOf: keysOf,
    signature: signature,
    chooseBaseSchema: chooseBaseSchema,
    matchToBase: matchToBase,
    applyManualMapping: applyManualMapping,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
