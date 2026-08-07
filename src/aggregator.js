/*
 * 취합 엔진.
 * 부서 마스터의 order 기준으로 정렬하고, 같은 부서 안에서는 원본 파일 순서와 행 순서를 유지한다.
 * 헤더는 한 번만 생성하며 완전히 빈 행은 제외한다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var MANAGED_COLUMNS = ['부서명', '원본파일명', '원본시트/표'];
  var UNKNOWN_DEPT = '미확인';

  function includableFiles(files) {
    return (files || []).filter(function (f) {
      return f.include && CJ.analyzer.selectedTable(f);
    });
  }

  /** 기준 스키마(가장 많은 파일이 공통으로 쓰는 컬럼 구조) 결정 */
  function determineBaseSchema(files) {
    var entries = includableFiles(files).map(function (f) {
      var t = CJ.analyzer.selectedTable(f);
      return { id: f.id, headers: t.headers };
    });
    return CJ.schema.chooseBaseSchema(entries);
  }

  /** 파일별 컬럼 매칭 결과 */
  function buildFilePlans(files, baseHeaders) {
    return includableFiles(files).map(function (f) {
      var t = CJ.analyzer.selectedTable(f);
      var auto = CJ.schema.matchToBase(t.headers, baseHeaders);
      var mapping = CJ.schema.applyManualMapping(auto, f.manualMapping);
      var unresolved = [];
      mapping.forEach(function (m, i) {
        if (m === null) unresolved.push(baseHeaders[i]);
      });
      return { file: f, table: t, auto: auto, mapping: mapping, unresolved: unresolved };
    });
  }

  function deptOrderMap(departments) {
    var map = Object.create(null);
    (departments || []).forEach(function (d) {
      map[T.squeeze(d.name)] = d.order;
    });
    return map;
  }

  /** 동일 부서 복수 제출 탐지 */
  function findDuplicates(files) {
    var byDept = Object.create(null);
    (files || []).forEach(function (f) {
      if (!f.include) return;
      var dept = CJ.analyzer.finalDepartment(f);
      if (!dept) return;
      (byDept[dept] = byDept[dept] || []).push(f);
    });
    var out = [];
    Object.keys(byDept).forEach(function (dept) {
      if (byDept[dept].length >= 2) out.push({ department: dept, files: byDept[dept] });
    });
    return out;
  }

  /**
   * 최종 취합.
   * @returns {headers, rows, perFile, baseSchema, warnings, excluded}
   */
  function aggregate(files, departments, opts) {
    var options = opts || {};
    var baseSchema = options.baseSchema || determineBaseSchema(files);
    var baseHeaders = (baseSchema && baseSchema.headers) || [];
    var plans = buildFilePlans(files, baseHeaders);
    var orderMap = deptOrderMap(departments);
    var headers = MANAGED_COLUMNS.concat(baseHeaders);
    var warnings = [];
    var excluded = [];

    (files || []).forEach(function (f) {
      if (!f.include) {
        excluded.push({ file: f, reason: '사용자가 취합 대상에서 제외했습니다.' });
        return;
      }
      if (!CJ.analyzer.selectedTable(f)) {
        excluded.push({ file: f, reason: '이 파일에서 취합할 표를 찾지 못했습니다.' });
      }
    });

    var records = [];
    plans.forEach(function (plan, planIndex) {
      var f = plan.file;
      var dept = CJ.analyzer.finalDepartment(f);
      var deptLabel = dept || UNKNOWN_DEPT;
      var order = dept && orderMap[T.squeeze(dept)] !== undefined ? orderMap[T.squeeze(dept)] : Number.MAX_SAFE_INTEGER;
      var fileIndex = typeof f.uploadIndex === 'number' ? f.uploadIndex : planIndex;

      if (!plan.auto.sameSignature) {
        var parts = [];
        if (plan.unresolved.length) parts.push('기준 컬럼 ' + plan.unresolved.length + '개 누락');
        if (plan.auto.extra.length) parts.push('기준에 없는 컬럼 ' + plan.auto.extra.length + '개');
        warnings.push({
          file: f,
          type: '서식',
          message: '다른 부서의 회신파일과 서식이 다릅니다.' + (parts.length ? ' (' + parts.join(', ') + ')' : ''),
        });
      }

      plan.table.rows.forEach(function (row, rowIndex) {
        // 원본 기준으로 완전히 빈 행만 제외한다.
        // (컬럼을 맞추지 못해 값이 비는 경우는 자료가 사라지지 않도록 그대로 남긴다.)
        var sourceBlank = row.every(function (v) {
          return T.isBlank(v);
        });
        if (sourceBlank) return;
        var values = plan.mapping.map(function (m) {
          if (m === null || m === undefined) return '';
          var v = row[m];
          return v === undefined || v === null ? '' : v;
        });
        records.push({
          order: order,
          fileIndex: fileIndex,
          rowIndex: rowIndex,
          values: [deptLabel, f.fileName, plan.table.sectionLabel].concat(values),
          department: deptLabel,
          fileId: f.id,
        });
      });
    });

    records.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
      return a.rowIndex - b.rowIndex;
    });

    var rows = records.map(function (r) {
      return r.values;
    });

    var countByFile = Object.create(null);
    records.forEach(function (r) {
      countByFile[r.fileId] = (countByFile[r.fileId] || 0) + 1;
    });

    findDuplicates(files).forEach(function (dup) {
      dup.files.forEach(function (f) {
        warnings.push({ file: f, type: '중복', message: dup.department + ' 복수 회신 (' + dup.files.length + '개 파일)' });
      });
    });

    return {
      headers: headers,
      rows: rows,
      records: records,
      baseSchema: baseSchema,
      plans: plans,
      countByFile: countByFile,
      warnings: warnings,
      excluded: excluded,
    };
  }

  /** 회신현황 (미회신 부서 포함) */
  function replyStatus(departments, files, countByFile) {
    var counts = countByFile || {};
    var byDept = Object.create(null);
    (files || []).forEach(function (f) {
      if (!f.include) return;
      var dept = CJ.analyzer.finalDepartment(f);
      if (!dept) return;
      var k = T.squeeze(dept);
      if (!byDept[k]) byDept[k] = { files: 0, rows: 0 };
      byDept[k].files += 1;
      byDept[k].rows += counts[f.id] || 0;
    });
    var rows = (departments || []).map(function (d) {
      var k = T.squeeze(d.name);
      var hit = byDept[k] || { files: 0, rows: 0 };
      return {
        order: d.order,
        name: d.name,
        enabled: d.enabled,
        replied: hit.files > 0,
        fileCount: hit.files,
        rowCount: hit.rows,
      };
    });
    var unknownFiles = (files || []).filter(function (f) {
      return f.include && !CJ.analyzer.finalDepartment(f);
    });
    return {
      rows: rows,
      repliedCount: rows.filter(function (r) {
        return r.enabled && r.replied;
      }).length,
      notRepliedCount: rows.filter(function (r) {
        return r.enabled && !r.replied;
      }).length,
      unknownFileCount: unknownFiles.length,
      unknownRowCount: unknownFiles.reduce(function (s, f) {
        return s + (counts[f.id] || 0);
      }, 0),
    };
  }

  CJ.aggregate = {
    MANAGED_COLUMNS: MANAGED_COLUMNS,
    UNKNOWN_DEPT: UNKNOWN_DEPT,
    determineBaseSchema: determineBaseSchema,
    buildFilePlans: buildFilePlans,
    findDuplicates: findDuplicates,
    aggregate: aggregate,
    replyStatus: replyStatus,
    includableFiles: includableFiles,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
