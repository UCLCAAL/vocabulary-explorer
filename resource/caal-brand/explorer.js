(() => {
  'use strict';

  // Reviewed Chinese wording supplied in the CAAL translation sheet.
  const chineseCopy = {
    "cat_archaeology": "考古分类与年代",
    "cat_archive": "档案与资源描述",
    "cat_condition": "保存状况与风险",
    "cat_remote_sensing": "遥感解译",
    "cat_location": "地理位置与行政区划",
    "cat_physical": "实体特征与测量",
    "cat_language": "语言与文字",
    "caalMonumentTypes": "遗址类型",
    "caalCulturalPeriods": "文化时期",
    "caalAddressTypes": "地址类型",
    "caalAdministrativeTypes": "行政区划类型",
    "caalAnomalyTypes": "异常类型",
    "caalBeginningOfExistenceTypes": "起始类型",
    "caalCertainty": "确定性",
    "caalClassifications": "分类",
    "caalColours": "颜色",
    "caalConditions": "保存状况",
    "caalConditionLevels": "保存状况等级",
    "caalContentTypes": "内容类型",
    "caalCopyrightStatus": "版权状态",
    "caalCountries": "国家",
    "caalDatasetTypes": "数据集类型",
    "caalDescriptionTypes": "描述类型",
    "caalDesignationTypes": "保护认定类型",
    "caalDeteriorationCauses": "劣化原因",
    "caalDigitalFileFormats": "数字文件格式",
    "caalEndOfExistenceTypes": "终止类型",
    "caalLevels": "层级",
    "caalLocationAccuracyAssessment": "位置精度评估",
    "caalMeasurementTypes": "测量类型",
    "caalNameTypes": "名称类型",
    "caalOrigins": "地表痕迹成因",
    "caalReligions": "宗教",
    "caalRiskLevels": "风险等级",
    "caalScripts": "文字",
    "caalSizeDimensionsOriginalMaterial": "原始资料尺寸",
    "caalSubjects": "主题",
    "caalTitleTypes": "标题类型",
    "caalUnitsOfMeasurement": "计量单位",
    "caalWritingSystems": "书写系统",
    "explorer_title": "CAAL词表浏览器",
    "filter_vocabularies": "筛选词表…",
    "vocabulary_language": "词表语言",
    "all_languages": "所有语言"
  };

  const viewerFilters = {
    caalMonumentTypes: {param:'siteType', pattern:/^MT-[1-3]-[0-9]{4,8}$/},
    caalCulturalPeriods: {param:'culturalPeriod', pattern:/^CP-[1-3]-[0-9]{4,8}$/},
    caalCountries: {param:'country', values:{"2": "China", "3": "Karakalpakstan", "4": "Kazakhstan", "5": "Kyrgyzstan", "6": "Tajikistan", "7": "Turkmenistan", "8": "Uzbekistan"}},
    caalLocationAccuracyAssessment: {param:'locationConfidence', values:{"4": "No coords", "1": "High", "2": "Medium", "3": "Low", "5": "Unknown"}},
    caalConditionLevels: {param:'condition', pattern:/^[1-5]$/},
    caalDeteriorationCauses: {param:'deteriorationCause', values:{"11": "Cemetery", "1": "Urban Encroachment", "2": "Quarrying", "3": "Construction", "4": "Agriculture", "5": "Looting", "6": "Fire", "7": "Dumping", "8": "Riverine Erosion", "9": "Soil Erosion", "10": "Transport Infrastructure"}},
    caalThreatTypes: {param:'riskType', values:{"43": "Risk of quarrying", "21": "Risk of construction", "18": "Risk of agriculture", "30": "Risk of fire", "27": "Risk of dumping"}},
    caalRiskLevels: {param:'riskMin', pattern:/^[2-5]$/,
      caption:'Explore CAAL records at this risk level or higher'}
  };
  const languages = new Set(['en', 'zh', 'ru', 'kk', 'ky', 'tg', 'tk', 'uz']);
  const viewer = 'https://data.uclcaal.org/';
  const el = (tag, cls, content) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content) node.textContent = content;
    return node;
  };
  const link = (url, text, cls) => {
    const a = el('a', cls, text);
    a.href = url;
    return a;
  };
  const icon = (name) => {
    const i = el('i', 'fa-solid fa-' + name);
    i.setAttribute('aria-hidden', 'true');
    return i;
  };

  function moveHomeSearch() {
    const host = document.getElementById('caal-home-search');
    const wrapper = document.getElementById('global-search-wrapper');
    if (!host || !wrapper || !wrapper.querySelector('#search-field') || host.contains(wrapper)) return;
    host.append(wrapper);
    host.hidden = false;
    const toggle = document.getElementById('global-search-toggle');
    if (toggle) toggle.hidden = true;
    const bar = document.getElementById('global-search-bar');
    if (bar) bar.hidden = true;
  }

  function vocabularyPage(cfg, uri) {
    const root = '/' + encodeURIComponent(cfg.vocab) + '/' + encodeURIComponent(cfg.lang) + '/';
    const localId = cfg.uriSpace && uri?.startsWith(cfg.uriSpace) ? uri.slice(cfg.uriSpace.length) : '';
    const path = !uri ? root : /^[a-zA-Z0-9-_.~]+$/.test(localId)
      ? root + 'page/' + localId
      : root + 'page/?uri=' + encodeURIComponent(uri);
    const url = new URL(path, location.origin);
    if (cfg.content_lang && cfg.content_lang !== cfg.lang) url.searchParams.set('clang', cfg.content_lang);
    return url.href;
  }

  function ancestorPaths(graph, uri, seen = new Set()) {
    if (seen.has(uri) || !Object.hasOwn(graph, uri) || seen.size >= 30) return [];
    const entry = graph[uri];
    const parents = Array.isArray(entry?.broader) ? [...new Set(entry.broader)] : [];
    if (!parents.length) return [[uri]];
    const visiting = new Set([...seen, uri]);
    const paths = [];
    for (const parent of parents) {
      for (const path of ancestorPaths(graph, parent, visiting)) {
        paths.push([...path, uri]);
        if (paths.length >= 50) return paths;
      }
    }
    return paths;
  }

  let hierarchy = {key: null, graph: null, controller: null};
  function renderPath(cfg, identity, graph) {
    if (!identity.isConnected || identity.querySelector('.caal-concept-path')) return;
    const paths = graph ? ancestorPaths(graph, cfg.uri) : [];
    if (!paths.length && document.getElementById('concept-breadcrumbs')) return;
    const nav = el('nav', 'caal-concept-path');
    nav.setAttribute('aria-label', 'Concept hierarchy path');
    for (const path of paths.length ? paths : [[cfg.uri]]) {
      const list = el('ol');
      const first = el('li');
      first.append(link(vocabularyPage(cfg), cfg.vocShortName || cfg.vocab));
      list.append(first);
      for (const uri of path) {
        const item = el('li');
        const separator = el('span', 'caal-path-separator', '›');
        separator.setAttribute('aria-hidden', 'true');
        item.append(separator);
        if (uri === cfg.uri) {
          const current = el('span', '', identity.querySelector('.caal-concept-identity__label')?.textContent.trim() || graph?.[uri]?.prefLabel || '');
          current.setAttribute('aria-current', 'page');
          item.append(current);
        } else {
          item.append(link(vocabularyPage(cfg, uri), graph[uri].prefLabel || graph[uri].notation || uri.split('/').pop()));
        }
        list.append(item);
      }
      nav.append(list);
    }
    identity.prepend(nav);
  }

  const chronologyCopy = {
    en: {start: 'Start year', end: 'End year', range: 'Recorded date range', bce: 'BCE', ce: 'CE'},
    ru: {start: 'Начало периода', end: 'Конец периода', range: 'Указанный диапазон дат', bce: 'до н. э.', ce: 'н. э.'},
    zh: {start: '起始年份', end: '结束年份', range: '记录的年代范围', bce: '公元前', ce: '公元'}
  };
  const rdfNs = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const caalNs = 'https://vocab.uclcaal.org/ns/';
  const timeNs = 'http://www.w3.org/2006/time#';
  let chronology = null;

  function readPeriodDates(xml, uri) {
    const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
    if (root.namespaceURI !== rdfNs || root.localName !== 'RDF') return null;
    const subjects = Array.from(root.children);
    const properties = (nodes, ns, name) => nodes.flatMap(node =>
      Array.from(node.children).filter(child => child.namespaceURI === ns && child.localName === name));
    const about = id => subjects.filter(node => node.getAttributeNS(rdfNs, 'about') === id);
    const literal = (nodes, ns, name) => {
      const values = new Set(properties(nodes, ns, name)
        .filter(node => !node.children.length && !node.hasAttributeNS(rdfNs, 'resource'))
        .map(node => node.textContent.trim()).filter(Boolean));
      return values.size === 1 ? values.values().next().value : '';
    };
    const objects = (nodes, ns, name) => properties(nodes, ns, name).flatMap(node => {
      const id = node.getAttributeNS(rdfNs, 'resource');
      return id ? about(id) : Array.from(node.children);
    });
    const year = (value, astronomical = false) => {
      if (!(astronomical ? /^-?[0-9]{4,}$/ : /^-?[0-9]+$/).test(value)) return null;
      const n = Number(value);
      const historical = astronomical && n <= 0 ? n - 1 : n;
      return Number.isSafeInteger(historical) && historical !== 0 ? historical : null;
    };
    const concept = about(uri);
    const range = literal(concept, caalNs, 'dateRangeLabel');
    // The legacy numbers were derived from prose. Only use them when the written
    // range confirms both years and their eras; leave century, BP, and conflicting
    // ranges in their original form.
    const number = '([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)';
    const exactRange = new RegExp('^(?:c\\.\\s*)?' + number +
      '\\s*(BCE|CE)?\\s*(?:[-–—]|to)\\s*' + number + '\\s*(BCE|CE)?$', 'i').exec(range);
    let legacyStart = null, legacyEnd = null;
    if (exactRange && (exactRange[2] || exactRange[4])) {
      const [, startText, startEra, endText, endEra] = exactRange;
      const signed = (text, era) => year((era.toUpperCase() === 'BCE' ? '-' : '') + text.replace(/,/g, ''));
      const start = signed(startText, startEra || endEra);
      const end = signed(endText, endEra || startEra);
      if (start !== null && end !== null && start <= end &&
          start === year(literal(concept, caalNs, 'startYear')) &&
          end === year(literal(concept, caalNs, 'endYear'))) {
        legacyStart = start;
        legacyEnd = end;
      }
    }
    const extent = objects(concept, 'http://purl.org/dc/terms/', 'temporal');
    const bound = standard => year(literal(objects(extent, timeNs, standard), timeNs, 'inXSDgYear'), true);
    return {
      start: bound('hasBeginning') ?? legacyStart,
      end: bound('hasEnd') ?? legacyEnd,
      range
    };
  }

  function renderPeriodDates(cfg, identity, dates) {
    if (!dates || !identity.isConnected || identity.querySelector('.caal-period-dates')) return;
    const locale = Object.hasOwn(chronologyCopy, cfg.lang) ? cfg.lang : 'en';
    const copy = chronologyCopy[locale];
    const format = year => {
      const number = new Intl.NumberFormat(locale).format(Math.abs(year));
      const era = year < 0 ? copy.bce : copy.ce;
      return locale === 'zh' ? era + number + '年' : number + ' ' + era;
    };
    const list = el('dl', 'caal-period-dates');
    list.dataset.chronologyKey = cfg.uri + '|' + cfg.lang;
    for (const key of ['start', 'end', 'range']) {
      if (dates[key] === null || dates[key] === '') continue;
      const field = el('div', 'caal-period-dates__' + key);
      field.append(el('dt', '', copy[key]), el('dd', '', key === 'range' ? dates[key] : format(dates[key])));
      list.append(field);
    }
    if (list.childElementCount) identity.append(list);
  }

  function loadPeriodDates(cfg, identity) {
    const prior = identity?.querySelector('.caal-period-dates');
    if (prior && prior.dataset.chronologyKey !== cfg?.uri + '|' + cfg?.lang) prior.remove();
    if (cfg?.vocab !== 'caalCulturalPeriods' || !identity) {
      chronology?.controller.abort();
      chronology = null;
      return;
    }
    if (chronology?.uri === cfg.uri && chronology.lang === cfg.lang) {
      renderPeriodDates(cfg, identity, chronology.dates);
      return;
    }
    chronology?.controller.abort();
    const controller = new AbortController();
    const request = chronology = {uri: cfg.uri, lang: cfg.lang, controller, dates: null};
    const query = new URLSearchParams({uri: cfg.uri, format: 'application/rdf+xml'});
    fetch('/rest/v1/' + encodeURIComponent(cfg.vocab) + '/data?' + query, {signal: controller.signal})
      .then(response => response.ok ? response.text() : null)
      .then(xml => {
        if (!xml || chronology !== request || window.SKOSMOS?.uri !== cfg.uri) return;
        request.dates = readPeriodDates(xml, cfg.uri);
        renderPeriodDates(cfg, identity, request.dates);
        schedule();
      })
      .catch(() => {}); // A failed chronology request must not interrupt the concept page.
  }

  function addActions(cfg, sections) {
    if (sections.querySelector('.caal-concept-actions')) return;
    const bibliography = sections.querySelector('.caal-concept-section--bibliography');
    if (!bibliography) return;
    const actions = el('div', 'caal-concept-actions');
    const conceptId = cfg.uri.split('/').pop();
    const filter = viewerFilters[cfg.vocab];
    const filterValue = filter?.pattern?.test(conceptId) ? conceptId
      : filter?.values && Object.hasOwn(filter.values,conceptId) ? filter.values[conceptId] : null;
    if (filterValue) {
      const url = new URL(viewer);
      url.searchParams.set(filter.param, filterValue);
      url.hash = 'viewer';
      const explore = link(url, '', 'caal-explore-viewer');
      explore.append(icon('globe'), el('span', '', filter.caption || 'Explore CAAL records in the Viewer using this term'), icon('arrow-up-right-from-square'));
      actions.append(explore);
    }
    const url = new URL(viewer);
    url.searchParams.set('concept', cfg.uri);
    const lang = cfg.content_lang || cfg.lang;
    if (languages.has(lang)) url.searchParams.set('conceptLang', lang);
    url.hash = 'feedback';
    actions.append(link(url, 'Suggest a correction', 'caal-concept-feedback'));
    bibliography.before(actions);
  }

  function enhanceConcept() {
    const cfg = {...window.SKOSMOS};
    if (cfg.pageType !== 'concept' || !cfg.vocab || !cfg.uri || !cfg.lang) {
      loadPeriodDates(null);
      return;
    }
    const identity = document.querySelector('.caal-concept-identity');
    const sections = identity?.nextElementSibling;
    if (!sections?.classList.contains('caal-concept-sections')) return;
    loadPeriodDates(cfg, identity);
    addActions(cfg, sections);
    const lang = cfg.content_lang || cfg.lang;
    const key = [cfg.vocab, cfg.uri, lang].join('|');
    if (hierarchy.key === key) {
      if (hierarchy.graph !== null) renderPath(cfg, identity, hierarchy.graph);
      return;
    }
    hierarchy.controller?.abort();
    const controller = new AbortController();
    const request = hierarchy = {key, graph: null, controller};
    const query = new URLSearchParams({uri: cfg.uri, lang});
    fetch('/rest/v1/' + encodeURIComponent(cfg.vocab) + '/hierarchy?' + query, {signal: controller.signal})
      .then(response => response.ok ? response.json() : Promise.reject(Error('Hierarchy unavailable')))
      .then(data => data.broaderTransitive || {})
      .catch(() => ({}))
      .then(graph => {
        if (hierarchy !== request) return;
        request.graph = graph;
        renderPath(cfg, identity, graph);
        schedule();
      });
  }

  function localiseChineseUi() {
    if (document.documentElement.lang !== 'zh') return;
    const setText = (node, value) => {
      if (node && value && node.textContent !== value) node.textContent = value;
    };
    document.querySelectorAll('[data-caal-category]').forEach(node => {
      setText(node, chineseCopy[node.dataset.caalCategory]);
    });
    document.querySelectorAll('[data-caal-vocabulary]').forEach(node => {
      const label = chineseCopy[node.dataset.caalVocabulary];
      if (!label) return;
      // The existing filter indexes this attribute, so keep both languages searchable.
      if (!node.dataset.vocabularyTitle.includes(label)) {
        node.dataset.vocabularyTitle += ' ' + label;
      }
      setText(node, label);
    });
    setText(document.querySelector('#caal-landing-title'), chineseCopy.explorer_title);
    setText(document.querySelector('.caal-vocabulary-nav__brand-subtitle'), chineseCopy.explorer_title.slice(4));
    setText(document.querySelector('label[for="caal-vocabulary-filter"]'), chineseCopy.filter_vocabularies);
    const filter = document.getElementById('caal-vocabulary-filter');
    if (filter) filter.placeholder = chineseCopy.filter_vocabularies;
    setText(document.querySelector('#vocab-title a'), chineseCopy[window.SKOSMOS?.vocab]);
    document.querySelectorAll('.caal-home-shortcuts a').forEach(node => {
      const vocabularyId = new URL(node.href).pathname.split('/')[1];
      setText(node, chineseCopy[vocabularyId]);
    });
    setText(document.getElementById('content-language-label'), chineseCopy.vocabulary_language);
    document.querySelectorAll('#language-list li.dropdown-item, #content-language-current').forEach(node => {
      if (/^all languages$/i.test(node.textContent.trim())) setText(node, chineseCopy.all_languages);
    });
    const all = document.querySelector('#language-list input[value="all"]')?.parentElement;
    if (all) {
      for (const child of all.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && /^all languages$/i.test(child.nodeValue.trim())) {
          child.nodeValue = ' ' + chineseCopy.all_languages;
        }
      }
    }
  }

  const topbar = document.getElementById('topbar');
  if (topbar) {
    const homeTitle = document.getElementById('caal-landing-title');
    const homeLink = document.querySelector('.caal-vocabulary-nav__home') || document.getElementById('navi1');
    if (homeTitle && homeLink && !document.getElementById('skosmos-logo-top')) {
      const logo = link(homeLink.href);
      logo.id = 'skosmos-logo-top';
      logo.setAttribute('aria-labelledby', homeTitle.id);
      topbar.prepend(logo);
    }

    const updateChineseLink = () => {
      const chinese = topbar.querySelector('#language-zh');
      if (!chinese || chinese.textContent === '中文') return;
      chinese.textContent = '中文';
      chinese.lang = 'zh';
      chinese.hreflang = 'zh';
    };
    const updateSidebarOffset = () => {
      document.documentElement.style.setProperty('--caal-nav-top', topbar.getBoundingClientRect().height + 'px');
    };
    updateChineseLink();
    updateSidebarOffset();
    // Skosmos replaces the language links when navigating between concepts.
    const topbarNav = topbar.querySelector('#topbar-nav');
    if (topbarNav) new MutationObserver(updateChineseLink).observe(topbarNav, {childList: true, subtree: true});
    if ('ResizeObserver' in window) new ResizeObserver(updateSidebarOffset).observe(topbar);
  }

  let frame = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      moveHomeSearch();
      localiseChineseUi();
      enhanceConcept();
    });
  }
  const main = document.querySelector('main');
  if (main) new MutationObserver(schedule).observe(main, {childList: true, subtree: true});
  const search = document.getElementById('global-search-wrapper');
  if (search) new MutationObserver(schedule).observe(search, {childList: true, subtree: true});
  const vocabSearch = document.getElementById('search-vocab');
  if (vocabSearch) new MutationObserver(schedule).observe(vocabSearch, {childList: true, subtree: true, characterData: true});
  schedule();
})();
