/*
 * 화면 제어 (UI). 핵심 로직은 다른 파일에 분리되어 있으며 여기서는 조립만 한다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;
  var D = CJ.detector;

  var state = {
    store: null,
    index: null,
    files: [],
    seq: 0,
    analyzing: false,
    cancel: false,
    analyzed: false,
    result: null,
    status: null,
    baseSchema: null,
    outputs: [],
  };

  function $(id) {
    return document.getElementById(id);
  }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function show(el, on) {
    if (!el) return;
    el.classList[on ? 'remove' : 'add']('hidden');
  }
  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms || 0);
    });
  }

  /* ------------------------------ 탭 ------------------------------ */
  function setTab(name) {
    ['collect', 'depts', 'help'].forEach(function (n) {
      $('tab-' + n).classList.toggle('active', n === name);
      show($('page-' + n), n === name);
    });
    if (name === 'depts') renderDeptTable();
  }

  /* --------------------------- 파일 목록 --------------------------- */
  function addFiles(list) {
    var added = 0;
    Array.prototype.forEach.call(list, function (f) {
      var dup = state.files.some(function (x) {
        return x.fileName === f.name && x.size === f.size;
      });
      if (dup) return;
      state.seq += 1;
      state.files.push({
        id: 'f' + state.seq,
        fileName: f.name,
        size: f.size,
        blob: f,
        uploadIndex: state.files.length,
        include: true,
        errors: [],
        tables: [],
        userDepartment: null,
        analyzedOnce: false,
      });
      added++;
    });
    state.analyzed = false;
    resetResults();
    updateFileCount();
    renderFileTable();
    show($('step-files'), state.files.length > 0);
    return added;
  }

  function updateFileCount() {
    var n = state.files.length;
    $('file-count').textContent = n ? '선택한 파일 ' + n + '개' : '선택한 파일이 없습니다.';
    $('btn-analyze').disabled = n === 0 || state.analyzing;
  }

  function resetResults() {
    state.result = null;
    state.status = null;
    state.baseSchema = null;
    state.outputs = [];
    if ($('download-list')) $('download-list').innerHTML = '';
    if ($('download-status')) $('download-status').textContent = '';
    show($('btn-download-all'), false);
    show($('step-preview'), false);
    show($('step-download'), false);
  }

  function resetAll() {
    state.files = [];
    state.analyzed = false;
    resetResults();
    show($('step-files'), false);
    show($('step-summary'), false);
    show($('step-schema'), false);
    $('file-input').value = '';
    updateFileCount();
    renderFileTable();
  }

  function readArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        reject(new Error('read-failed'));
      };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* ---------------------------- 분석 ---------------------------- */
  function analyze() {
    if (state.analyzing || !state.files.length) return Promise.resolve();
    state.analyzing = true;
    state.cancel = false;
    state.index = D.buildIndex(state.store.departments);
    show($('progress'), true);
    show($('btn-cancel'), true);
    $('btn-analyze').disabled = true;
    resetResults();

    var total = state.files.length;
    var done = 0;
    var chain = Promise.resolve();

    state.files.forEach(function (f, i) {
      chain = chain.then(function () {
        if (state.cancel) return null;
        setProgress(done, total, f.fileName);
        return readArrayBuffer(f.blob)
          .then(function (buf) {
            return CJ.analyzer.analyzeFile(
              { id: f.id, name: f.fileName, data: buf },
              { index: state.index, options: state.store.options }
            );
          })
          .catch(function () {
            return {
              id: f.id,
              fileName: f.fileName,
              support: 'corrupt',
              supportLabel: '손상된 문서',
              message: '파일을 읽는 중 문제가 발생했습니다.',
              errors: [{ type: '형식', message: '파일을 읽는 중 문제가 발생했습니다.' }],
              tables: [],
              detection: { department: null, method: D.METHOD.NONE, status: D.STATUS.SELECT, note: '', candidates: [] },
              include: false,
            };
          })
          .then(function (res) {
            Object.keys(res).forEach(function (k) {
              if (k === 'uploadIndex' || k === 'blob' || k === 'size') return;
              f[k] = res[k];
            });
            f.analyzedOnce = true;
            f.blobRetained = true;
            done++;
            setProgress(done, total, f.fileName);
            return sleep(0);
          });
      });
    });

    return chain.then(function () {
      state.analyzing = false;
      state.analyzed = true;
      show($('btn-cancel'), false);
      show($('progress'), false);
      $('btn-analyze').disabled = false;
      renderAfterAnalyze();
    });
  }

  function setProgress(done, total, name) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    $('progress-fill').style.width = pct + '%';
    $('progress-text').textContent = '분석 중... ' + done + ' / ' + total + ' 파일' + (name ? ' (' + name + ')' : '');
  }

  function renderAfterAnalyze() {
    markDuplicates();
    state.baseSchema = CJ.aggregate.determineBaseSchema(state.files);
    renderSummary();
    renderFileTable();
    renderSchema();
    show($('step-summary'), true);
    show($('step-files'), true);
    show($('step-schema'), true);
  }

  function markDuplicates() {
    state.files.forEach(function (f) {
      f.duplicate = false;
    });
    CJ.aggregate.findDuplicates(state.files).forEach(function (d) {
      d.files.forEach(function (f) {
        f.duplicate = true;
        f.duplicateOf = d.department;
      });
    });
  }

  /* --------------------------- 요약 카드 --------------------------- */
  function renderSummary() {
    var files = state.files;
    var analyzed = files.filter(function (f) {
      return f.analyzedOnce;
    });
    var auto = analyzed.filter(function (f) {
      return f.detection && f.detection.department && f.detection.status === D.STATUS.CONFIRMED;
    }).length;
    var review = analyzed.filter(function (f) {
      return f.detection && f.detection.department && f.detection.status === D.STATUS.REVIEW;
    }).length;
    var unknown = analyzed.filter(function (f) {
      return !CJ.analyzer.finalDepartment(f);
    }).length;
    var status = CJ.aggregate.replyStatus(state.store.departments, files, {});
    var rowTotal = files.reduce(function (s, f) {
      var t = CJ.analyzer.selectedTable(f);
      return s + (f.include && t ? t.rowCount : 0);
    }, 0);
    var docPages = files.reduce(function (s, f) {
      return s + (f.include && f.documentOnly ? f.pageCount || 0 : 0);
    }, 0);

    var cards = [
      { label: '업로드 파일', value: files.length + '개' },
      { label: '자동 부서판별', value: auto + '개', cls: 'ok' },
      { label: '확인 권장', value: review + '개', cls: review ? 'warn' : '' },
      { label: '미확인', value: unknown + '개', cls: unknown ? 'bad' : '' },
      { label: '회신 부서', value: status.repliedCount + '개' },
      { label: '미회신 부서', value: status.notRepliedCount + '개', cls: status.notRepliedCount ? 'warn' : '' },
      { label: '취합 예정 데이터', value: rowTotal + '건' },
    ];
    if (docPages) cards.push({ label: '원본 취합 쪽수', value: docPages + '쪽' });
    $('summary-cards').innerHTML = cards
      .map(function (c) {
        return (
          '<div class="card ' + (c.cls || '') + '"><div class="label">' + esc(c.label) + '</div>' +
          '<div class="value">' + esc(c.value) + '</div></div>'
        );
      })
      .join('');
  }

  /* --------------------------- 파일 표 --------------------------- */
  function deptOptions(selected) {
    var opts = ['<option value="">(선택 안 함)</option>'];
    state.store.departments.forEach(function (d) {
      if (!d.enabled && d.name !== selected) return;
      opts.push(
        '<option value="' + esc(d.name) + '"' + (d.name === selected ? ' selected' : '') + '>' +
          esc(d.order + '. ' + d.name) +
          '</option>'
      );
    });
    return opts.join('');
  }

  function statusCell(f) {
    if (!f.analyzedOnce) return '<span class="note">분석 대기</span>';
    if (f.support && ['unsupported', 'encrypted', 'corrupt', 'empty'].indexOf(f.support) >= 0) {
      return '<span class="status-bad">' + esc(CJ.analyzer.SUPPORT_LABEL[f.support]) + '</span>';
    }
    var st = CJ.analyzer.finalStatus(f);
    var cls = st === D.STATUS.CONFIRMED ? 'status-ok' : st === D.STATUS.REVIEW ? 'status-warn' : 'status-bad';
    return '<span class="' + cls + '">' + esc(D.STATUS_LABEL[st]) + '</span>';
  }

  function renderFileTable() {
    var t = $('file-table');
    if (!state.files.length) {
      t.innerHTML = '';
      return;
    }
    var head =
      '<thead><tr><th>사용</th><th>파일명</th><th>판별부서</th><th>판별방법</th><th>상태</th>' +
      '<th>데이터표</th><th class="num">행수</th><th>안내</th></tr></thead>';
    var body = state.files
      .map(function (f, i) {
        var table = CJ.analyzer.selectedTable(f);
        var dept = CJ.analyzer.finalDepartment(f);
        var notes = [];
        (f.errors || []).forEach(function (e) {
          notes.push(e.message);
        });
        if (f.duplicate) notes.push('⚠ 동일 부서 ' + f.duplicateOf + ' 복수 회신');
        var rowCls = '';
        if (f.analyzedOnce) {
          var st = CJ.analyzer.finalStatus(f);
          if (st === D.STATUS.SELECT) rowCls = 'row-bad';
          else if (st === D.STATUS.REVIEW || f.duplicate) rowCls = 'row-warn';
        }
        var tableSel = table
          ? '<select data-table="' + i + '">' +
            f.tables
              .map(function (tb) {
                return (
                  '<option value="' + esc(tb.id) + '"' + (tb.id === table.id ? ' selected' : '') + '>' +
                  esc(tb.label) + '</option>'
                );
              })
              .join('') +
            '</select>'
          : f.documentOnly
          ? '<span class="note">원본 문서 전체</span>'
          : '<span class="note">없음</span>';
        var amount = table ? table.rowCount : f.documentOnly ? (f.pageCount || 0) + '쪽' : 0;
        return (
          '<tr class="' + rowCls + '">' +
          '<td><input type="checkbox" data-include="' + i + '"' + (f.include ? ' checked' : '') + '></td>' +
          '<td><div class="truncate" title="' + esc(f.fileName) + '">' + esc(f.fileName) + '</div></td>' +
          '<td><select data-dept="' + i + '">' + deptOptions(dept) + '</select></td>' +
          '<td>' + esc(f.analyzedOnce ? CJ.analyzer.finalMethod(f) : '-') + '</td>' +
          '<td>' + statusCell(f) + '</td>' +
          '<td>' + tableSel + '</td>' +
          '<td class="num">' + amount + '</td>' +
          '<td><span class="note' + (rowCls === 'row-bad' ? ' bad' : rowCls ? ' warn' : '') + '">' +
          esc(notes.join(' / ')) + '</span></td>' +
          '</tr>'
        );
      })
      .join('');
    t.innerHTML = head + '<tbody>' + body + '</tbody>';

    t.querySelectorAll('[data-include]').forEach(function (el) {
      el.addEventListener('change', function () {
        state.files[+el.dataset.include].include = el.checked;
        afterFileChange();
      });
    });
    t.querySelectorAll('[data-dept]').forEach(function (el) {
      el.addEventListener('change', function () {
        var f = state.files[+el.dataset.dept];
        f.userDepartment = el.value || null;
        afterFileChange();
      });
    });
    t.querySelectorAll('[data-table]').forEach(function (el) {
      el.addEventListener('change', function () {
        var f = state.files[+el.dataset.table];
        f.selectedTableId = el.value;
        f.manualMapping = null;
        afterFileChange();
      });
    });
  }

  function afterFileChange() {
    markDuplicates();
    state.baseSchema = CJ.aggregate.determineBaseSchema(state.files);
    renderSummary();
    renderFileTable();
    renderSchema();
    resetResults();
  }

  /* --------------------------- 서식 확인 --------------------------- */
  function renderSchema() {
    var area = $('schema-info');
    var base = state.baseSchema;
    if (!base) {
      var onlyDocs = state.files.some(function (f) {
        return f.include && f.documentOnly;
      });
      area.innerHTML = onlyDocs
        ? '<div class="msg info">표로 읽을 자료가 없습니다. 원본 문서를 그대로 이어붙인 취합본만 만듭니다.</div>'
        : '<div class="msg bad">취합할 표를 찾은 파일이 없습니다. 파일이나 데이터표 선택을 확인해 주세요.</div>';
      $('mapping-area').innerHTML = '';
      renderPrecheck();
      return;
    }
    var plans = CJ.aggregate.buildFilePlans(state.files, base.headers);
    var diff = plans.filter(function (p) {
      return !p.auto.sameSignature;
    });
    area.innerHTML =
      '<div class="msg info"><b>기준 서식</b> — 전체 ' + base.totalCount + '개 중 ' + base.memberCount +
      '개 파일이 같은 컬럼 구조를 사용합니다.<br>컬럼: ' +
      base.headers.map(function (h) { return esc(h); }).join(' | ') +
      '</div>' +
      (diff.length
        ? '<div class="msg warn">서식이 다른 파일 ' + diff.length + '개가 있습니다. 아래에서 컬럼을 맞춰 주세요. ' +
          '맞추지 않은 컬럼은 빈 값으로 취합됩니다.</div>'
        : '<div class="msg info">모든 파일의 서식이 같습니다.</div>');

    $('mapping-area').innerHTML = diff
      .map(function (p) {
        var idx = state.files.indexOf(p.file);
        var opts = function (sel) {
          return (
            '<option value="">(비움)</option>' +
            p.table.headers
              .map(function (h, i) {
                return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(h) + '</option>';
              })
              .join('')
          );
        };
        return (
          '<div class="mapping-block"><h4>' + esc(p.file.fileName) + ' — 컬럼 맞추기</h4>' +
          '<div class="mapping-grid">' +
          base.headers
            .map(function (h, i) {
              return (
                '<label><span title="' + esc(h) + '">' + esc(h) + '</span>' +
                '<select data-map="' + idx + '" data-col="' + i + '">' + opts(p.mapping[i]) + '</select></label>'
              );
            })
            .join('') +
          '</div></div>'
        );
      })
      .join('');

    $('mapping-area')
      .querySelectorAll('[data-map]')
      .forEach(function (el) {
        el.addEventListener('change', function () {
          var f = state.files[+el.dataset.map];
          f.manualMapping = f.manualMapping || {};
          f.manualMapping[+el.dataset.col] = el.value === '' ? null : +el.value;
          resetResults();
          renderPrecheck();
        });
      });
    renderPrecheck();
  }

  /** 취합 실행 전 검증 안내 */
  function renderPrecheck() {
    var msgs = [];
    if (!state.files.length) msgs.push({ cls: 'bad', text: '올린 파일이 없습니다.' });
    var usable = CJ.aggregate.includableFiles(state.files);
    var docOnly = state.files.filter(function (f) {
      return f.include && f.documentOnly;
    });
    if (!usable.length && !docOnly.length) msgs.push({ cls: 'bad', text: '취합할 수 있는 파일이 없습니다.' });
    if (docOnly.length)
      msgs.push({
        cls: 'info',
        text: 'PDF ' + docOnly.length + '개는 표 대신 원본 쪽을 그대로 PDF 취합본에 넣습니다.',
      });
    var noDept = usable.filter(function (f) {
      return !CJ.analyzer.finalDepartment(f);
    });
    if (noDept.length) msgs.push({ cls: 'warn', text: '부서를 확인하지 못한 파일 ' + noDept.length + '개는 결과 맨 아래에 미확인으로 들어갑니다.' });
    var noTable = state.files.filter(function (f) {
      return f.include && f.analyzedOnce && !f.documentOnly && !CJ.analyzer.selectedTable(f);
    });
    if (noTable.length)
      msgs.push({
        cls: 'warn',
        text: '취합할 표를 찾지 못한 파일 ' + noTable.length + '개는 제외됩니다: ' +
          noTable.map(function (f) { return f.fileName; }).join(', '),
      });
    var excluded = state.files.filter(function (f) {
      return !f.include;
    });
    if (excluded.length) msgs.push({ cls: 'warn', text: '사용 체크를 해제한 파일 ' + excluded.length + '개는 취합하지 않습니다.' });
    $('precheck').innerHTML = msgs
      .map(function (m) {
        return '<div class="msg ' + m.cls + '">' + esc(m.text) + '</div>';
      })
      .join('');
    $('btn-aggregate').disabled = !usable.length && !docOnly.length;
  }

  /* ---------------------------- 취합 ---------------------------- */
  function runAggregate() {
    state.baseSchema = state.baseSchema || CJ.aggregate.determineBaseSchema(state.files);
    var result = CJ.aggregate.aggregate(state.files, state.store.departments, { baseSchema: state.baseSchema });
    var status = CJ.aggregate.replyStatus(state.store.departments, state.files, result.countByFile);
    state.result = result;
    state.status = status;
    renderPreview();
    renderReply();
    renderFileTable();
    show($('step-preview'), true);
    show($('step-download'), true);
    renderOutputPlan();
    $('step-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var PREVIEW_LIMIT = 300;

  function renderPreview() {
    var r = state.result;
    if (!r) return;
    var sel = $('preview-dept');
    var depts = [];
    r.rows.forEach(function (row) {
      if (depts.indexOf(row[0]) < 0) depts.push(row[0]);
    });
    var cur = sel.value;
    sel.innerHTML =
      '<option value="">전체</option>' +
      depts
        .map(function (d) {
          return '<option value="' + esc(d) + '"' + (d === cur ? ' selected' : '') + '>' + esc(d) + '</option>';
        })
        .join('');
    drawPreviewRows();
  }

  function drawPreviewRows() {
    var r = state.result;
    if (!r) return;
    var dept = $('preview-dept').value;
    var kw = T.squeeze($('preview-search').value).toLowerCase();
    var rows = r.rows.filter(function (row) {
      if (dept && row[0] !== dept) return false;
      if (!kw) return true;
      return row.some(function (v) {
        return T.squeeze(v).toLowerCase().indexOf(kw) >= 0;
      });
    });
    $('preview-count').textContent =
      '전체 ' + r.rows.length + '건 중 ' + rows.length + '건 표시' +
      (rows.length > PREVIEW_LIMIT ? ' (화면에는 앞 ' + PREVIEW_LIMIT + '건만 표시)' : '');
    var head = '<thead><tr>' + r.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>';
    var body = rows
      .slice(0, PREVIEW_LIMIT)
      .map(function (row) {
        return '<tr>' + row.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';
      })
      .join('');
    $('preview-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function renderReply() {
    var st = state.status;
    if (!st) return;
    var onlyMissing = $('only-missing').checked;
    var rows = st.rows.filter(function (r) {
      return onlyMissing ? r.enabled && !r.replied : true;
    });
    $('reply-count').textContent =
      '회신 ' + st.repliedCount + '개 부서 / 미회신 ' + st.notRepliedCount + '개 부서' +
      (st.unknownFileCount ? ' / 미확인 파일 ' + st.unknownFileCount + '개' : '');
    var head = '<thead><tr><th class="num">순서</th><th>부서명</th><th>사용여부</th><th>회신여부</th><th class="num">파일수</th><th class="num">취합건수</th></tr></thead>';
    var body = rows
      .map(function (r) {
        return (
          '<tr class="' + (r.enabled && !r.replied ? 'row-warn' : '') + '">' +
          '<td class="num">' + r.order + '</td><td>' + esc(r.name) + '</td>' +
          '<td>' + (r.enabled ? '사용' : '미사용') + '</td>' +
          '<td>' + (r.replied ? '<span class="status-ok">회신</span>' : '<span class="status-warn">미회신</span>') + '</td>' +
          '<td class="num">' + r.fileCount + '</td><td class="num">' + r.rowCount + '</td></tr>'
        );
      })
      .join('');
    var extra = st.unknownFileCount
      ? '<tr class="row-bad"><td class="num">-</td><td>미확인</td><td>-</td><td>-</td><td class="num">' +
        st.unknownFileCount + '</td><td class="num">' + st.unknownRowCount + '</td></tr>'
      : '';
    $('reply-table').innerHTML = head + '<tbody>' + body + (onlyMissing ? '' : extra) + '</tbody>';
  }

  /* -------------------------- 결과 파일 -------------------------- */
  function readBytesOf(file) {
    if (!file.blob) return Promise.reject(new Error('원본 파일을 찾을 수 없습니다.'));
    return readArrayBuffer(file.blob).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function buildOutputs() {
    if (!state.result) return;
    $('btn-build').disabled = true;
    $('download-status').textContent = '결과 파일을 만드는 중입니다...';
    $('download-list').innerHTML = '';
    show($('btn-download-all'), false);
    state.outputs = [];
    return CJ.output
      .buildAll({
        result: state.result,
        status: state.status,
        files: state.files,
        departments: state.store.departments,
        readBytes: readBytesOf,
      })
      .then(function (res) {
        state.outputs = res.outputs;
        renderOutputs();
        $('download-status').textContent = '결과 파일 ' + res.outputs.length + '개가 준비되었습니다.';
        show($('btn-download-all'), res.outputs.length > 1);
      })
      .catch(function () {
        $('download-status').textContent = '';
        $('download-list').innerHTML =
          '<div class="msg bad">결과 파일을 만들지 못했습니다. 취합 결과를 다시 확인해 주세요.</div>';
      })
      .then(function () {
        $('btn-build').disabled = false;
      });
  }

  var KIND_LABEL = { xlsx: '회신현황 리포트 (엑셀)', hwpx: '한글 취합본', zip: '원본 한글파일 묶음', pdf: 'PDF 취합본' };

  /** 만들어질 결과물을 미리 안내한다 */
  function renderOutputPlan() {
    var p = CJ.output.plan(state.files, state.store.departments);
    var items = ['<b>회신현황 리포트 (엑셀)</b> — 회신현황·파일별처리결과·오류및경고'];
    if (p.excel.length) {
      items.push('위 엑셀의 <b>통합자료</b> 시트 — 엑셀·CSV 회신자료 ' + p.excel.length + '개를 합친 취합본');
    }
    if (p.hasHwp) {
      items.push('<b>한글 취합본(hwpx)</b> + <b>원본 한글파일 묶음(zip)</b> — 한글 회신자료 ' + p.hwp.length + '개');
    }
    if (p.hasPdf) {
      items.push('<b>PDF 취합본</b> — PDF 회신자료 ' + p.pdf.length + '개를 부서순서대로 이어붙임');
    }
    $('download-status').textContent = '';
    $('download-list').innerHTML =
      '<div class="msg info">만들어질 파일<ul class="help" style="margin:6px 0 0">' +
      items
        .map(function (t) {
          return '<li>' + t + '</li>';
        })
        .join('') +
      '</ul></div>';
  }

  function renderOutputs() {
    var rows = state.outputs
      .map(function (o, i) {
        var size = o.data && o.data.size ? Math.max(1, Math.round(o.data.size / 1024)) + ' KB' : '';
        return (
          '<tr><td>' + esc(KIND_LABEL[o.kind] || o.kind) + '</td>' +
          '<td>' + esc(o.name) + '</td>' +
          '<td><span class="note">' + esc(o.description || '') + '</span></td>' +
          '<td class="num">' + size + '</td>' +
          '<td><button class="small" data-dl="' + i + '" type="button">내려받기</button></td></tr>'
        );
      })
      .join('');
    $('download-list').innerHTML =
      '<table class="grid"><thead><tr><th>구분</th><th>파일명</th><th>내용</th>' +
      '<th class="num">크기</th><th>받기</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (state.outputs.some(function (o) { return o.kind === 'hwpx'; })
        ? '<div class="msg warn">한글 취합본은 문단과 표의 <b>내용</b>만 옮겨 새로 만든 파일입니다. ' +
          '글꼴·색상 등 원본 서식이 필요하거나 한/글에서 열리지 않으면 함께 받은 <b>원본 한글파일 묶음</b>을 사용해 주세요.</div>'
        : '');
    $('download-list')
      .querySelectorAll('[data-dl]')
      .forEach(function (el) {
        el.addEventListener('click', function () {
          saveOutput(state.outputs[+el.dataset.dl]);
        });
      });
  }

  function saveOutput(out) {
    if (!out) return;
    var url = URL.createObjectURL(out.data);
    var a = document.createElement('a');
    a.href = url;
    a.download = out.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function saveAllOutputs() {
    (state.outputs || []).forEach(function (o, i) {
      setTimeout(function () {
        saveOutput(o);
      }, i * 400);
    });
  }

  /* -------------------------- 부서 관리 -------------------------- */
  var dragIndex = null;

  function renderDeptTable() {
    var t = $('dept-table');
    var head =
      '<thead><tr><th class="num">순서</th><th>부서명</th><th>별칭 (쉼표로 구분)</th>' +
      '<th>사용 여부</th><th>순서 변경</th><th>삭제</th></tr></thead>';
    var body = state.store.departments
      .map(function (d, i) {
        return (
          '<tr draggable="true" data-row="' + i + '" class="' + (d.enabled ? '' : 'disabled') + '">' +
          '<td class="order">' + d.order + '</td>' +
          '<td><input type="text" data-name="' + i + '" value="' + esc(d.name) + '"></td>' +
          '<td><input type="text" data-alias="' + i + '" value="' + esc((d.aliases || []).join(', ')) + '" placeholder="예: 정보통신, 정보과"></td>' +
          '<td><label><input type="checkbox" data-enabled="' + i + '"' + (d.enabled ? ' checked' : '') + '> 사용</label></td>' +
          '<td class="actions"><button class="small" data-up="' + i + '" type="button">▲</button> ' +
          '<button class="small" data-down="' + i + '" type="button">▼</button></td>' +
          '<td class="actions"><button class="small" data-del="' + i + '" type="button">삭제</button></td>' +
          '</tr>'
        );
      })
      .join('');
    t.innerHTML = head + '<tbody>' + body + '</tbody>';

    t.querySelectorAll('[data-name]').forEach(function (el) {
      el.addEventListener('change', function () {
        var i = +el.dataset.name;
        var res = state.store.rename(i, el.value);
        if (!res.ok) {
          deptMsg(res.message, 'bad');
          el.value = state.store.departments[i].name;
        } else deptMsg('');
      });
    });
    t.querySelectorAll('[data-alias]').forEach(function (el) {
      el.addEventListener('change', function () {
        var i = +el.dataset.alias;
        state.store.setAliases(
          i,
          el.value.split(',').map(function (s) {
            return s.trim();
          })
        );
        renderDeptTable();
      });
    });
    t.querySelectorAll('[data-enabled]').forEach(function (el) {
      el.addEventListener('change', function () {
        state.store.departments[+el.dataset.enabled].enabled = el.checked;
        renderDeptTable();
      });
    });
    t.querySelectorAll('[data-up]').forEach(function (el) {
      el.addEventListener('click', function () {
        var i = +el.dataset.up;
        state.store.move(i, i - 1);
        renderDeptTable();
      });
    });
    t.querySelectorAll('[data-down]').forEach(function (el) {
      el.addEventListener('click', function () {
        var i = +el.dataset.down;
        state.store.move(i, i + 1);
        renderDeptTable();
      });
    });
    t.querySelectorAll('[data-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var i = +el.dataset.del;
        if (!confirm(state.store.departments[i].name + ' 부서를 삭제할까요?')) return;
        state.store.remove(i);
        renderDeptTable();
      });
    });
    t.querySelectorAll('tr[data-row]').forEach(function (tr) {
      tr.addEventListener('dragstart', function () {
        dragIndex = +tr.dataset.row;
        tr.classList.add('dragging');
      });
      tr.addEventListener('dragend', function () {
        tr.classList.remove('dragging');
        t.querySelectorAll('tr').forEach(function (x) {
          x.classList.remove('drop-target');
        });
      });
      tr.addEventListener('dragover', function (e) {
        e.preventDefault();
        tr.classList.add('drop-target');
      });
      tr.addEventListener('dragleave', function () {
        tr.classList.remove('drop-target');
      });
      tr.addEventListener('drop', function (e) {
        e.preventDefault();
        var to = +tr.dataset.row;
        if (dragIndex !== null && dragIndex !== to) {
          state.store.move(dragIndex, to);
          renderDeptTable();
        }
        dragIndex = null;
      });
    });
  }

  function deptMsg(text, cls) {
    $('dept-msg').innerHTML = text ? '<div class="msg ' + (cls || 'info') + '">' + esc(text) + '</div>' : '';
  }

  function saveDepts() {
    var ok = state.store.save();
    deptMsg(
      ok ? '부서 설정을 저장했습니다. 다음에 실행할 때도 이 설정이 사용됩니다.' : '이 브라우저에서는 설정을 저장할 수 없습니다. 현재 창에서만 적용됩니다.',
      ok ? 'info' : 'warn'
    );
    if (state.analyzed) deptMsg((ok ? '부서 설정을 저장했습니다. ' : '') + '부서목록이 바뀌었으므로 자료 취합 화면에서 다시 분석해 주세요.', 'warn');
    state.index = D.buildIndex(state.store.departments);
    afterFileChange();
  }

  function exportDepts() {
    var blob = new Blob([state.store.toJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '부서설정_' + T.todayStamp() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function importDepts(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var res = state.store.fromJSON(String(fr.result));
      if (!res.ok) {
        deptMsg(res.errors.join(' '), 'bad');
        return;
      }
      renderDeptTable();
      deptMsg('부서 ' + res.count + '개를 불러왔습니다. 저장을 누르면 이 컴퓨터에 보관됩니다.', 'info');
    };
    fr.onerror = function () {
      deptMsg('파일을 읽지 못했습니다.', 'bad');
    };
    fr.readAsText(file, 'utf-8');
  }

  /* ---------------------------- 시작 ---------------------------- */
  function init() {
    state.store = new CJ.store.Store();
    var loaded = state.store.load();
    state.index = D.buildIndex(state.store.departments);

    $('tab-collect').addEventListener('click', function () { setTab('collect'); });
    $('tab-depts').addEventListener('click', function () { setTab('depts'); });
    $('tab-help').addEventListener('click', function () { setTab('help'); });

    var dz = $('dropzone');
    dz.addEventListener('click', function () { $('file-input').click(); });
    $('btn-pick').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      addFiles(e.target.files);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove('dragover');
      });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });

    $('btn-analyze').addEventListener('click', function () { analyze(); });
    $('btn-cancel').addEventListener('click', function () { state.cancel = true; });
    $('btn-reset').addEventListener('click', function () {
      if (state.files.length && !confirm('올린 파일과 분석 결과를 모두 지울까요? (부서 설정은 그대로 유지됩니다.)')) return;
      resetAll();
    });
    $('btn-aggregate').addEventListener('click', runAggregate);
    $('btn-build').addEventListener('click', buildOutputs);
    $('btn-download-all').addEventListener('click', saveAllOutputs);
    $('preview-dept').addEventListener('change', drawPreviewRows);
    $('preview-search').addEventListener('input', drawPreviewRows);
    $('only-missing').addEventListener('change', renderReply);

    $('btn-dept-add').addEventListener('click', function () {
      var res = state.store.add($('new-dept-name').value);
      if (!res.ok) {
        deptMsg(res.message, 'bad');
        return;
      }
      $('new-dept-name').value = '';
      deptMsg('');
      renderDeptTable();
    });
    $('btn-dept-save').addEventListener('click', saveDepts);
    $('btn-dept-reset').addEventListener('click', function () {
      if (!confirm('기본 충주시 부서목록으로 되돌릴까요? 저장된 설정이 지워집니다.')) return;
      state.store.resetToDefault();
      renderDeptTable();
      deptMsg('기본 부서목록으로 되돌렸습니다.', 'info');
    });
    $('btn-dept-export').addEventListener('click', exportDepts);
    $('btn-dept-import').addEventListener('click', function () { $('dept-import-input').click(); });
    $('dept-import-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importDepts(e.target.files[0]);
      e.target.value = '';
    });

    var src = CJ.DEPARTMENT_SOURCE || {};
    $('help-source').textContent =
      '기본 부서목록: ' + (src.title || '충주시 부서순서') + ' (' + (src.count || state.store.departments.length) + '개 부서)' +
      (loaded.loaded ? ' — 현재는 이 컴퓨터에 저장된 부서 설정을 사용 중입니다.' : '');
    if (loaded.reason) deptMsg(loaded.reason, 'warn');

    updateFileCount();
    renderDeptTable();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  CJ.app = { state: state, init: init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
