/*
 * PDF 읽기.
 * 목적은 (1) 부서명 판별을 위한 본문 텍스트 추출 (2) 쪽수 확인 이다.
 * PDF 는 표 구조를 신뢰할 수 있게 복원할 수 없으므로 데이터표를 뽑지 않고,
 * 원본 쪽을 그대로 이어붙인 PDF 취합본으로 제공한다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var TEXT_PAGE_LIMIT = 5; // 부서 판별에는 앞쪽 몇 장이면 충분하다

  function lib() {
    return (
      global.pdfjsLib ||
      global['pdfjs-dist/build/pdf'] ||
      (typeof pdfjsLib !== 'undefined' ? pdfjsLib : null)
    );
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  }

  function looksLikePdf(u8) {
    if (u8.length < 5) return false;
    // 앞부분 어딘가에 %PDF- 가 있어야 한다 (일부 파일은 앞에 잡다한 바이트가 붙는다)
    var limit = Math.min(u8.length - 4, 1024);
    for (var i = 0; i <= limit; i++) {
      if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46 && u8[i + 4] === 0x2d)
        return true;
    }
    return false;
  }

  /** 한 쪽의 텍스트를 줄 단위로 재구성한다 (y 좌표가 바뀌면 새 줄) */
  function itemsToLines(items) {
    var lines = [];
    var currentY = null;
    var buf = '';
    items.forEach(function (it) {
      var y = it.transform ? Math.round(it.transform[5]) : null;
      if (currentY === null) currentY = y;
      if (y !== null && currentY !== null && Math.abs(y - currentY) > 2) {
        if (T.collapseSpace(buf)) lines.push(T.collapseSpace(buf));
        buf = '';
        currentY = y;
      }
      buf += it.str;
      if (it.hasEOL) {
        if (T.collapseSpace(buf)) lines.push(T.collapseSpace(buf));
        buf = '';
      }
    });
    if (T.collapseSpace(buf)) lines.push(T.collapseSpace(buf));
    return lines;
  }

  /**
   * @returns Promise<doc>
   */
  function read(data, fileName) {
    var pdfjs = lib();
    if (!pdfjs) {
      return Promise.resolve({
        support: 'unsupported',
        message: 'PDF 를 읽는 기능을 사용할 수 없습니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var u8 = toU8(data);
    if (!u8.length) {
      return Promise.resolve({ support: 'empty', message: '내용이 없는 파일입니다.', sections: [], paragraphs: [] });
    }
    if (!looksLikePdf(u8)) {
      return Promise.resolve({
        support: 'corrupt',
        message: '파일을 열 수 없습니다. 손상되었거나 PDF 가 아닙니다.',
        sections: [],
        paragraphs: [],
      });
    }
    var task;
    try {
      task = pdfjs.getDocument({
        data: u8.slice(0), // pdf.js 가 버퍼를 가져가므로 사본을 넘긴다 (원본 보존)
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
      });
    } catch (e) {
      return Promise.resolve({
        support: 'corrupt',
        message: '파일을 열 수 없습니다. 손상된 PDF 입니다.',
        sections: [],
        paragraphs: [],
      });
    }
    return task.promise
      .then(function (pdf) {
        var pageCount = pdf.numPages;
        var paragraphs = [];
        var chain = Promise.resolve();
        var pages = Math.min(pageCount, TEXT_PAGE_LIMIT);
        for (var i = 1; i <= pages; i++) {
          (function (n) {
            chain = chain.then(function () {
              return pdf
                .getPage(n)
                .then(function (page) {
                  return page.getTextContent();
                })
                .then(function (tc) {
                  itemsToLines(tc.items || []).forEach(function (l) {
                    paragraphs.push(l);
                  });
                })
                .catch(function () {
                  /* 이 쪽은 건너뛴다 */
                });
            });
          })(i);
        }
        return chain.then(function () {
          try {
            pdf.destroy();
          } catch (e) {
            /* 무시 */
          }
          var hasText = paragraphs.length > 0;
          return {
            support: 'supported',
            message: hasText
              ? ''
              : 'PDF 에서 글자를 찾지 못했습니다. 그림으로만 된 문서일 수 있으니 부서를 직접 선택해 주세요.',
            sections: [], // PDF 는 데이터표를 뽑지 않는다
            paragraphs: paragraphs,
            pageCount: pageCount,
            documentOnly: true, // 표가 아니라 원본 문서 자체를 취합한다
          };
        });
      })
      .catch(function (err) {
        var msg = String((err && (err.name || err.message)) || '');
        if (/Password|password/.test(msg)) {
          return {
            support: 'encrypted',
            message: '암호화된 문서는 처리할 수 없습니다.',
            sections: [],
            paragraphs: [],
          };
        }
        return {
          support: 'corrupt',
          message: '파일을 열 수 없습니다. 손상되었거나 PDF 가 아닙니다.',
          sections: [],
          paragraphs: [],
        };
      });
  }

  CJ.pdf = { read: read, looksLikePdf: looksLikePdf, itemsToLines: itemsToLines };
})(typeof globalThis !== 'undefined' ? globalThis : this);
