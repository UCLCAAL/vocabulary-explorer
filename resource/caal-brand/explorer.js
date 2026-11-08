(() => {
  'use strict';

  const siteTypeId = /^MT-[1-3]-[0-9]{4,8}$/;
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

  function addActions(cfg, sections) {
    if (sections.querySelector('.caal-concept-actions')) return;
    const bibliography = sections.querySelector('.caal-concept-section--bibliography');
    if (!bibliography) return;
    const actions = el('div', 'caal-concept-actions');
    const conceptId = cfg.uri.split('/').pop();
    if (cfg.vocab === 'caalMonumentTypes' && siteTypeId.test(conceptId)) {
      const url = new URL(viewer);
      url.searchParams.set('siteType', conceptId);
      url.hash = 'viewer';
      const explore = link(url, '', 'caal-explore-viewer');
      explore.append(icon('globe'), el('span', '', 'Explore CAAL records in the Viewer using this term'), icon('arrow-up-right-from-square'));
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
    if (cfg?.pageType !== 'concept' || !cfg.vocab || !cfg.uri || !cfg.lang) return;
    const identity = document.querySelector('.caal-concept-identity');
    const sections = identity?.nextElementSibling;
    if (!sections?.classList.contains('caal-concept-sections')) return;
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

  let frame = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      moveHomeSearch();
      enhanceConcept();
    });
  }
  const main = document.querySelector('main');
  if (main) new MutationObserver(schedule).observe(main, {childList: true, subtree: true});
  const search = document.getElementById('global-search-wrapper');
  if (search) new MutationObserver(schedule).observe(search, {childList: true, subtree: true});
  schedule();
})();
