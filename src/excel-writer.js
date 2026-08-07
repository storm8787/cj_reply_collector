/*
 * 결과 엑셀(XLSX) 생성.
 * 통합자료 / 회신현황 / 파일별처리결과 / 오류및경고 4개 시트를 만든다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  function lib() {
    return global.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
  }

  function colWidths(aoa, max) {
    var widths = [];
    var limit = Math.min(aoa.length, 300);
    for (var r = 0; r < limit; r++) {
      var row = aoa[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c] == null ? '' : String(row[c]);
        var len = 0;
        for (var i = 0; i < v.length; i++) len += v.charCodeAt(i) > 127 ? 2 : 1;
        widths[c] = Math.max(widths[c] || 6, Math.min(len + 2, max || 50));
      }
    }
    return widths.map(function (w) {
      return { wch: w };
    });
  }

  function addSheet(XLSXRef, wb, name, aoa) {
    var ws = XLSXRef.utils.aoa_to_sheet(aoa);
    ws['!cols'] = colWidths(aoa, 60);
    if (aoa.length > 1) ws['!autofilter'] = { ref: XLSXRef.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: Math.max(0, (aoa[0] || []).length - 1) } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSXRef.utils.book_append_sheet(wb, ws, name);
    return ws;
  }

  /** 회신현황 시트 데이터 */
  function statusRows(status) {
    var aoa = [['순서', '부서명', '사용여부', '회신여부', '파일수', '취합건수']];
    status.rows.forEach(function (r) {
      aoa.push([r.order, r.name, r.enabled ? '사용' : '미사용', r.replied ? '회신' : '미회신', r.fileCount, r.rowCount]);
    });
    if (status.unknownFileCount) {
      aoa.push(['', CJ.aggregate.UNKNOWN_DEPT, '-', '-', status.unknownFileCount, status.unknownRowCount]);
    }
    return aoa;
  }

  /** 파일별처리결과 시트 데이터 */
  function fileRows(files, countByFile) {
    var aoa = [['파일명', '판별부서', '판별방법', '사용여부', '선택 데이터표', '취합건수', '상태']];
    (files || []).forEach(function (f) {
      var table = CJ.analyzer.selectedTable(f);
      var dept = CJ.analyzer.finalDepartment(f);
      var statusLabel = CJ.detector.STATUS_LABEL[CJ.analyzer.finalStatus(f)] || '';
      if (f.support && f.support !== 'supported' && f.support !== 'partial') {
        statusLabel = CJ.analyzer.SUPPORT_LABEL[f.support] || statusLabel;
      }
      aoa.push([
        f.fileName,
        dept || CJ.aggregate.UNKNOWN_DEPT,
        CJ.analyzer.finalMethod(f),
        f.include ? '취합' : '제외',
        table ? table.label : '-',
        (countByFile && countByFile[f.id]) || 0,
        statusLabel.replace(/^[^\s]+\s/, ''),
      ]);
    });
    return aoa;
  }

  /** 오류및경고 시트 데이터 */
  function issueRows(files, warnings) {
    var aoa = [['파일명', '구분', '내용']];
    (files || []).forEach(function (f) {
      (f.errors || []).forEach(function (e) {
        if (!e || !e.message) return;
        aoa.push([f.fileName, e.type, e.message]);
      });
    });
    (warnings || []).forEach(function (w) {
      aoa.push([w.file ? w.file.fileName : '', w.type, w.message]);
    });
    if (aoa.length === 1) aoa.push(['-', '-', '확인된 오류나 경고가 없습니다.']);
    return aoa;
  }

  function buildWorkbook(ctx) {
    var XLSXRef = lib();
    if (!XLSXRef) throw new Error('엑셀 생성 기능을 사용할 수 없습니다.');
    var wb = XLSXRef.utils.book_new();
    var merged = [ctx.result.headers].concat(ctx.result.rows);
    if (merged.length === 1) merged.push(new Array(ctx.result.headers.length).fill(''));
    addSheet(XLSXRef, wb, '통합자료', merged);
    addSheet(XLSXRef, wb, '회신현황', statusRows(ctx.status));
    addSheet(XLSXRef, wb, '파일별처리결과', fileRows(ctx.files, ctx.result.countByFile));
    addSheet(XLSXRef, wb, '오류및경고', issueRows(ctx.files, ctx.result.warnings));
    return wb;
  }

  function defaultFileName(date) {
    return '부서회신자료_통합결과_' + T.todayStamp(date) + '.xlsx';
  }

  function toBlob(wb) {
    var XLSXRef = lib();
    var out = XLSXRef.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function download(wb, fileName) {
    var blob = toBlob(wb);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName || defaultFileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  CJ.writer = {
    buildWorkbook: buildWorkbook,
    defaultFileName: defaultFileName,
    statusRows: statusRows,
    fileRows: fileRows,
    issueRows: issueRows,
    toBlob: toBlob,
    download: download,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
