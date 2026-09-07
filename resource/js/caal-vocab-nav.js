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
      }
    });
  }

  /* Fix mappings already present when the page loads */
  caalFixAatMappingLinks();

  function caalStartAatMappingFix() {
    /* Fix anything already on the page */
    caalFixAatMappingLinks();

    /*
    * Skosmos can insert concept/mapping content dynamically.
    * Re-check whenever new DOM content appears.
    */
    const observer = new MutationObserver(() => {
      caalFixAatMappingLinks();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

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

        window.location.href =
          `https://www.getty.edu/vow/AATFullDisplay?find=&logic=AND&note=&subjectid=${match[1]}`;
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
