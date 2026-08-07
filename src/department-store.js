/*
 * 부서 마스터 관리 (CRUD / 정렬 / localStorage 저장 / JSON 가져오기·내보내기).
 * 저장 대상은 부서 설정과 프로그램 설정뿐이며, 업로드한 자료의 내용은 저장하지 않는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var STORAGE_KEY = 'cj_reply_collector.settings.v1';
  var SETTINGS_VERSION = 1;

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function defaultDepartments() {
    return clone(CJ.DEFAULT_DEPARTMENTS || []);
  }

  function defaultOptions() {
    return {
      scanRows: 30, // 대표 필드 탐색 상단 행 수
      scanCols: 12, // 대표 필드 탐색 좌측 열 수
      topAreaRows: 15, // 문서 상단 부서명 검색 행 수
      keepDisabledInReport: true,
    };
  }

  /**
   * 부서 목록 정규화.
   * - 부서명 공백 정리, 빈 이름 제거, 중복 이름 제거
   * - order 를 배열 순서대로 1..n 으로 재부여
   * - sortByOrder=true 이면 먼저 order 값 기준으로 정렬한다(JSON 가져오기용)
   */
  function normalizeDepartments(list, sortByOrder) {
    var out = [];
    var seen = Object.create(null);
    var src = (list || []).slice();
    if (sortByOrder) {
      src.forEach(function (d, i) {
        if (d) d._idx = i;
      });
      src.sort(function (a, b) {
        var ao = typeof a.order === 'number' ? a.order : a._idx;
        var bo = typeof b.order === 'number' ? b.order : b._idx;
        if (ao !== bo) return ao - bo;
        return a._idx - b._idx;
      });
    }
    src.forEach(function (d) {
      if (!d) return;
      var name = T.normalizeText(d.name);
      if (!name) return;
      var key = T.squeeze(name);
      if (seen[key]) return;
      seen[key] = true;
      var aliases = [];
      var aseen = Object.create(null);
      (d.aliases || []).forEach(function (a) {
        var v = T.normalizeText(a);
        if (!v) return;
        var k = T.squeeze(v);
        if (k === key || aseen[k]) return;
        aseen[k] = true;
        aliases.push(v);
      });
      out.push({
        order: out.length + 1,
        name: name,
        bureau: T.normalizeText(d.bureau || ''),
        aliases: aliases,
        enabled: d.enabled === undefined ? true : !!d.enabled,
      });
    });
    return out;
  }

  function validateSettings(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') {
      errors.push('설정 파일 형식이 올바르지 않습니다.');
      return { ok: false, errors: errors, departments: [], options: defaultOptions() };
    }
    var list = Array.isArray(obj) ? obj : obj.departments;
    if (!Array.isArray(list)) {
      errors.push('부서 목록을 찾을 수 없습니다.');
      return { ok: false, errors: errors, departments: [], options: defaultOptions() };
    }
    var bad = list.filter(function (d) {
      return !d || T.normalizeText(d.name) === '';
    });
    if (bad.length) errors.push('부서명이 비어 있는 항목 ' + bad.length + '건은 제외했습니다.');
    var departments = normalizeDepartments(list, true);
    if (!departments.length) errors.push('사용할 수 있는 부서가 없습니다.');
    var options = Object.assign(defaultOptions(), (obj && obj.options) || {});
    return { ok: departments.length > 0, errors: errors, departments: departments, options: options };
  }

  function Store(storage) {
    this.storage = storage === undefined ? safeStorage() : storage;
    this.departments = defaultDepartments();
    this.options = defaultOptions();
    this.usingDefaults = true;
  }

  function safeStorage() {
    try {
      if (typeof localStorage === 'undefined') return null;
      var probe = '__cj_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  Store.prototype.load = function () {
    if (!this.storage) return { loaded: false, reason: '브라우저 저장소를 사용할 수 없어 기본 부서목록을 사용합니다.' };
    var raw = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch (e) {
      return { loaded: false, reason: '저장된 설정을 읽지 못했습니다.' };
    }
    if (!raw) return { loaded: false, reason: null };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { loaded: false, reason: '저장된 설정이 손상되어 기본 부서목록을 사용합니다.' };
    }
    var res = validateSettings(parsed);
    if (!res.ok) return { loaded: false, reason: '저장된 설정을 사용할 수 없어 기본 부서목록을 사용합니다.' };
    this.departments = res.departments;
    this.options = res.options;
    this.usingDefaults = false;
    return { loaded: true, reason: null };
  };

  Store.prototype.save = function () {
    if (!this.storage) return false;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: SETTINGS_VERSION,
          savedAt: new Date().toISOString(),
          departments: this.departments,
          options: this.options,
        })
      );
      this.usingDefaults = false;
      return true;
    } catch (e) {
      return false;
    }
  };

  Store.prototype.resetToDefault = function () {
    this.departments = defaultDepartments();
    this.options = defaultOptions();
    if (this.storage) {
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch (e) {
        /* 무시 */
      }
    }
    this.usingDefaults = true;
  };

  Store.prototype.setDepartments = function (list) {
    this.departments = normalizeDepartments(list);
    return this.departments;
  };

  Store.prototype.enabledDepartments = function () {
    return this.departments.filter(function (d) {
      return d.enabled;
    });
  };

  Store.prototype.findByName = function (name) {
    var key = T.squeeze(name);
    return (
      this.departments.filter(function (d) {
        return T.squeeze(d.name) === key;
      })[0] || null
    );
  };

  Store.prototype.add = function (name, bureau) {
    var nm = T.normalizeText(name);
    if (!nm) return { ok: false, message: '부서명을 입력해 주세요.' };
    if (this.findByName(nm)) return { ok: false, message: '이미 등록된 부서명입니다.' };
    this.departments.push({
      order: this.departments.length + 1,
      name: nm,
      bureau: T.normalizeText(bureau || ''),
      aliases: [],
      enabled: true,
    });
    this.departments = normalizeDepartments(this.departments);
    return { ok: true };
  };

  Store.prototype.rename = function (index, name) {
    var nm = T.normalizeText(name);
    if (!nm) return { ok: false, message: '부서명을 입력해 주세요.' };
    var dup = this.departments.filter(function (d, i) {
      return i !== index && T.squeeze(d.name) === T.squeeze(nm);
    });
    if (dup.length) return { ok: false, message: '이미 등록된 부서명입니다.' };
    this.departments[index].name = nm;
    return { ok: true };
  };

  Store.prototype.remove = function (index) {
    this.departments.splice(index, 1);
    this.departments = normalizeDepartments(this.departments);
  };

  Store.prototype.move = function (from, to) {
    if (from < 0 || from >= this.departments.length) return;
    if (to < 0) to = 0;
    if (to >= this.departments.length) to = this.departments.length - 1;
    var item = this.departments.splice(from, 1)[0];
    this.departments.splice(to, 0, item);
    this.departments = normalizeDepartments(this.departments);
  };

  Store.prototype.setAliases = function (index, aliases) {
    this.departments[index].aliases = aliases;
    this.departments = normalizeDepartments(this.departments);
  };

  Store.prototype.toJSON = function () {
    return JSON.stringify(
      {
        version: SETTINGS_VERSION,
        exportedAt: new Date().toISOString(),
        departments: this.departments,
        options: this.options,
      },
      null,
      2
    );
  };

  Store.prototype.fromJSON = function (text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, errors: ['부서설정 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.'] };
    }
    var res = validateSettings(parsed);
    if (!res.ok) return { ok: false, errors: res.errors.length ? res.errors : ['사용할 수 있는 부서가 없습니다.'] };
    this.departments = res.departments;
    this.options = res.options;
    return { ok: true, errors: res.errors, count: res.departments.length };
  };

  CJ.store = {
    STORAGE_KEY: STORAGE_KEY,
    Store: Store,
    normalizeDepartments: normalizeDepartments,
    validateSettings: validateSettings,
    defaultDepartments: defaultDepartments,
    defaultOptions: defaultOptions,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
