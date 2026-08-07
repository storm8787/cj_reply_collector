/*
 * HWPX 취합본 - 원본 서식 보존 방식.
 *
 * 한글 문서는 글꼴·글자모양·문단모양·테두리를 문서마다 자기 번호표(header.xml)에 담아두고
 * 본문에서는 그 번호만 가리킨다. 여러 문서를 합치면 번호가 서로 충돌하므로
 * 이 모듈은 다음을 수행한다.
 *
 *   1) 각 원본의 번호표 항목을 하나로 모으면서 새 번호를 매긴다
 *   2) 본문 XML 의 번호 참조를 새 번호로 바꾼다
 *   3) 본문 문단은 다시 만들지 않고 원본 XML 을 그대로 옮긴다  → 서식이 유지된다
 *   4) 각 원본 문서를 하나의 '구역'으로 넣어 용지·여백 설정까지 살린다
 *
 * hwp(바이너리) 원본은 서식 정보를 가져올 수 없으므로 문단·표 내용만 옮긴다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];

  function zipLib() {
    return global.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
  }

  /* ----------------------------- 번호표 모으기 ----------------------------- */

  function newRegistry() {
    var base = CJ.hwpxWriter.baseRefList();
    var reg = {
      fonts: {},
      borderFills: base.borderFills.slice(),
      charPrs: base.charPrs.slice(),
      tabPrs: base.tabPrs.slice(),
      numberings: [],
      bullets: [],
      paraPrs: base.paraPrs.slice(),
      styles: base.styles.slice(),
      memoPrs: [],
      namespaces: {},
      // 이 프로그램이 직접 만드는 문단에 쓸 번호 (기본 번호표에서 온 것)
      ownCharPr: 0,
      ownCharPrBold: 1,
      ownParaPr: 0,
      ownStyle: 0,
      ownBorderFill: 2,
    };
    LANGS.forEach(function (l) {
      reg.fonts[l] = base.fonts[l].slice();
    });
    return reg;
  }

  function pickList(refList, containerLocal, itemLocal, xml, source) {
    var box = CJ.xml.childrenOf(refList, containerLocal)[0];
    if (!box) return [];
    return CJ.xml.childrenOf(box, itemLocal).map(function (n) {
      return { id: n.attrs.id, xml: CJ.xml.outerXml(source, n), node: n };
    });
  }

  var CATEGORIES = [
    ['borderFills', 'borderFill', 'borderFills', 'borderFill'],
    ['charProperties', 'charPr', 'charPrs', 'charPr'],
    ['tabProperties', 'tabPr', 'tabPrs', 'tabPr'],
    ['numberings', 'numbering', 'numberings', 'numbering'],
    ['bullets', 'bullet', 'bullets', 'bullet'],
    ['paraProperties', 'paraPr', 'paraPrs', 'paraPr'],
    ['styles', 'style', 'styles', 'style'],
    ['memoProperties', 'memoPr', 'memoPrs', 'memoPr'],
  ];

  function emptyMap(binMap) {
    return {
      font: {},
      borderFill: {},
      charPr: {},
      tabPr: {},
      numbering: {},
      bullet: {},
      paraPr: {},
      style: {},
      memoPr: {},
      bin: binMap || {},
    };
  }

  /**
   * 원본 header.xml 의 항목들을 등록하고 번호 대응표를 돌려준다.
   * 번호표 항목끼리도 서로를 번호로 가리키므로(글자모양→글꼴, 문단모양→탭 등)
   * 먼저 전체 번호를 정한 뒤에 항목 내용의 참조를 바꾼다.
   */
  function registerHeader(reg, headerXml, binMap) {
    var map = emptyMap(binMap);
    LANGS.forEach(function (lang) {
      map.font[lang] = {};
    });
    var root = CJ.xml.parse(headerXml);
    if (!root) return map;
    var head = CJ.xml.childrenOf(root, 'head')[0];
    if (!head) return map;
    Object.assign(reg.namespaces, CJ.xml.namespacesOf(head));
    var refList = CJ.xml.childrenOf(head, 'refList')[0];
    if (!refList) return map;

    // 1단계 - 새 번호만 먼저 정한다
    var pending = { fonts: {}, lists: {} };
    var fontfaces = CJ.xml.childrenOf(refList, 'fontfaces')[0];
    LANGS.forEach(function (lang) {
      pending.fonts[lang] = [];
      if (!fontfaces) return;
      var face = CJ.xml.childrenOf(fontfaces, 'fontface').filter(function (f) {
        return (f.attrs.lang || '').toUpperCase() === lang;
      })[0];
      if (!face) return;
      var offset = reg.fonts[lang].length;
      CJ.xml.childrenOf(face, 'font').forEach(function (f, i) {
        map.font[lang][f.attrs.id] = offset + i;
        pending.fonts[lang].push({ id: offset + i, xml: CJ.xml.outerXml(headerXml, f) });
      });
    });
    CATEGORIES.forEach(function (spec) {
      var items = pickList(refList, spec[0], spec[1], CJ.xml, headerXml);
      var offset = reg[spec[2]].length;
      pending.lists[spec[2]] = items.map(function (it, i) {
        map[spec[3]][it.id] = offset + i;
        return { id: offset + i, xml: it.xml };
      });
    });

    // 2단계 - 번호표가 확정된 뒤에 항목 내용의 참조를 새 번호로 바꾼다
    LANGS.forEach(function (lang) {
      pending.fonts[lang].forEach(function (f) {
        reg.fonts[lang].push({ id: f.id, xml: remap(f.xml, map) });
      });
    });
    CATEGORIES.forEach(function (spec) {
      (pending.lists[spec[2]] || []).forEach(function (it) {
        reg[spec[2]].push({ id: it.id, xml: remap(it.xml, map) });
      });
    });
    return map;
  }

  /* ----------------------------- 번호 바꾸기 ----------------------------- */

  function lookup(table, n) {
    return table && table[n] !== undefined ? table[n] : n;
  }

  function setAttr(chunk, name, value) {
    var re = new RegExp('\\b' + name + '="[^"]*"');
    return re.test(chunk) ? chunk.replace(re, name + '="' + value + '"') : chunk;
  }

  /** 하나의 XML 조각 안의 모든 번호 참조를 새 번호로 바꾼다 */
  function remap(chunk, map) {
    var out = chunk
      .replace(/\bcharPrIDRef="(\d+)"/g, function (m, n) {
        return 'charPrIDRef="' + lookup(map.charPr, n) + '"';
      })
      .replace(/\bparaPrIDRef="(\d+)"/g, function (m, n) {
        return 'paraPrIDRef="' + lookup(map.paraPr, n) + '"';
      })
      .replace(/\bnextStyleIDRef="(\d+)"/g, function (m, n) {
        return 'nextStyleIDRef="' + lookup(map.style, n) + '"';
      })
      .replace(/\bstyleIDRef="(\d+)"/g, function (m, n) {
        return 'styleIDRef="' + lookup(map.style, n) + '"';
      })
      .replace(/\bborderFillIDRef="(\d+)"/g, function (m, n) {
        return 'borderFillIDRef="' + lookup(map.borderFill, n) + '"';
      })
      .replace(/\btabPrIDRef="(\d+)"/g, function (m, n) {
        return 'tabPrIDRef="' + lookup(map.tabPr, n) + '"';
      })
      .replace(/\boutlineShapeIDRef="(\d+)"/g, function (m, n) {
        return 'outlineShapeIDRef="' + lookup(map.numbering, n) + '"';
      })
      .replace(/\bmemoShapeIDRef="(\d+)"/g, function (m, n) {
        return 'memoShapeIDRef="' + lookup(map.memoPr, n) + '"';
      })
      .replace(/\bnumberingIDRef="(\d+)"/g, function (m, n) {
        return 'numberingIDRef="' + lookup(map.numbering, n) + '"';
      })
      .replace(/\bbulletIDRef="(\d+)"/g, function (m, n) {
        return 'bulletIDRef="' + lookup(map.bullet, n) + '"';
      })
      .replace(/\bbinaryItemIDRef="([^"]+)"/g, function (m, n) {
        return 'binaryItemIDRef="' + lookup(map.bin, n) + '"';
      });

    // 글자모양이 가리키는 언어별 글꼴 번호
    out = out.replace(/<([A-Za-z0-9]+:)?fontRef\b([^>]*?)\/>/g, function (m, prefix, attrs) {
      var a = attrs;
      LANGS.forEach(function (lang) {
        var key = lang.toLowerCase();
        a = a.replace(new RegExp('\\b' + key + '="(\\d+)"'), function (mm, n) {
          return key + '="' + lookup(map.font[lang], n) + '"';
        });
      });
      return '<' + (prefix || '') + 'fontRef' + a + '/>';
    });

    // 개요/글머리표가 가리키는 번호
    out = out.replace(/<([A-Za-z0-9]+:)?heading\b([^>]*?)\/>/g, function (m, prefix, attrs) {
      var type = /type="([^"]*)"/.exec(attrs);
      var table = type && type[1] === 'BULLET' ? map.bullet : map.numbering;
      var a = attrs.replace(/\bidRef="(\d+)"/, function (mm, n) {
        return 'idRef="' + lookup(table, n) + '"';
      });
      return '<' + (prefix || '') + 'heading' + a + '/>';
    });
    return out;
  }

  /* ------------------------------ 구역 만들기 ------------------------------ */

  function headingParagraph(reg, text, secPrXml) {
    return (
      '<hp:p paraPrIDRef="' + reg.ownParaPr + '" styleIDRef="' + reg.ownStyle +
      '" pageBreak="0" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="' + reg.ownCharPrBold + '">' +
      (secPrXml || '') +
      '<hp:t>' + CJ.hwpxWriter.escapeXml(text) + '</hp:t>' +
      '</hp:run></hp:p>'
    );
  }

  /**
   * 원본 구역 XML 하나를 취합본용 구역으로 바꾼다.
   * 첫 문단에 들어있는 구역설정(secPr)은 우리가 앞에 넣는 제목 문단으로 옮긴다.
   */
  function convertSection(sectionXml, map, reg, headingText) {
    var root = CJ.xml.parse(sectionXml);
    if (!root) return null;
    var sec = CJ.xml.childrenOf(root, 'sec')[0];
    if (!sec) {
      sec = root.children.filter(function (c) {
        return c.local !== '#document';
      })[0];
    }
    if (!sec) return null;
    Object.assign(reg.namespaces, CJ.xml.namespacesOf(sec));

    var paras = CJ.xml.childrenOf(sec, 'p');
    if (!paras.length) return null;

    var secPrXml = '';
    var bodyParts = [];
    paras.forEach(function (p, i) {
      var chunk = CJ.xml.outerXml(sectionXml, p);
      if (i === 0) {
        var secPr = CJ.xml.findAll(p, 'secPr')[0];
        if (secPr) {
          var raw = CJ.xml.outerXml(sectionXml, secPr);
          secPrXml = remap(raw, map);
          chunk = chunk.split(raw).join(''); // 원래 자리에서는 빼낸다
        }
      }
      bodyParts.push(remap(chunk, map));
    });

    var head = headingText ? headingParagraph(reg, headingText, secPrXml) : '';
    if (!headingText && secPrXml) {
      // 제목을 넣지 않는 경우 구역설정을 첫 문단에 되돌려 놓는다
      bodyParts[0] = bodyParts[0].replace(/(<hp:run\b[^>]*>)/, '$1' + secPrXml);
      if (bodyParts[0].indexOf(secPrXml) < 0) bodyParts[0] = secPrXml + bodyParts[0];
    }
    return head + bodyParts.join('');
  }

  /* -------------------------------- 조립 -------------------------------- */

  function buildHeaderXml(reg, sectionCount) {
    var ns = Object.assign(
      {
        'xmlns:hh': 'http://www.hancom.co.kr/hwpml/2011/head',
        'xmlns:hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
        'xmlns:hc': 'http://www.hancom.co.kr/hwpml/2011/core',
      },
      reg.namespaces
    );
    var nsText = Object.keys(ns)
      .map(function (k) {
        return k + '="' + ns[k] + '"';
      })
      .join(' ');

    function box(container, items) {
      return (
        '<hh:' + container + ' itemCnt="' + items.length + '">' +
        items
          .map(function (it) {
            return setAttr(it.xml, 'id', it.id);
          })
          .join('') +
        '</hh:' + container + '>'
      );
    }

    var fontfaces =
      '<hh:fontfaces itemCnt="' + LANGS.length + '">' +
      LANGS.map(function (lang) {
        return (
          '<hh:fontface lang="' + lang + '" fontCnt="' + reg.fonts[lang].length + '">' +
          reg.fonts[lang]
            .map(function (f) {
              return setAttr(f.xml, 'id', f.id);
            })
            .join('') +
          '</hh:fontface>'
        );
      }).join('') +
      '</hh:fontfaces>';

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<hh:head ' + nsText + ' version="1.4" secCnt="' + sectionCount + '">' +
      '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
      '<hh:refList>' +
      fontfaces +
      box('borderFills', reg.borderFills) +
      box('charProperties', reg.charPrs) +
      box('tabProperties', reg.tabPrs) +
      box('numberings', reg.numberings) +
      (reg.bullets.length ? box('bullets', reg.bullets) : '') +
      box('paraProperties', reg.paraPrs) +
      box('styles', reg.styles) +
      (reg.memoPrs.length ? box('memoProperties', reg.memoPrs) : '') +
      '</hh:refList>' +
      '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
      '</hh:head>'
    );
  }

  function sectionWrapper(reg, body) {
    var ns = Object.assign(
      {
        'xmlns:hs': 'http://www.hancom.co.kr/hwpml/2011/section',
        'xmlns:hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
        'xmlns:hc': 'http://www.hancom.co.kr/hwpml/2011/core',
        'xmlns:hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      },
      reg.namespaces
    );
    var nsText = Object.keys(ns)
      .map(function (k) {
        return k + '="' + ns[k] + '"';
      })
      .join(' ');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<hs:sec ' + nsText + '>' + body + '</hs:sec>';
  }

  function mediaTypeOf(name) {
    var ext = (/\.([A-Za-z0-9]+)$/.exec(name) || [])[1];
    var map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      bmp: 'image/bmp',
      wmf: 'image/x-wmf',
      emf: 'image/x-emf',
      svg: 'image/svg+xml',
    };
    return map[(ext || '').toLowerCase()] || 'application/octet-stream';
  }

  /**
   * @param sources [{department, fileName, kind:'hwpx', bytes} | {kind:'hwp', paragraphs, tables}]
   * @returns Promise<{blob, order, warnings}>
   */
  function merge(sources, options) {
    var opts = options || {};
    var JSZipRef = zipLib();
    if (!JSZipRef) return Promise.reject(new Error('한글 취합본을 만드는 기능을 사용할 수 없습니다.'));

    var reg = newRegistry();
    var sections = [];
    var binFiles = [];
    var opfItems = [];
    var warnings = [];
    var chain = Promise.resolve();

    (sources || []).forEach(function (src, index) {
      chain = chain.then(function () {
        var heading = opts.showHeading === false ? null : '■ ' + src.department;
        if (src.kind !== 'hwpx' || !src.bytes) {
          // 서식 정보를 가져올 수 없는 원본 (hwp 바이너리 등) → 내용만 옮긴다
          var body = CJ.hwpxWriter.plainBody(reg, src.paragraphs || [], src.tables || [], heading);
          sections.push(body);
          if (src.kind === 'hwp') {
            warnings.push({
              fileName: src.fileName,
              message: '한글 hwp 파일은 서식 정보를 가져올 수 없어 내용만 옮겼습니다.',
            });
          }
          return null;
        }
        var prefix = 'd' + index + '_';
        return JSZipRef.loadAsync(src.bytes)
          .then(function (zip) {
            var names = Object.keys(zip.files);
            var headerName = names.filter(function (n) {
              return /Contents\/header\.xml$/i.test(n);
            })[0];
            var sectionNames = names
              .filter(function (n) {
                return /Contents\/section\d*\.xml$/i.test(n);
              })
              .sort(function (a, b) {
                return (
                  parseInt((/section(\d+)/i.exec(a) || [])[1] || '0', 10) -
                  parseInt((/section(\d+)/i.exec(b) || [])[1] || '0', 10)
                );
              });
            if (!sectionNames.length) throw new Error('no-section');

            var binNames = names.filter(function (n) {
              return /^BinData\//i.test(n) && !zip.files[n].dir;
            });

            // 그림 이름을 먼저 정해 두어야 번호표·본문의 참조를 함께 바꿀 수 있다
            var binMap = {};
            binNames.forEach(function (n) {
              var base = n.replace(/^BinData\//i, '');
              var id = base.replace(/\.[^.]+$/, '');
              binMap[id] = prefix + id;
              opfItems.push({
                id: prefix + id,
                href: 'BinData/' + prefix + base,
                media: mediaTypeOf(base),
              });
            });

            var step = headerName ? zip.file(headerName).async('string') : Promise.resolve('');
            return step.then(function (headerXml) {
              var map = headerXml ? registerHeader(reg, headerXml, binMap) : emptyMap(binMap);
              var binChain = Promise.resolve();
              binNames.forEach(function (n) {
                binChain = binChain.then(function () {
                  return zip
                    .file(n)
                    .async('uint8array')
                    .then(function (data) {
                      binFiles.push({ name: 'BinData/' + prefix + n.replace(/^BinData\//i, ''), data: data });
                    });
                });
              });

              var secChain = binChain;
              sectionNames.forEach(function (n, si) {
                secChain = secChain.then(function () {
                  return zip
                    .file(n)
                    .async('string')
                    .then(function (xml) {
                      var body = convertSection(xml, map, reg, si === 0 ? heading : null);
                      if (body) sections.push(body);
                    });
                });
              });
              return secChain;
            });
          })
          .catch(function () {
            warnings.push({
              fileName: src.fileName,
              message: '이 한글 파일의 서식을 가져오지 못해 내용만 옮겼습니다.',
            });
            sections.push(CJ.hwpxWriter.plainBody(reg, src.paragraphs || [], src.tables || [], heading));
            return null;
          });
      });
    });

    return chain.then(function () {
      if (!sections.length) throw new Error('취합할 한글 내용이 없습니다.');
      var zip = new JSZipRef();
      zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
      zip.file('version.xml', CJ.hwpxWriter.versionXml());
      zip.file('META-INF/container.xml', CJ.hwpxWriter.containerXml());

      var sectionFiles = sections.map(function (body, i) {
        return { name: 'Contents/section' + i + '.xml', xml: sectionWrapper(reg, body) };
      });
      sectionFiles.forEach(function (s) {
        zip.file(s.name, s.xml);
      });
      zip.file('Contents/header.xml', buildHeaderXml(reg, sectionFiles.length));
      zip.file(
        'Contents/content.hpf',
        CJ.hwpxWriter.contentHpf(opts.title || '부서 회신자료 통합본', sectionFiles.length, opfItems)
      );
      zip.file('META-INF/manifest.xml', CJ.hwpxWriter.manifestXml(sectionFiles.length, opfItems));
      binFiles.forEach(function (b) {
        zip.file(b.name, b.data);
      });
      return zip
        .generateAsync({
          type: opts.zipType || 'blob',
          mimeType: 'application/hwp+zip',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        })
        .then(function (blob) {
          return { blob: blob, sectionCount: sectionFiles.length, warnings: warnings };
        });
    });
  }

  CJ.hwpxMerger = {
    merge: merge,
    registerHeader: registerHeader,
    convertSection: convertSection,
    remap: remap,
    newRegistry: newRegistry,
    buildHeaderXml: buildHeaderXml,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
