/*
 * 파일 1개를 분석한다: 형식 판별 → 읽기 → 부서 판별 → 데이터표 탐지.
 * 한 파일에서 오류가 나도 다른 파일 처리는 계속된다(호출 측에서 파일 단위로 호출).
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var EXCEL_EXT = { xlsx: 1, xlsm: 1, xls: 1, xlsb: 0, csv: 1 };
  var KNOWN_UNSUPPORTED = {
    pdf: 'PDF 파일은 취합할 수 없습니다.',
    docx: '워드 파일은 취합할 수 없습니다.',
    doc: '워드 파일은 취합할 수 없습니다.',
    pptx: '파워포인트 파일은 취합할 수 없습니다.',
    zip: '압축 파일은 취합할 수 없습니다. 압축을 풀고 개별 파일을 올려 주세요.',
    jpg: '이미지 파일은 취합할 수 없습니다.',
    png: '이미지 파일은 취합할 수 없습니다.',
    hwt: '한글 서식 파일(hwt)은 취합할 수 없습니다.',
  };

  var SUPPORT_LABEL = {
    supported: '지원',
    partial: '일부 지원',
    unknown: '확인 필요',
    unsupported: '지원하지 않는 형식',
    encrypted: '암호화 문서',
    corrupt: '손상된 문서',
    empty: '빈 파일',
  };

  function kindOf(ext) {
    if (EXCEL_EXT[ext]) return 'excel';
    if (ext === 'hwpx') return 'hwpx';
    if (ext === 'hwp') return 'hwp';
    return 'unknown';
  }

  function emptyDoc(support, message) {
    return { support: support, message: message, sections: [], paragraphs: [] };
  }

  function readDocument(fileName, data) {
    var ext = T.fileExtension(fileName);
    var kind = kindOf(ext);
    if (kind === 'excel') return CJ.excel.read(data, fileName);
    if (kind === 'hwpx') return CJ.hwpx.read(data, fileName);
    if (kind === 'hwp') return CJ.hwp.read(data, fileName);
    if (KNOWN_UNSUPPORTED[ext]) return Promise.resolve(emptyDoc('unsupported', KNOWN_UNSUPPORTED[ext]));
    return Promise.resolve(
      emptyDoc('unsupported', '지원하지 않는 파일 형식입니다. (엑셀, CSV, 한글 파일만 취합할 수 있습니다.)')
    );
  }

  /**
   * @param file {name, data}
   * @param ctx  {index, options}
   */
  function analyzeFile(file, ctx) {
    var ext = T.fileExtension(file.name);
    var base = {
      id: file.id || file.name,
      fileName: file.name,
      ext: ext,
      kind: kindOf(ext),
      include: true,
      userDepartment: null,
      tables: [],
      selectedTableId: null,
      manualMapping: null,
      errors: [],
    };
    return readDocument(file.name, file.data)
      .catch(function () {
        return emptyDoc('corrupt', '파일을 읽는 중 문제가 발생했습니다.');
      })
      .then(function (doc) {
        base.doc = doc;
        base.support = doc.support;
        base.supportLabel = SUPPORT_LABEL[doc.support] || SUPPORT_LABEL.unknown;
        base.message = doc.message || '';

        if (doc.support === 'unsupported' || doc.support === 'encrypted' || doc.support === 'corrupt' || doc.support === 'empty') {
          base.errors.push({ type: '형식', message: doc.message });
          base.detection = {
            department: null,
            method: CJ.detector.METHOD.NONE,
            status: CJ.detector.STATUS.SELECT,
            note: doc.message,
            candidates: [],
          };
          base.include = false;
          return base;
        }

        base.detection = CJ.detector.detectDepartment(doc, file.name, ctx.index, ctx.options);
        if (!base.detection.department) {
          base.errors.push({
            type: '부서',
            message: base.detection.note || '부서를 자동으로 확인할 수 없습니다. 부서를 직접 선택해 주세요.',
          });
        } else if (base.detection.status === CJ.detector.STATUS.REVIEW) {
          base.errors.push({
            type: '부서',
            message: '문서 상단에서 부서명을 찾았습니다. 판별 결과를 확인해 주세요.',
          });
        }

        base.tables = CJ.tableDetector.detectTables(doc, ctx.options);
        if (!base.tables.length) {
          base.errors.push({ type: '자료', message: '이 파일에서 취합할 표를 찾지 못했습니다.' });
        } else {
          base.selectedTableId = base.tables[0].id;
        }
        if (doc.message) base.errors.push({ type: '형식', message: doc.message });
        return base;
      });
  }

  function selectedTable(fileResult) {
    if (!fileResult || !fileResult.tables || !fileResult.tables.length) return null;
    var id = fileResult.selectedTableId;
    var found = fileResult.tables.filter(function (t) {
      return t.id === id;
    })[0];
    return found || fileResult.tables[0];
  }

  function finalDepartment(fileResult) {
    if (fileResult.userDepartment) return fileResult.userDepartment;
    return (fileResult.detection && fileResult.detection.department) || null;
  }

  function finalMethod(fileResult) {
    if (fileResult.userDepartment) return CJ.detector.METHOD.MANUAL;
    return (fileResult.detection && fileResult.detection.method) || CJ.detector.METHOD.NONE;
  }

  function finalStatus(fileResult) {
    if (fileResult.userDepartment) return CJ.detector.STATUS.CONFIRMED;
    if (!fileResult.detection || !fileResult.detection.department) return CJ.detector.STATUS.SELECT;
    return fileResult.detection.status;
  }

  CJ.analyzer = {
    analyzeFile: analyzeFile,
    readDocument: readDocument,
    selectedTable: selectedTable,
    finalDepartment: finalDepartment,
    finalMethod: finalMethod,
    finalStatus: finalStatus,
    SUPPORT_LABEL: SUPPORT_LABEL,
    kindOf: kindOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
