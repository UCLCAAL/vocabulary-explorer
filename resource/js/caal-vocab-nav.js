(() => {
  const nav=document.getElementById("caal-vocabulary-nav");
  const toggle=document.getElementById("caal-vocabulary-nav-toggle");
  const filter=document.getElementById("caal-vocabulary-filter");
  if(toggle&&nav){
    const setOpen=open=>{nav.classList.toggle("is-open",open);toggle.setAttribute("aria-expanded",open?"true":"false")};
    toggle.addEventListener("click",()=>setOpen(!nav.classList.contains("is-open")));
    document.addEventListener("keydown",e=>{if(e.key==="Escape")setOpen(false)});
  }
  if(filter&&nav){
    const groups=[...nav.querySelectorAll(".caal-vocabulary-group")];
    filter.addEventListener("input",()=>{
      const q=filter.value.trim().toLocaleLowerCase();
      groups.forEach(group=>{
        let visible=0;
        [...group.querySelectorAll(".caal-vocabulary-group__item")].forEach(item=>{
          const link=item.querySelector(".caal-vocabulary-link");
          const match=!q||(link?.dataset.vocabularyTitle||link?.textContent||"").toLocaleLowerCase().includes(q);
          item.classList.toggle("is-filtered-out",!match); if(match)visible++;
        });
        group.classList.toggle("is-filtered-out",visible===0);
        if(q&&visible)group.open=true;
      });
    });
  }
  const active=nav?.querySelector(".caal-vocabulary-link.is-active");
  if(active){const group=active.closest("details");if(group)group.open=true}

  document.querySelectorAll("#topbar a").forEach((link) => {
    if (link.textContent.trim() === "Vocabularies") {
      link.closest("li")?.remove();
    }
  });

  document.querySelectorAll("label").forEach((label) => {
    if (label.textContent.trim() === "Content language") {
      label.textContent = "Vocabulary language";
    }
  });

const caalLanguageReplacements = {
    "English": "English",
    "Chinese": "中文",
    "Kazakh": "Қазақша",
    "Kyrgyz": "Кыргызча",
    "Russian": "Русский",
    "Tajik": "Тоҷикӣ",
    "Turkmen": "Türkmençe",
    "Uzbek": "O‘zbekcha",
    "all languages": "All languages"
  };

  function caalLocaliseContentLanguages() {
    document.querySelectorAll("option, .dropdown-item").forEach((el) => {
      const current = el.textContent.trim();
      const replacement = caalLanguageReplacements[current];

      if (replacement && replacement !== current) {
        el.textContent = replacement;
      }
    });

    document.querySelectorAll("label").forEach((label) => {
      if (label.textContent.trim() === "Content language") {
        label.textContent = "Vocabulary language";
      }
    });
  }

  caalLocaliseContentLanguages();

  const caalConceptLanguageOrder = [
    "en",
    "ru",
    "zh",
    "kk",
    "ky",
    "tg",
    "tk",
    "uz"
  ];

  const caalConceptLanguageNames = {
    en: "English",
    ru: "Русский",
    zh: "中文",
    kk: "Қазақша",
    ky: "Кыргызча",
    tg: "Тоҷикӣ",
    tk: "Türkmençe",
    uz: "O‘zbekcha"
  };

  function caalLanguageRank(lang) {
    const code = (lang || "").toLowerCase().split("-")[0];
    const index = caalConceptLanguageOrder.indexOf(code);

    return index === -1 ? 999 : index;
  }

  function caalSortChildren(container, getLanguage) {
    if (!container) return;

    const current = [...container.children];

    const sorted = [...current].sort((a, b) => {
      return (
        caalLanguageRank(getLanguage(a)) -
        caalLanguageRank(getLanguage(b))
      );
    });

    const orderChanged = sorted.some(
      (element, index) => element !== current[index]
    );

    if (!orderChanged) return;

    const fragment = document.createDocumentFragment();

    sorted.forEach((element) => {
      fragment.appendChild(element);
    });

    container.appendChild(fragment);
  }

  function caalFormatConceptLanguages() {
    /*
    * Multilingual scope notes.
    */
    const scopeProperties = [...document.querySelectorAll(".property")]
      .filter((property) => {
        const list = property.querySelector(".property-value > ul");

        if (!list) return false;

        const multilingualValues =
          list.querySelectorAll("span[data-lang]");

        const languageLinks =
          list.querySelectorAll("a[hreflang]");

        return (
          multilingualValues.length > 1 &&
          languageLinks.length === 0
        );
      });

    scopeProperties.forEach((property) => {
      const list = property.querySelector(".property-value > ul");

      if (!list) return;

      [...list.children].forEach((item) => {
        const value = item.querySelector("span[data-lang]");

        if (!value) return;

        const lang = value.dataset.lang
          .toLowerCase()
          .split("-")[0];

        item.dataset.lang = lang;
        item.classList.add("caal-scope-note-row");
        value.classList.add("caal-scope-note-text");

        const desiredLabel =
          caalConceptLanguageNames[lang] || lang;

        let languageLabel = item.querySelector(
          ".caal-scope-note-language"
        );

        if (!languageLabel) {
          languageLabel = document.createElement("span");
          languageLabel.className = "caal-scope-note-language";
          languageLabel.textContent = desiredLabel;

          item.insertBefore(languageLabel, value);
        } else if (languageLabel.textContent !== desiredLabel) {
          languageLabel.textContent = desiredLabel;
        }
      });

      caalSortChildren(
        list,
        (item) => item.dataset.lang
      );
    });

    /*
    * "In other languages" labels.
    */
    const foreignLabels =
      document.querySelector("#concept-other-languages");

    if (foreignLabels) {
      caalSortChildren(
        foreignLabels,
        (row) =>
          row
            .querySelector("[hreflang]")
            ?.getAttribute("hreflang")
      );
    }
  }

  function caalGettyUrl(link) {
    let url;

    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      return null;
    }

    const match = url.pathname.match(
      /^\/aatReference\/[^/]+\/page\/(\d+)\/?$/
    );

    if (!match) return null;

    return `https://www.getty.edu/vow/AATFullDisplay?find=&logic=AND&note=&subjectid=${match[1]}`;
  }

  function caalFixAatMappingLinks() {
    document.querySelectorAll('a[href*="aatReference/"]').forEach((link) => {
      const gettyUrl = caalGettyUrl(link);

      if (gettyUrl) {
        link.href = gettyUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
  }

  /* Fix mappings already present when the page loads */
  caalFixAatMappingLinks();

  function caalStartAatMappingFix() {
    /* Fix anything already on the page */
    caalFixAatMappingLinks();
    caalFormatConceptLanguages();

    /*
    * Skosmos can insert concept/mapping content dynamically.
    * Re-check whenever new DOM content appears.
    */
    function caalRefreshConceptPresentation() {
      window.setTimeout(() => {
        caalFixAatMappingLinks();
        caalFormatConceptLanguages();
      }, 0);
    }

    /*
    * Initial page load.
    */
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        caalRefreshConceptPresentation,
        { once: true }
      );
    } else {
      caalRefreshConceptPresentation();
    }

    /*
    * Skosmos fires this when a concept page has been loaded dynamically.
    */
    document.addEventListener(
      "loadConceptPage",
      caalRefreshConceptPresentation
    );

    /*
    * Capture phase means this runs before Skosmos' normal click handling.
    */
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.('a[href*="aatReference/"]');

        if (!link) return;

        let url;

        try {
          url = new URL(link.href, window.location.origin);
        } catch {
          return;
        }

        const match = url.pathname.match(
          /^\/aatReference\/[^/]+\/page\/(\d+)\/?$/
        );

        if (!match) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        window.open(
          `https://www.getty.edu/vow/AATFullDisplay?find=&logic=AND&note=&subjectid=${match[1]}`,
          "_blank",
          "noopener,noreferrer"
        );
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      caalStartAatMappingFix,
      { once: true }
    );
  } else {
    caalStartAatMappingFix();
  }

})();
