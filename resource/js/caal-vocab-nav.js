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

  /* Re-check only after user interaction, rather than watching every DOM change */
  document.addEventListener("click", () => {
    window.setTimeout(caalLocaliseContentLanguages, 50);
  });
})();
