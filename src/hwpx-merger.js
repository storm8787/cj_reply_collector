/*
 * HWPX 취합 - 첫 문서를 그대로 두고 뒤 문서를 붙이는 방식.
 *
 * 새 HWPX 를 처음부터 만들지 않는다. 부서순서상 첫 번째 한글 문서(Base)의
 * ZIP 을 통째로 복사한 뒤, 뒤 문서의 서식 정의만 Base 의 header.xml 에 덧붙이고
 * 본문 노드는 원본 그대로 Base 의 section 에 옮겨 담는다.
 *
 *   ① Base HWPX 패키지 전체 복사 (settings.xml, Preview, DocOptions 등 포함)
 *   ② Base header.xml / section.xml 을 DOM 으로 열어 필요한 부분만 추가
 *   ③ 뒤 문서의 fontface·borderFill·charPr·tabPr·paraPr·style·numbering·bullet·memoPr 을
 *      Base 뒤 번호로 추가하고, 본문의 참조를 새 번호로 재매핑
 *   ④ 본문은 다시 만들지 않고 원본 노드를 importNode 로 그대로 복사
 *   ⑤ BinData 를 겹치지 않는 이름으로 옮기고 binaryItemIDRef 와 content.hpf 갱신
 *   ⑥ 문서 경계는 첫 문단의 pageBreak 속성만으로 처리
 *
 * 서식 정보를 가져올 수 없는 hwp(구형 바이너리) 원본만 내용을 다시 그린다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});

  var LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];

  // header.xml 안에서 합쳐야 하는 서식 목록
  //   [항목 localName, 담는 컨테이너 localName, 대응표 이름]
  var REF_CATEGORIES = [
    ['borderFill', 'borderFills', 'borderFill'],
    ['charPr', 'charProperties', 'charPr'],
    ['tabPr', 'tabProperties', 'tabPr'],
    ['numbering', 'numberings', 'numbering'],
    ['bullet', 'bullets', 'bullet'],
    ['paraPr', 'paraProperties', 'paraPr'],
    ['style', 'styles', 'style'],
    ['memoPr', 'memoProperties', 'memoPr'],
  ];

  // 본문에서 새 번호로 바꿔야 하는 참조 속성
  var SECTION_REFS = [
    ['charPrIDRef', 'charPr'],
    ['paraPrIDRef', 'paraPr'],
    ['styleIDRef', 'style'],
    ['borderFillIDRef', 'borderFill'],
    ['tabPrIDRef', 'tabPr'],
    ['numberingIDRef', 'numbering'],
    ['bulletIDRef', 'bullet'],
    ['memoShapeIDRef', 'memoPr'],
    ['outlineShapeIDRef', 'numbering'],
  ];

  var MIME_BY_EXT = {
    bmp: 'image/bmp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    wmf: 'image/x-wmf',
    emf: 'image/x-emf',
    svg: 'image/svg+xml',
    ole: 'application/octet-stream',
  };

  function zipLib() {
    return global.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
  }
  function D() {
    return CJ.hdom;
  }

  function emptyMaps() {
    var maps = {};
    REF_CATEGORIES.forEach(function (cat) {
      maps[cat[2]] = new Map();
    });
    maps.font = {};
    return maps;
  }

  function findPath(paths, re) {
    for (var i = 0; i < paths.length; i++) if (re.test(paths[i])) return paths[i];
    return null;
  }

  function sectionPaths(paths) {
    return paths
      .filter(function (p) {
        return /^Contents\/section\d+\.xml$/i.test(p);
      })
      .sort(function (a, b) {
        return parseInt(/(\d+)/.exec(a)[1], 10) - parseInt(/(\d+)/.exec(b)[1], 10);
      });
  }

  /* -------------------------- 서식(번호표) 합치기 -------------------------- */

  /** Base header 의 현재 상태를 읽어 둔다 */
  function readBaseHeader(baseHdrDoc) {
    var dom = D();
    var state = {
      doc: baseHdrDoc,
      next: {},
      faceToId: {},
      nextFontId: {},
      styleNameToId: {},
    };
    REF_CATEGORIES.forEach(function (cat) {
      state.next[cat[2]] = dom.nextId(dom.elementsById(baseHdrDoc, cat[0]));
    });
    dom.elementsByLocalName(baseHdrDoc, 'fontface').forEach(function (ff) {
      var lang = dom.attr(ff, 'lang');
      if (!lang) return;
      state.faceToId[lang] = {};
      var fonts = dom.childrenByLocalName(ff, 'font');
      var max = -1;
      fonts.forEach(function (f) {
        var id = dom.attr(f, 'id');
        var face = dom.attr(f, 'face');
        if (id === null) return;
        if (face) state.faceToId[lang][face] = parseInt(id, 10);
        var n = parseInt(id, 10);
        if (!isNaN(n) && n > max) max = n;
      });
      state.nextFontId[lang] = max + 1;
    });
    dom.elementsByLocalName(baseHdrDoc, 'style').forEach(function (el) {
      var name = dom.attr(el, 'name');
      var id = dom.attr(el, 'id');
      if (name && id !== null) state.styleNameToId[name] = parseInt(id, 10);
    });
    return state;
  }

  /** 컨테이너에 요소를 덧붙이고 itemCnt 를 갱신한다 */
  function appendToContainer(hdrDoc, containerLocal, elements) {
    if (!elements.length) return false;
    var dom = D();
    var cont = dom.elementsByLocalName(hdrDoc, containerLocal)[0];
    if (!cont) {
      // 원본에 없던 분류라면 refList 아래에 새로 만든다
      var refList = dom.elementsByLocalName(hdrDoc, 'refList')[0];
      if (!refList) return false;
      var sample = dom.elementsByLocalName(hdrDoc, 'charProperties')[0] || refList;
      var pfx = dom.prefixOf(sample);
      cont = hdrDoc.createElementNS(sample.namespaceURI, (pfx ? pfx + ':' : '') + containerLocal);
      cont.setAttribute('itemCnt', '0');
      refList.appendChild(cont);
    }
    var cnt = dom.attr(cont, 'itemCnt');
    if (cnt !== null) cont.setAttribute('itemCnt', String((parseInt(cnt, 10) || 0) + elements.length));
    elements.forEach(function (el) {
      cont.appendChild(hdrDoc.importNode(el, true));
    });
    return true;
  }

  /** fontface 에 새 글꼴을 추가하고 fontCnt 를 갱신한다 */
  function appendFonts(hdrDoc, lang, fonts) {
    if (!fonts.length) return;
    var dom = D();
    var ff = dom.elementsByLocalName(hdrDoc, 'fontface').filter(function (f) {
      return dom.attr(f, 'lang') === lang;
    })[0];
    if (!ff) return;
    var cnt = dom.attr(ff, 'fontCnt');
    if (cnt !== null) ff.setAttribute('fontCnt', String((parseInt(cnt, 10) || 0) + fonts.length));
    fonts.forEach(function (item) {
      var copy = hdrDoc.importNode(item.el, true);
      copy.setAttribute('id', String(item.newId));
      ff.appendChild(copy);
    });
  }

  /** charPr 안의 글꼴 참조를 새 번호로 (두 가지 표기 모두 지원) */
  function remapFontRefs(charEl, fontIdMap) {
    D()
      .elementsByLocalName(charEl, 'fontRef')
      .forEach(function (fr) {
        // 표기 1) <hh:fontRef hangul="0" latin="0" .../>
        LANGS.forEach(function (lang) {
          var name = lang.toLowerCase();
          var v = D().attr(fr, name);
          if (v !== null && fontIdMap[lang] && fontIdMap[lang].has(v)) {
            fr.setAttribute(name, String(fontIdMap[lang].get(v)));
          }
        });
        // 표기 2) <hh:fontRef langId="HANGUL" id="0"/>
        var langId = D().attr(fr, 'langId');
        var oldId = D().attr(fr, 'id');
        if (langId && oldId !== null && fontIdMap[langId] && fontIdMap[langId].has(oldId)) {
          fr.setAttribute('id', String(fontIdMap[langId].get(oldId)));
        }
      });
  }

  /**
   * 뒤 문서의 header.xml 서식을 Base header 에 합치고 번호 대응표를 돌려준다.
   * 글꼴은 이름이 같으면 Base 것을 다시 쓰고, 스타일은 이름이 같으면 Base 것을 가리킨다.
   */
  function mergeHeader(state, srcHdrDoc) {
    var dom = D();
    var maps = {};
    REF_CATEGORIES.forEach(function (cat) {
      maps[cat[2]] = new Map();
    });
    var fontIdMap = {};

    // 1) 글꼴 - 같은 이름이면 재사용
    var newFonts = {};
    dom.elementsByLocalName(srcHdrDoc, 'fontface').forEach(function (ff) {
      var lang = dom.attr(ff, 'lang');
      if (!lang) return;
      fontIdMap[lang] = fontIdMap[lang] || new Map();
      if (!state.faceToId[lang]) {
        state.faceToId[lang] = {};
        state.nextFontId[lang] = 0;
      }
      dom.childrenByLocalName(ff, 'font').forEach(function (f) {
        var oldId = dom.attr(f, 'id');
        var face = dom.attr(f, 'face');
        if (oldId === null || !face) return;
        if (state.faceToId[lang][face] !== undefined) {
          fontIdMap[lang].set(oldId, state.faceToId[lang][face]);
          return;
        }
        var nid = state.nextFontId[lang]++;
        fontIdMap[lang].set(oldId, nid);
        state.faceToId[lang][face] = nid;
        (newFonts[lang] = newFonts[lang] || []).push({ el: f, newId: nid });
      });
    });
    Object.keys(newFonts).forEach(function (lang) {
      appendFonts(state.doc, lang, newFonts[lang]);
    });

    // 2) 서식 항목 - 번호를 먼저 다 정한 뒤에 내용의 참조를 바꾼다
    var pending = {};
    REF_CATEGORIES.forEach(function (cat) {
      var local = cat[0];
      var key = cat[2];
      pending[key] = [];
      dom.elementsById(srcHdrDoc, local).forEach(function (el, oldId) {
        if (key === 'style') {
          var name = dom.attr(el, 'name');
          if (name && state.styleNameToId[name] !== undefined) {
            maps.style.set(oldId, state.styleNameToId[name]);
            return;
          }
        }
        var nid = state.next[key]++;
        maps[key].set(oldId, nid);
        if (key === 'style') {
          var nm = dom.attr(el, 'name');
          if (nm) state.styleNameToId[nm] = nid;
        }
        pending[key].push({ el: el, newId: nid });
      });
    });

    REF_CATEGORIES.forEach(function (cat) {
      var key = cat[2];
      var elems = pending[key].map(function (item) {
        var copy = item.el.cloneNode(true);
        copy.setAttribute('id', String(item.newId));
        if (key === 'charPr') remapFontRefs(copy, fontIdMap);
        // 항목 자신과 그 자식들이 들고 있는 참조도 모두 새 번호로
        SECTION_REFS.forEach(function (ref) {
          dom.remapAttribute(copy, ref[0], maps[ref[1]]);
        });
        // <hh:heading type="OUTLINE|BULLET" idRef="N"/>
        dom.elementsByLocalName(copy, 'heading').forEach(function (h) {
          var idRef = dom.attr(h, 'idRef');
          if (idRef === null) return;
          var table = dom.attr(h, 'type') === 'BULLET' ? maps.bullet : maps.numbering;
          if (table.has(idRef)) h.setAttribute('idRef', String(table.get(idRef)));
        });
        return copy;
      });
      appendToContainer(state.doc, cat[1], elems);
    });

    maps.font = fontIdMap;
    return maps;
  }

  /* ------------------------------ BinData ------------------------------ */

  function extensionOf(name) {
    var dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1) : '';
  }
  function baseNameOf(name) {
    var dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(0, dot) : name;
  }

  /** 뒤 문서의 BinData 를 겹치지 않는 이름으로 옮기고 참조 대응표를 만든다 */
  function copyBinData(srcZip, srcPaths, out, usedNames, counter) {
    var files = srcPaths.filter(function (p) {
      return /^BinData\//i.test(p) && !srcZip.files[p].dir;
    });
    var refMap = new Map();
    var jobs = [];
    files.forEach(function (path) {
      var fileName = path.split('/').pop();
      var oldBase = baseNameOf(fileName);
      var ext = extensionOf(fileName);
      var newBase;
      do {
        counter.n += 1;
        newBase = 'BIN' + String(counter.n).padStart(4, '0');
      } while (usedNames[newBase.toLowerCase()]);
      usedNames[newBase.toLowerCase()] = true;
      var newName = ext ? newBase + '.' + ext : newBase;
      refMap.set(oldBase, newBase);
      refMap.set(oldBase.toLowerCase(), newBase);
      refMap.set(oldBase.toUpperCase(), newBase);
      jobs.push(
        srcZip.files[path].async('arraybuffer').then(function (data) {
          out.file('BinData/' + newName, data);
        })
      );
    });
    return Promise.all(jobs).then(function () {
      return refMap;
    });
  }

  /* ------------------------------ 본문 붙이기 ------------------------------ */

  /**
   * 뒤 문서의 <hs:sec> 자식 노드를 Base 의 section 에 그대로 옮긴다.
   * 원본 노드를 다시 만들지 않고 importNode 로 복사하므로 서식이 그대로 유지된다.
   * secPr(용지·여백·머리말 설정)은 원본 위치 그대로 둔다.
   */
  function appendSection(baseSecDoc, baseSecRoot, srcSecDoc, maps, binRefMap, markPageBreak) {
    var dom = D();
    var srcRoot = srcSecDoc.documentElement;

    if (binRefMap && binRefMap.size) {
      dom.elementsWithAttribute(srcRoot, 'binaryItemIDRef').forEach(function (el) {
        var v = el.getAttribute('binaryItemIDRef');
        if (binRefMap.has(v)) el.setAttribute('binaryItemIDRef', binRefMap.get(v));
      });
    }
    SECTION_REFS.forEach(function (ref) {
      dom.remapAttribute(srcRoot, ref[0], maps[ref[1]]);
    });

    var firstParagraphDone = !markPageBreak;
    var kids = [];
    for (var i = 0; i < srcRoot.childNodes.length; i++) kids.push(srcRoot.childNodes[i]);

    var appended = 0;
    kids.forEach(function (node) {
      if (node.nodeType !== 1) return;
      if (node.localName === 'secPr') return; // <hs:sec> 바로 아래의 잘못된 위치는 건너뛴다
      var imported = baseSecDoc.importNode(node, true);
      if (!firstParagraphDone && node.localName === 'p') {
        // 문서 경계: 새 쪽에서 시작하도록 속성 하나만 추가한다
        imported.setAttribute('pageBreak', '1');
        firstParagraphDone = true;
      }
      baseSecRoot.appendChild(imported);
      appended++;
    });
    return appended;
  }

  /**
   * 서식을 가져올 수 없는 원본(hwp 바이너리)의 내용을 Base 서식으로 그려 붙인다.
   * Base 의 첫 번째 글자모양·문단모양·스타일 번호를 그대로 쓴다.
   */
  function appendPlain(baseSecDoc, baseSecRoot, headerState, block) {
    var dom = D();
    // Base 문서에 실제로 있는 가장 작은 번호를 쓴다 (없는 번호를 가리키지 않도록)
    var smallest = function (local) {
      var ids = [];
      dom.elementsById(headerState.doc, local).forEach(function (_, id) {
        var n = parseInt(id, 10);
        if (!isNaN(n)) ids.push(n);
      });
      return ids.length ? String(Math.min.apply(null, ids)) : '0';
    };
    var ids = { charPr: smallest('charPr'), paraPr: smallest('paraPr'), style: smallest('style') };
    var secRoot = baseSecRoot;
    // 본문 문단은 hp 접두사를 쓴다. Base 문서에서 실제로 쓰이는 접두사를 찾아 맞춘다.
    var sampleP = dom.elementsByLocalName(secRoot, 'p')[0];
    var pPrefix = sampleP ? dom.prefixOf(sampleP) : 'hp';
    var pNS = sampleP ? sampleP.namespaceURI : 'http://www.hancom.co.kr/hwpml/2011/paragraph';
    var tag = function (name) {
      return (pPrefix ? pPrefix + ':' : '') + name;
    };

    function makeParagraph(text, pageBreak) {
      var p = baseSecDoc.createElementNS(pNS, tag('p'));
      p.setAttribute('paraPrIDRef', ids.paraPr);
      p.setAttribute('styleIDRef', ids.style);
      if (pageBreak) p.setAttribute('pageBreak', '1');
      var run = baseSecDoc.createElementNS(pNS, tag('run'));
      run.setAttribute('charPrIDRef', ids.charPr);
      var t = baseSecDoc.createElementNS(pNS, tag('t'));
      if (text) t.appendChild(baseSecDoc.createTextNode(text));
      run.appendChild(t);
      p.appendChild(run);
      return p;
    }

    var first = true;
    var push = function (text) {
      secRoot.appendChild(makeParagraph(text, first));
      first = false;
    };
    push('■ ' + block.department + ' (서식 없이 내용만 옮김)');
    (block.paragraphs || []).slice(0, 500).forEach(function (line) {
      var v = CJ.text.collapseSpace(line);
      if (v) push(v);
    });
    (block.tables || []).forEach(function (grid) {
      (grid || []).slice(0, 500).forEach(function (row) {
        var line = (row || [])
          .slice(0, 40)
          .map(function (v) {
            return CJ.text.collapseSpace(v);
          })
          .join('\t');
        if (CJ.text.collapseSpace(line)) push(line);
      });
    });
    push('');
    return true;
  }

  /* ------------------------------ content.hpf ------------------------------ */

  function updateManifest(hpfDoc, outPaths) {
    var dom = D();
    var manifest = dom.elementsByLocalName(hpfDoc, 'manifest')[0];
    if (!manifest) return 0;
    var existing = Object.create(null);
    dom.elementsByLocalName(manifest, 'item').forEach(function (item) {
      var href = dom.attr(item, 'href');
      if (href) existing[href.toLowerCase()] = true;
    });
    var sample = dom.elementsByLocalName(manifest, 'item')[0];
    var ns = sample ? sample.namespaceURI : 'http://www.idpf.org/2007/opf/';
    var pfx = sample ? dom.prefixOf(sample) : 'opf';
    var added = 0;
    outPaths.forEach(function (path) {
      if (existing[path.toLowerCase()]) return;
      var fileName = path.split('/').pop();
      var ext = extensionOf(fileName).toLowerCase();
      var item = hpfDoc.createElementNS(ns, (pfx ? pfx + ':' : '') + 'item');
      item.setAttribute('id', baseNameOf(fileName));
      item.setAttribute('href', path);
      item.setAttribute('media-type', MIME_BY_EXT[ext] || 'application/octet-stream');
      item.setAttribute('isEmbeded', '1');
      manifest.appendChild(item);
      added++;
    });
    return added;
  }

  /* ------------------------------- 검증 ------------------------------- */

  /** 최종 결과에 없는 번호를 가리키는 참조가 남아 있는지 확인한다 */
  function verify(hdrDoc, secDocs, binBaseNames) {
    var dom = D();
    var have = {};
    REF_CATEGORIES.forEach(function (cat) {
      have[cat[2]] = new Set();
      dom.elementsById(hdrDoc, cat[0]).forEach(function (_, id) {
        have[cat[2]].add(id);
      });
    });
    var problems = [];
    secDocs.forEach(function (doc) {
      SECTION_REFS.forEach(function (ref) {
        var attr = ref[0];
        var kind = ref[1];
        if (attr === 'outlineShapeIDRef' || attr === 'memoShapeIDRef') return; // 없을 수 있는 참조
        dom.elementsWithAttribute(doc, attr).forEach(function (el) {
          var v = el.getAttribute(attr);
          if (v === null || v === '') return;
          if (!have[kind].has(v)) problems.push(attr + '="' + v + '" (' + el.localName + ')');
        });
      });
      dom.elementsWithAttribute(doc, 'binaryItemIDRef').forEach(function (el) {
        var v = el.getAttribute('binaryItemIDRef');
        if (v && binBaseNames.indexOf(v) < 0 && binBaseNames.indexOf(v.toUpperCase()) < 0) {
          problems.push('binaryItemIDRef="' + v + '"');
        }
      });
    });
    return problems;
  }

  /* -------------------------------- 병합 -------------------------------- */

  function loadSources(sources) {
    var JSZipRef = zipLib();
    var chain = Promise.resolve();
    var loaded = [];
    (sources || []).forEach(function (src) {
      chain = chain.then(function () {
        if (src.kind !== 'hwpx' || !src.bytes) {
          loaded.push({ src: src, zip: null });
          return null;
        }
        return JSZipRef.loadAsync(src.bytes)
          .then(function (zip) {
            var paths = Object.keys(zip.files);
            var hasSection = sectionPaths(paths).length > 0;
            var hasHeader = !!findPath(paths, /^Contents\/header\.xml$/i);
            loaded.push({ src: src, zip: hasSection ? zip : null, paths: paths, hasHeader: hasHeader });
          })
          .catch(function () {
            loaded.push({ src: src, zip: null });
          });
      });
    });
    return chain.then(function () {
      return loaded;
    });
  }

  /**
   * @param sources [{department, fileName, kind:'hwpx', bytes} | {kind:'hwp', paragraphs, tables}]
   *                이미 부서순서로 정렬되어 있어야 한다.
   * @returns Promise<{blob, warnings, baseFileName, documentCount}>
   */
  function merge(sources, options) {
    var opts = options || {};
    var JSZipRef = zipLib();
    if (!JSZipRef) return Promise.reject(new Error('한글 취합본을 만드는 기능을 사용할 수 없습니다.'));
    if (!D().available()) return Promise.reject(new Error('한글 취합본을 만드는 기능을 사용할 수 없습니다.'));

    var dom = D();
    var warnings = [];

    return loadSources(sources).then(function (loaded) {
      // Base 는 서식 번호표(header.xml)까지 갖춘 첫 문서라야 한다
      var baseIndex = -1;
      for (var i = 0; i < loaded.length; i++) {
        if (loaded[i].zip && loaded[i].hasHeader) {
          baseIndex = i;
          break;
        }
      }
      if (baseIndex < 0) throw new Error('서식을 읽을 수 있는 한글(hwpx) 문서가 없습니다.');

      loaded.forEach(function (entry) {
        if (entry.zip) return;
        warnings.push({
          fileName: entry.src.fileName,
          message:
            entry.src.kind === 'hwpx'
              ? '이 한글 파일의 서식을 가져오지 못해 내용만 옮겼습니다.'
              : '한글 hwp 파일은 서식 정보를 가져올 수 없어 내용만 옮겼습니다.',
        });
      });

      var base = loaded[baseIndex];
      var basePaths = base.paths;
      var out = new JSZipRef();
      var usedNames = Object.create(null);

      // ① Base 패키지 전체 복사
      var copyChain = Promise.resolve();
      basePaths.forEach(function (p) {
        if (base.zip.files[p].dir) return;
        copyChain = copyChain.then(function () {
          return base.zip.files[p].async('arraybuffer').then(function (data) {
            out.file(p, data);
          });
        });
        if (/^BinData\//i.test(p)) usedNames[baseNameOf(p.split('/').pop()).toLowerCase()] = true;
      });

      return copyChain.then(function () {
        // ② Base 의 header / section 열기 (뒤 문서는 마지막 구역 뒤에 붙인다)
        var hdrKey = findPath(basePaths, /^Contents\/header\.xml$/i);
        var secKeys = sectionPaths(basePaths);
        var secKey = secKeys[secKeys.length - 1];
        var hpfKey = findPath(basePaths, /^Contents\/content\.hpf$/i);

        return Promise.all([
          base.zip.files[hdrKey].async('string'),
          base.zip.files[secKey].async('string'),
          hpfKey ? base.zip.files[hpfKey].async('string') : Promise.resolve(null),
        ]).then(function (texts) {
          var baseHdrDoc = dom.parse(texts[0]);
          var baseSecDoc = dom.parse(texts[1]);
          if (!baseHdrDoc || !baseSecDoc) throw new Error('첫 번째 한글 문서를 읽지 못했습니다.');
          var baseSecRoot = baseSecDoc.documentElement;
          var headerState = readBaseHeader(baseHdrDoc);
          var basePageSetup = describeSecPr(dom.elementsByLocalName(baseSecDoc, 'secPr')[0]);
          var binCounter = { n: 0 };
          var documentCount = 1;

          var chain = Promise.resolve();
          loaded.forEach(function (entry, index) {
            if (index === baseIndex) return;
            chain = chain.then(function () {
              if (!entry.zip) {
                appendPlain(baseSecDoc, baseSecRoot, headerState, entry.src);
                documentCount++;
                return null;
              }
              var srcPaths = entry.paths;
              var srcHdrKey = findPath(srcPaths, /^Contents\/header\.xml$/i);
              return copyBinData(entry.zip, srcPaths, out, usedNames, binCounter).then(function (binRefMap) {
                var hdrRead = srcHdrKey
                  ? entry.zip.files[srcHdrKey].async('string')
                  : Promise.resolve('');
                return hdrRead.then(function (hdrText) {
                  var srcHdrDoc = hdrText ? dom.parse(hdrText) : null;
                  if (hdrText && !srcHdrDoc) {
                    warnings.push({
                      fileName: entry.src.fileName,
                      message: '이 한글 파일의 서식을 읽지 못해 내용만 옮겼습니다.',
                    });
                    appendPlain(baseSecDoc, baseSecRoot, headerState, entry.src);
                    documentCount++;
                    return null;
                  }
                  // 번호표가 없는 문서는 바꿀 참조도 없으므로 빈 대응표를 쓴다
                  var maps = srcHdrDoc ? mergeHeader(headerState, srcHdrDoc) : emptyMaps();
                  var srcSecKeys = sectionPaths(srcPaths);
                  var secChain = Promise.resolve();
                  srcSecKeys.forEach(function (key, si) {
                    secChain = secChain.then(function () {
                      return entry.zip.files[key].async('string').then(function (secText) {
                        var srcSecDoc = dom.parse(secText);
                        if (!srcSecDoc) return;
                        if (si === 0) {
                          var setup = describeSecPr(dom.elementsByLocalName(srcSecDoc, 'secPr')[0]);
                          if (setup && basePageSetup && setup !== basePageSetup) {
                            warnings.push({
                              fileName: entry.src.fileName,
                              message: '용지·여백 설정이 첫 번째 문서와 달라 구역이 나뉩니다.',
                              kind: 'pageSetup',
                            });
                          }
                        }
                        appendSection(baseSecDoc, baseSecRoot, srcSecDoc, maps, binRefMap, si === 0);
                      });
                    });
                  });
                  return secChain.then(function () {
                    documentCount++;
                  });
                });
              });
            });
          });

          return chain.then(function () {
            // ⑤ content.hpf 에 새로 추가된 BinData 만 등록
            var outBinPaths = Object.keys(out.files).filter(function (p) {
              return /^BinData\/./i.test(p) && !out.files[p].dir;
            });
            if (texts[2] && hpfKey) {
              var hpfDoc = dom.parse(texts[2]);
              if (hpfDoc) {
                updateManifest(hpfDoc, outBinPaths);
                out.file(hpfKey, dom.serialize(hpfDoc));
              }
            }

            // ⑥ 남아 있는 잘못된 참조 확인
            var binBaseNames = outBinPaths.map(function (p) {
              return baseNameOf(p.split('/').pop());
            });
            var problems = verify(baseHdrDoc, [baseSecDoc], binBaseNames);
            if (problems.length) {
              var uniq = problems.filter(function (v, i, a) {
                return a.indexOf(v) === i;
              });
              if (global.console && global.console.error) {
                global.console.error('[한글 취합본] 연결되지 않은 서식 참조: ' + uniq.join(', '));
              }
              warnings.push({
                fileName: '',
                message: '한글 취합본에 연결되지 않은 서식 참조 ' + uniq.length + '건이 있습니다.',
                kind: 'dangling',
                details: uniq,
              });
            }

            out.file(hdrKey, dom.serialize(baseHdrDoc));
            out.file(secKey, dom.serialize(baseSecDoc));

            return out
              .generateAsync({
                type: opts.zipType || 'blob',
                mimeType: 'application/hwp+zip',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
              })
              .then(function (blob) {
                return {
                  blob: blob,
                  warnings: warnings,
                  baseFileName: base.src.fileName,
                  documentCount: documentCount,
                  danglingRefs: problems,
                };
              });
          });
        });
      });
    });
  }

  /** 용지 설정 비교용 요약 문자열 */
  function describeSecPr(secPr) {
    if (!secPr) return '';
    var dom = D();
    var pagePr = dom.elementsByLocalName(secPr, 'pagePr')[0];
    if (!pagePr) return '';
    var margin = dom.elementsByLocalName(pagePr, 'margin')[0];
    var parts = [dom.attr(pagePr, 'width'), dom.attr(pagePr, 'height'), dom.attr(pagePr, 'landscape')];
    if (margin) {
      ['left', 'right', 'top', 'bottom', 'header', 'footer', 'gutter'].forEach(function (k) {
        parts.push(dom.attr(margin, k));
      });
    }
    return parts.join('|');
  }

  CJ.hwpxMerger = {
    merge: merge,
    mergeHeader: mergeHeader,
    readBaseHeader: readBaseHeader,
    appendSection: appendSection,
    updateManifest: updateManifest,
    verify: verify,
    describeSecPr: describeSecPr,
    REF_CATEGORIES: REF_CATEGORIES,
    SECTION_REFS: SECTION_REFS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
