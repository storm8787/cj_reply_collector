/*
 * 취합 결과물 생성.
 *
 * 결과는 두 가지로 나눈다.
 *   1) 회신현황 리포트 (항상 엑셀)  - 회신현황·파일별처리결과·오류및경고 + 표로 읽어낸 통합자료
 *   2) 온전한 취합본 (자료 종류별)
 *        엑셀·CSV 회신자료  → 위 엑셀의 '통합자료' 시트
 *        한글 회신자료      → HWPX 취합본 + 원본 한글파일 ZIP
 *        PDF 회신자료       → 원본 쪽을 부서순서대로 이어붙인 PDF
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var GROUP = { EXCEL: 'excel', HWP: 'hwp', PDF: 'pdf' };

  function groupOf(file) {
    var ext = (file.ext || T.fileExtension(file.fileName || '')).toLowerCase();
    if (ext === 'hwp' || ext === 'hwpx') return GROUP.HWP;
    if (ext === 'pdf') return GROUP.PDF;
    return GROUP.EXCEL;
  }

  /** 취합 대상 파일을 부서순서 → 업로드순서로 정렬 */
  function sortByDepartment(files, departments) {
    var orderMap = Object.create(null);
    (departments || []).forEach(function (d) {
      orderMap[T.squeeze(d.name)] = d.order;
    });
    return (files || [])
      .map(function (f, i) {
        var dept = CJ.analyzer.finalDepartment(f);
        var key = dept ? orderMap[T.squeeze(dept)] : undefined;
        return {
          file: f,
          department: dept || CJ.aggregate.UNKNOWN_DEPT,
          order: key === undefined ? Number.MAX_SAFE_INTEGER : key,
          uploadIndex: typeof f.uploadIndex === 'number' ? f.uploadIndex : i,
        };
      })
      .sort(function (a, b) {
        if (a.order !== b.order) return a.order - b.order;
        return a.uploadIndex - b.uploadIndex;
      });
  }

  /** 어떤 결과물을 만들 수 있는지 미리 확인 */
  function plan(files, departments) {
    var usable = (files || []).filter(function (f) {
      return f.include && f.analyzedOnce !== false && f.support && ['supported', 'partial'].indexOf(f.support) >= 0;
    });
    var byGroup = { excel: [], hwp: [], pdf: [] };
    usable.forEach(function (f) {
      byGroup[groupOf(f)].push(f);
    });
    return {
      excel: sortByDepartment(byGroup.excel, departments),
      hwp: sortByDepartment(byGroup.hwp, departments),
      pdf: sortByDepartment(byGroup.pdf, departments),
      hasHwp: byGroup.hwp.length > 0,
      hasPdf: byGroup.pdf.length > 0,
    };
  }

  function safeName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_');
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /**
   * 한글 취합본(HWPX) - 부서순서대로, 원본 서식을 살려서 합친다.
   * hwpx 원본은 서식까지, hwp(바이너리) 원본은 내용만 옮겨진다.
   */
  function buildHwpx(entries, readBytes, opts) {
    var options = opts || {};
    var chain = Promise.resolve();
    var sources = [];
    entries.forEach(function (e) {
      chain = chain.then(function () {
        var doc = e.file.doc || {};
        var common = {
          department: e.department,
          fileName: e.file.fileName,
          paragraphs: (doc.paragraphs || []).slice(),
          tables: (doc.sections || [])
            .filter(function (s) {
              return s.textGrid && s.textGrid.length;
            })
            .map(function (s) {
              return s.textGrid;
            }),
        };
        if (e.file.ext !== 'hwpx') {
          sources.push(Object.assign({ kind: 'hwp' }, common));
          return null;
        }
        return readBytes(e.file)
          .then(function (bytes) {
            sources.push(Object.assign({ kind: 'hwpx', bytes: bytes }, common));
          })
          .catch(function () {
            sources.push(Object.assign({ kind: 'hwp' }, common));
          });
      });
    });
    return chain.then(function () {
      var hasHwpx = sources.some(function (s) {
        return s.kind === 'hwpx' && s.bytes;
      });
      if (hasHwpx) {
        // 첫 hwpx 를 바탕으로 원본 서식을 그대로 살려 합친다
        return CJ.hwpxMerger.merge(sources, { zipType: options.zipType });
      }
      // hwpx 원본이 하나도 없으면(구형 hwp 만) 내용만 담아 새로 만든다
      return CJ.hwpxWriter.buildPlainDocument(sources, {
        title: options.title,
        zipType: options.zipType,
      });
    });
  }

  /** 원본 한글파일 ZIP - 부서순서대로 번호를 붙여 담는다 */
  function buildOriginalZip(entries, readBytes, zipType) {
    var JSZipRef = global.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!JSZipRef) return Promise.reject(new Error('원본 묶음을 만드는 기능을 사용할 수 없습니다.'));
    var zip = new JSZipRef();
    var chain = Promise.resolve();
    var listing = [];
    entries.forEach(function (e, i) {
      chain = chain.then(function () {
        return readBytes(e.file).then(function (bytes) {
          var name = pad(i + 1, 2) + '_' + safeName(e.department) + '_' + safeName(e.file.fileName);
          zip.file(name, bytes);
          listing.push(e.department + '\t' + e.file.fileName + '\t' + name);
        });
      });
    });
    return chain.then(function () {
      zip.file(
        '00_취합순서.txt',
        ['부서명\t원본파일명\t묶음안의이름'].concat(listing).join('\r\n')
      );
      return zip.generateAsync({ type: zipType || 'blob', compression: 'DEFLATE' });
    });
  }

  /** PDF 취합본 - 원본 쪽을 부서순서대로 이어붙인다 */
  function buildMergedPdf(entries, readBytes) {
    var PDFLibRef = global.PDFLib || (typeof PDFLib !== 'undefined' ? PDFLib : null);
    if (!PDFLibRef) return Promise.reject(new Error('PDF 취합본을 만드는 기능을 사용할 수 없습니다.'));
    var pageMap = [];
    return PDFLibRef.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      var cursor = 0;
      entries.forEach(function (e) {
        chain = chain.then(function () {
          return readBytes(e.file)
            .then(function (bytes) {
              return PDFLibRef.PDFDocument.load(bytes, { ignoreEncryption: true });
            })
            .then(function (src) {
              var indices = src.getPageIndices();
              return out.copyPages(src, indices).then(function (pages) {
                pages.forEach(function (p) {
                  out.addPage(p);
                });
                pageMap.push({
                  department: e.department,
                  fileName: e.file.fileName,
                  from: cursor + 1,
                  to: cursor + pages.length,
                  count: pages.length,
                });
                cursor += pages.length;
              });
            })
            .catch(function () {
              pageMap.push({
                department: e.department,
                fileName: e.file.fileName,
                from: 0,
                to: 0,
                count: 0,
                failed: true,
              });
            });
        });
      });
      return chain.then(function () {
        return out.save().then(function (bytes) {
          return { bytes: bytes, pageMap: pageMap };
        });
      });
    });
  }

  function stamp(date) {
    return T.todayStamp(date);
  }

  /**
   * 결과물 전체를 만든다.
   * @param ctx {result, status, files, departments, readBytes, date, zipType, blobFactory}
   * @returns Promise<{outputs:[{name, data, kind, description}], pageMap, hwpxOrder}>
   */
  function buildAll(ctx) {
    var date = ctx.date || new Date();
    var suffix = stamp(date) + '';
    var p = plan(ctx.files, ctx.departments);
    var outputs = [];
    var extras = {};
    var makeBlob =
      ctx.blobFactory ||
      function (data, type) {
        return new Blob([data], { type: type });
      };

    var chain = Promise.resolve();

    if (p.hasPdf) {
      chain = chain.then(function () {
        return buildMergedPdf(p.pdf, ctx.readBytes).then(function (res) {
          extras.pdfPageMap = res.pageMap;
          outputs.push({
            kind: 'pdf',
            name: '부서회신자료_PDF취합본_' + suffix + '.pdf',
            data: makeBlob(res.bytes, 'application/pdf'),
            description: 'PDF 회신자료 ' + p.pdf.length + '개를 부서순서대로 이어붙인 원본 취합본',
          });
        });
      });
    }

    if (p.hasHwp) {
      chain = chain
        .then(function () {
          return buildHwpx(p.hwp, ctx.readBytes, {
            title: '부서 회신자료 통합본',
            zipType: ctx.zipType,
            showHeading: ctx.showHeading,
          }).then(function (res) {
            extras.hwpxWarnings = res.warnings;
            var plainCount = (res.warnings || []).length;
            outputs.push({
              kind: 'hwpx',
              name: '부서회신자료_한글취합본_' + suffix + '.hwpx',
              data: res.blob,
              description:
                '한글 회신자료 ' + p.hwp.length + '개를 부서순서대로 합친 한글 파일 (원본 서식 유지)' +
                (plainCount ? ' — 그 중 ' + plainCount + '개는 내용만' : ''),
            });
          });
        })
        .then(function () {
          return buildOriginalZip(p.hwp, ctx.readBytes, ctx.zipType).then(function (blob) {
            outputs.push({
              kind: 'zip',
              name: '부서회신자료_한글원본_' + suffix + '.zip',
              data: blob,
              description: '원본 한글파일을 부서순서대로 번호를 붙여 담은 묶음 (서식 그대로 보존)',
            });
          });
        });
    }

    return chain.then(function () {
      extras.hwpOrder = p.hwp.map(function (e, i) {
        return { no: i + 1, department: e.department, fileName: e.file.fileName };
      });
      // 리포트 엑셀은 위에서 만든 취합순서 정보를 함께 담아야 하므로 마지막에 만든다
      var wb = CJ.writer.buildWorkbook({
        result: ctx.result,
        status: ctx.status,
        files: ctx.files,
        pdfPageMap: extras.pdfPageMap,
        hwpOrder: extras.hwpOrder,
      });
      outputs.unshift({
        kind: 'xlsx',
        name: '부서회신자료_통합결과_' + suffix + '.xlsx',
        data: ctx.workbookToData ? ctx.workbookToData(wb) : CJ.writer.toBlob(wb),
        description:
          '회신현황·파일별처리결과·오류및경고' +
          (ctx.result && ctx.result.rows.length ? ' + 표로 읽어낸 통합자료' : ''),
        workbook: wb,
      });
      return { outputs: outputs, plan: p, pdfPageMap: extras.pdfPageMap, hwpOrder: extras.hwpOrder };
    });
  }

  CJ.output = {
    GROUP: GROUP,
    groupOf: groupOf,
    plan: plan,
    sortByDepartment: sortByDepartment,
    buildAll: buildAll,
    buildHwpx: buildHwpx,
    buildMergedPdf: buildMergedPdf,
    buildOriginalZip: buildOriginalZip,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
