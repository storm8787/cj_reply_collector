/*
 * 문자열 정규화 유틸리티.
 * 브라우저와 Node(테스트) 양쪽에서 동일하게 동작하도록 전역 CJ 네임스페이스에 등록한다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});

  /** 값이 비어있는지 (null/undefined/공백문자열) */
  function isBlank(v) {
    return v == null || String(v).replace(/[\s 　]+/g, '') === '';
  }

  /** 유니코드 정규화(NFKC). 한글 자모 분리(NFD) 파일명도 여기서 합쳐진다. */
  function nfkc(v) {
    var s = v == null ? '' : String(v);
    try {
      return s.normalize('NFKC');
    } catch (e) {
      return s;
    }
  }

  /** 줄바꿈/탭/전각공백/연속공백 정리 + 앞뒤 공백 제거 */
  function collapseSpace(v) {
    return String(v == null ? '' : v)
      .replace(/[\r\n\t 　]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /** 일반 텍스트 정규화: NFKC + 공백 정리 */
  function normalizeText(v) {
    return collapseSpace(nfkc(v));
  }

  /**
   * 컬럼명 비교용 키.
   * 공백/줄바꿈/유니코드 차이만 있는 컬럼명을 같은 값으로 만든다.
   * 의미 기반(fuzzy) 매칭은 하지 않는다.
   */
  function headerKey(v) {
    return nfkc(v)
      .replace(/[\s 　]+/g, '')
      .toLowerCase();
  }

  /** 라벨 비교용 키: headerKey + 끝의 콜론/기호 제거 */
  function labelKey(v) {
    return headerKey(v).replace(/[:：·\-_.]+$/g, '');
  }

  /**
   * 파일명 정규화: 확장자 제거 + 구분문자를 공백으로 치환.
   * 예) "[정보통신과] 제출자료.xlsx" -> "정보통신과 제출자료"
   */
  function normalizeFileName(name) {
    var base = String(name == null ? '' : name);
    base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    base = nfkc(base);
    base = base.replace(/[\[\]（）()<>{}〔〕【】「」『』_\-–—~+,;|/\\!@#$%^&*='"`]/g, ' ');
    return collapseSpace(base);
  }

  /** 확장자(소문자, 점 없음) */
  function fileExtension(name) {
    var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /** 검색용 압축 문자열: 공백까지 제거하여 "정보 통신과" 같은 표기도 잡는다. */
  function squeeze(v) {
    return nfkc(v).replace(/[\s 　]+/g, '');
  }

  /** yyyymmdd */
  function todayStamp(d) {
    var dt = d || new Date();
    var p = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return '' + dt.getFullYear() + p(dt.getMonth() + 1) + p(dt.getDate());
  }

  CJ.text = {
    isBlank: isBlank,
    nfkc: nfkc,
    collapseSpace: collapseSpace,
    normalizeText: normalizeText,
    headerKey: headerKey,
    labelKey: labelKey,
    normalizeFileName: normalizeFileName,
    fileExtension: fileExtension,
    squeeze: squeeze,
    todayStamp: todayStamp,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
