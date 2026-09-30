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

  /*
   * Language names in the multilingual value blocks are shown as endonyms,
   * matching the older CAAL Scope note presentation.
   */
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

  let caalSelectedLanguageOverride = "";

  function caalLanguageCodeFromSelect(select) {
    if (!select) return "";

    const supported =
      new Set(caalConceptLanguageOrder);

    const option =
      select.selectedOptions?.[0] || null;

    const candidates = [
      select.value,
      select.dataset?.lang,
      select.getAttribute?.("lang"),
      option?.value,
      option?.dataset?.lang,
      option?.getAttribute?.("lang"),
      option?.getAttribute?.("hreflang")
    ];

    for (const raw of candidates) {
      const value =
        String(raw || "")
          .trim()
          .toLowerCase()
          .replace("_", "-");

      const direct = value.split("-")[0];

      if (supported.has(direct)) {
        return direct;
      }

      const match = value.match(
        /(?:^|[?&=/])(?:lang=)?(en|ru|zh|kk|ky|tg|tk|uz)(?:$|[&#/])/i
      );

      if (match) {
        return match[1].toLowerCase();
      }
    }

    const text =
      String(option?.textContent || "")
        .trim()
        .toLowerCase();

    const aliases = {
      "english": "en",
      "russian": "ru",
      "русский": "ru",
      "chinese": "zh",
      "中文": "zh",
      "kazakh": "kk",
      "қазақша": "kk",
      "kyrgyz": "ky",
      "кыргызча": "ky",
      "tajik": "tg",
      "тоҷикӣ": "tg",
      "turkmen": "tk",
      "türkmençe": "tk",
      "uzbek": "uz",
      "o‘zbekcha": "uz",
      "o'zbekcha": "uz"
    };

    return aliases[text] || "";
  }

  function caalCurrentUiLanguage() {
    const supported =
      new Set(caalConceptLanguageOrder);

    if (
      caalSelectedLanguageOverride &&
      supported.has(
        caalSelectedLanguageOverride
      )
    ) {
      return caalSelectedLanguageOverride;
    }

    const parts = window.location.pathname
      .split("/")
      .filter(Boolean);

    const pageIndex = parts.indexOf("page");

    if (
      pageIndex >= 1 &&
      supported.has(
        String(parts[pageIndex - 1]).toLowerCase()
      )
    ) {
      return String(
        parts[pageIndex - 1]
      ).toLowerCase();
    }

    const htmlLang =
      String(
        document.documentElement.lang || ""
      )
        .toLowerCase()
        .split("-")[0];

    return supported.has(htmlLang)
      ? htmlLang
      : "en";
  }

  const caalUiStrings = {
    en: {
      definition: "Definition",
      hierarchy: "Hierarchy",
      source: "Source",
      sources: "Sources",
      reference: "Reference",
      references: "References",
      bibliography: "CAAL bibliography",
      openReference: "Open reference",
      relatedLink: "Related link"
    },
    ru: {
      definition: "Определение",
      hierarchy: "Иерархия",
      source: "Источник",
      sources: "Источники",
      reference: "Литература",
      references: "Литература",
      bibliography: "Библиография CAAL",
      openReference: "Открыть источник",
      relatedLink: "Связанная ссылка"
    },
    zh: {
      definition: "定义",
      hierarchy: "层级结构",
      source: "来源",
      sources: "来源",
      reference: "参考文献",
      references: "参考文献",
      bibliography: "CAAL 参考文献",
      openReference: "打开参考文献",
      relatedLink: "相关链接"
    },
    kk: {
      definition: "Анықтама",
      hierarchy: "Иерархия",
      source: "Дереккөз",
      sources: "Дереккөздер",
      reference: "Әдебиет",
      references: "Әдебиеттер",
      bibliography: "CAAL библиографиясы",
      openReference: "Дереккөзді ашу",
      relatedLink: "Қатысты сілтеме"
    },
    ky: {
      definition: "Аныктама",
      hierarchy: "Иерархия",
      source: "Булак",
      sources: "Булактар",
      reference: "Адабият",
      references: "Адабият",
      bibliography: "CAAL библиографиясы",
      openReference: "Булакты ачуу",
      relatedLink: "Байланышкан шилтеме"
    },
    tg: {
      definition: "Таъриф",
      hierarchy: "Иерархия",
      source: "Манбаъ",
      sources: "Манбаъҳо",
      reference: "Адабиёт",
      references: "Адабиёт",
      bibliography: "Китобномаи CAAL",
      openReference: "Кушодани манбаъ",
      relatedLink: "Пайванди алоқаманд"
    },
    tk: {
      definition: "Kesgitleme",
      hierarchy: "Iýerarhiýa",
      source: "Çeşme",
      sources: "Çeşmeler",
      reference: "Edebiýat",
      references: "Edebiýat",
      bibliography: "CAAL bibliografiýasy",
      openReference: "Çeşmäni aç",
      relatedLink: "Baglanyşykly salgylanma"
    },
    uz: {
      definition: "Ta'rif",
      hierarchy: "Ierarxiya",
      source: "Manba",
      sources: "Manbalar",
      reference: "Adabiyot",
      references: "Adabiyot",
      bibliography: "CAAL bibliografiyasi",
      openReference: "Manbani ochish",
      relatedLink: "Bog‘liq havola"
    }
  };

  function caalUi(key) {
    const lang =
      caalCurrentUiLanguage();

    return (
      caalUiStrings[lang]?.[key] ||
      caalUiStrings.en[key] ||
      key
    );
  }

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
      .filter((property) =>
        property.querySelector(".property-label h2")
          ?.textContent.trim() === "Scope note"
      );

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
      document.querySelector(
        "#concept-other-languages"
      );

    if (foreignLabels) {
      [...foreignLabels.children]
        .forEach((row) => {
          const link =
            row.querySelector(
              "[hreflang]"
            );

          if (!link) {
            return;
          }

          const lang =
            (
              link.getAttribute(
                "hreflang"
              ) || ""
            )
              .toLowerCase()
              .split("-")[0];

          if (!lang) {
            return;
          }

          row.dataset.lang = lang;

          row.classList.add(
            "caal-scope-note-row",
            "caal-other-language-row"
          );

          link.classList.add(
            "caal-scope-note-text",
            "caal-other-language-text"
          );

          const languageLabel =
            document.createElement(
              "span"
            );

          languageLabel.className =
            [
              "caal-scope-note-language",
              "caal-other-language-language"
            ].join(" ");

          languageLabel.textContent =
            caalConceptLanguageNames[
              lang
            ] || lang;

          /*
          * Remove Skosmos' separate
          * language-name column and use
          * the same two-column layout as
          * Definition.
          */
          row.replaceChildren(
            languageLabel,
            link
          );
        });

      caalSortChildren(
        foreignLabels,
        (row) =>
          row.dataset.lang
      );
    }
  }

  const caalDcterms = {
    source: "http://purl.org/dc/terms/source",
    references: "http://purl.org/dc/terms/references",
    citation: "http://purl.org/dc/terms/bibliographicCitation",
    identifier: "http://purl.org/dc/terms/identifier",
    relation: "http://purl.org/dc/terms/relation"
  };

  let caalBibliographyRequestId = 0;

  /*
   * Skosmos replaces parts of the concept-property DOM when the vocabulary
   * language changes. Keep the complete definition set outside that DOM so
   * the custom multilingual block can be restored after Skosmos redraws it.
   */
  const caalDefinitionCache = new Map();
  let caalDefinitionRestoreTimer = null;

  function caalJsonLdGraph(data) {
    if (!data || typeof data !== "object") return [];

    if (Array.isArray(data["@graph"])) {
      return data["@graph"];
    }

    if (Array.isArray(data.graph)) {
      return data.graph;
    }

    return [data];
  }

  function caalNodeId(node) {
    if (!node || typeof node !== "object") return "";

    return (
      node["@id"] ||
      node.uri ||
      node.id ||
      ""
    );
  }

  function caalPropertyValues(node, fullUri, aliases = []) {
    if (!node || typeof node !== "object") return [];

    const keys = [
      fullUri,
      ...aliases
    ];

    for (const key of keys) {
      if (!(key in node)) continue;

      const value = node[key];

      if (Array.isArray(value)) {
        return value;
      }

      if (value === null || value === undefined) {
        return [];
      }

      return [value];
    }

    return [];
  }

  function caalLinkedUri(value) {
    if (typeof value === "string") {
      return value;
    }

    if (!value || typeof value !== "object") {
      return "";
    }

    return (
      value["@id"] ||
      value.uri ||
      value.id ||
      ""
    );
  }

  function caalLiteralText(value) {
    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return String(value);
    }

    if (!value || typeof value !== "object") {
      return "";
    }

    return String(
      value["@value"] ??
      value.value ??
      value.label ??
      ""
    );
  }

  function caalCurrentConceptUriProperty() {
    return [...document.querySelectorAll(".property")]
      .find((property) =>
        property.querySelector(".property-label h2")
          ?.textContent.trim() === "URI"
      ) || null;
  }

  function caalCurrentConceptUri() {
    const uriProperty = caalCurrentConceptUriProperty();

    if (!uriProperty) return "";

    const anchor = uriProperty.querySelector(
      ".property-value a[href]"
    );

    if (anchor?.href?.startsWith("http")) {
      return anchor.href;
    }

    const text = uriProperty
      .querySelector(".property-value")
      ?.textContent.trim();

    const match = text?.match(/https?:\/\/\S+/);

    return match?.[0] || "";
  }


  function caalCurrentVocabularyId() {
    /*
     * Concept page paths are normally:
     *
     *   /{vocid}/{lang}/page/{localName}
     *
     * Derive the Skosmos vocabulary id from the URL instead of hard-coding
     * Site Types so the shared CAAL script remains reusable.
     */
    const parts = window.location.pathname
      .split("/")
      .filter(Boolean);

    const pageIndex = parts.indexOf("page");

    if (pageIndex >= 2) {
      return parts[pageIndex - 2];
    }

    return parts[0] || "";
  }

  function caalReferenceNode(graph, uri) {
    return graph.find(
      (node) => caalNodeId(node) === uri
    ) || null;
  }

  function caalReferenceCitation(node) {
    const values = caalPropertyValues(
      node,
      caalDcterms.citation,
      [
        "dcterms:bibliographicCitation",
        "dc:bibliographicCitation",
        "bibliographicCitation"
      ]
    );

    return caalLiteralText(values[0]).trim();
  }

  function caalReferenceIdentifier(node) {
    const values = caalPropertyValues(
      node,
      caalDcterms.identifier,
      [
        "dcterms:identifier",
        "dc:identifier",
        "identifier"
      ]
    );

    return caalLiteralText(values[0]).trim();
  }

  function caalReferenceRelations(node) {
    return caalPropertyValues(
      node,
      caalDcterms.relation,
      [
        "dcterms:relation",
        "dc:relation",
        "relation"
      ]
    )
      .map(caalLinkedUri)
      .filter(Boolean);
  }

  function caalReferenceFallbackLabel(uri) {
    try {
      const url = new URL(uri);

      if (
        url.hostname === "uclcaal.org" &&
        url.pathname.includes("/bibliography/")
      ) {
        return "CAAL bibliography record";
      }

      if (url.hostname === "doi.org") {
        return "DOI";
      }

      return uri;
    } catch {
      return uri;
    }
  }

  function caalBuildReferenceItem(uri, graph) {
    const node = caalReferenceNode(graph, uri);
    const citation = caalReferenceCitation(node);
    const identifier = caalReferenceIdentifier(node);
    const relatedUris = caalReferenceRelations(node);

    const item = document.createElement("li");
    item.className = "caal-bibliography-row";

    const text = document.createElement("div");
    text.className = "caal-bibliography-citation";
    text.textContent =
      citation ||
      caalReferenceFallbackLabel(uri);

    item.appendChild(text);

    const links = document.createElement("div");
    links.className = "caal-bibliography-links";

    const seen = new Set();

    function addLink(href, label) {
      if (!href || seen.has(href)) return;
      seen.add(href);

      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;

      links.appendChild(link);
    }

    addLink(
      uri,
      uri.includes("uclcaal.org/bibliography/")
        ? caalUi("bibliography")
        : uri.startsWith("https://doi.org/")
          ? "DOI"
          : caalUi("openReference")
    );

    if (
      identifier &&
      /^10\.\d{4,9}\//i.test(identifier)
    ) {
      addLink(
        `https://doi.org/${identifier}`,
        "DOI"
      );
    }

    relatedUris.forEach((relatedUri) => {
      let label =
        caalUi("relatedLink");

      if (relatedUri.includes("doi.org/")) {
        label = "DOI";
      } else if (
        relatedUri.includes("zotero.org/")
      ) {
        label = "Zotero";
      } else if (
        relatedUri.includes(
          "uclcaal.org/bibliography/"
        )
      ) {
        label =
          caalUi("bibliography");
      }

      addLink(relatedUri, label);
    });

    if (links.children.length) {
      item.appendChild(links);
    }

    return item;
  }

  function caalBuildBibliographyProperty(
    heading,
    uris,
    graph
  ) {
    const property = document.createElement("div");
    property.className =
      "property caal-bibliography-property";

    const label = document.createElement("div");
    label.className = "property-label";

    const h2 = document.createElement("h2");
    h2.textContent = heading;
    label.appendChild(h2);

    const value = document.createElement("div");
    value.className = "property-value";

    const list = document.createElement("ul");
    list.className = "caal-bibliography-list";

    uris.forEach((uri) => {
      list.appendChild(
        caalBuildReferenceItem(uri, graph)
      );
    });

    value.appendChild(list);
    property.appendChild(label);
    property.appendChild(value);

    return property;
  }

  function caalRdfXmlResourceValues(xml, subjectUri, predicateLocalName) {
    const RDF_NS =
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    const DC_NS =
      "http://purl.org/dc/terms/";

    const values = [];

    [...xml.getElementsByTagName("*")].forEach((element) => {
      const about =
        element.getAttributeNS(RDF_NS, "about") ||
        element.getAttribute("rdf:about");

      if (about !== subjectUri) {
        return;
      }

      [...element.children].forEach((child) => {
        if (
          child.namespaceURI !== DC_NS ||
          child.localName !== predicateLocalName
        ) {
          return;
        }

        const resource =
          child.getAttributeNS(RDF_NS, "resource") ||
          child.getAttribute("rdf:resource");

        if (resource) {
          values.push(resource);
        }
      });
    });

    return values;
  }

  function caalRdfXmlReferenceMetadata(xml, referenceUri) {
    const RDF_NS =
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    const DC_NS =
      "http://purl.org/dc/terms/";

    let subject = null;

    [...xml.getElementsByTagName("*")].some((element) => {
      const about =
        element.getAttributeNS(RDF_NS, "about") ||
        element.getAttribute("rdf:about");

      if (about === referenceUri) {
        subject = element;
        return true;
      }

      return false;
    });

    if (!subject) {
      return {
        citation: "",
        identifier: "",
        relations: []
      };
    }

    let citation = "";
    let identifier = "";
    const relations = [];

    [...subject.children].forEach((child) => {
      if (child.namespaceURI !== DC_NS) {
        return;
      }

      if (
        child.localName === "bibliographicCitation" &&
        !citation
      ) {
        citation = child.textContent.trim();
        return;
      }

      if (
        child.localName === "identifier" &&
        !identifier
      ) {
        identifier = child.textContent.trim();
        return;
      }

      if (child.localName === "relation") {
        const resource =
          child.getAttributeNS(RDF_NS, "resource") ||
          child.getAttribute("rdf:resource");

        if (resource) {
          relations.push(resource);
        }
      }
    });

    return {
      citation,
      identifier,
      relations
    };
  }

  async function caalFetchReferenceMetadata(
    uri,
    fallbackXml
  ) {
    const fallback =
      caalRdfXmlReferenceMetadata(
        fallbackXml,
        uri
      );

    /*
     * A concept RDF/XML download can contain the referenced resource only
     * as a typed node, without its citation metadata. Skosmos can return the
     * full metadata when the bibliography URI itself is requested.
     */
    if (fallback.citation) {
      return fallback;
    }

    try {
      const response = await fetch(
        `/rest/v1/data?uri=${
          encodeURIComponent(uri)
        }`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/rdf+xml"
          }
        }
      );

      if (!response.ok) {
        return fallback;
      }

      const rdfXml =
        await response.text();

      const xml =
        new DOMParser().parseFromString(
          rdfXml,
          "application/xml"
        );

      if (xml.querySelector("parsererror")) {
        return fallback;
      }

      const fetched =
        caalRdfXmlReferenceMetadata(
          xml,
          uri
        );

      return {
        citation:
          fetched.citation ||
          fallback.citation,
        identifier:
          fetched.identifier ||
          fallback.identifier,
        relations:
          [
            ...new Set([
              ...fallback.relations,
              ...fetched.relations
            ])
          ]
      };
    } catch {
      return fallback;
    }
  }

  async function caalBuildRdfXmlReferenceItem(
    uri,
    xml
  ) {
    const metadata =
      await caalFetchReferenceMetadata(
        uri,
        xml
      );

    const item = document.createElement("li");
    item.className = "caal-bibliography-row";

    const citation = document.createElement("div");
    citation.className = "caal-bibliography-citation";
    citation.textContent =
      metadata.citation ||
      caalReferenceFallbackLabel(uri);

    item.appendChild(citation);

    const links = document.createElement("div");
    links.className = "caal-bibliography-links";

    const seen = new Set();

    function addLink(href, label) {
      if (!href || seen.has(href)) {
        return;
      }

      seen.add(href);

      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;

      links.appendChild(link);
    }

    addLink(
      uri,
      uri.includes("uclcaal.org/bibliography/")
        ? "CAAL bibliography"
        : uri.startsWith("https://doi.org/")
          ? "DOI"
          : "Open reference"
    );

    if (
      metadata.identifier &&
      /^10\.\d{4,9}\//i.test(metadata.identifier)
    ) {
      addLink(
        `https://doi.org/${metadata.identifier}`,
        "DOI"
      );
    }

    metadata.relations.forEach((relatedUri) => {
      let label = "Related link";

      if (relatedUri.includes("doi.org/")) {
        label = "DOI";
      } else if (relatedUri.includes("zotero.org/")) {
        label = "Zotero";
      } else if (
        relatedUri.includes("uclcaal.org/bibliography/")
      ) {
        label = "CAAL bibliography";
      }

      addLink(relatedUri, label);
    });

    if (links.children.length) {
      item.appendChild(links);
    }

    return item;
  }

  async function caalBuildRdfXmlBibliographyProperty(
    heading,
    uris,
    xml
  ) {
    const property = document.createElement("div");
    property.className =
      "property caal-bibliography-property";

    const label = document.createElement("div");
    label.className = "property-label";

    const h2 = document.createElement("h2");
    h2.textContent = heading;
    label.appendChild(h2);

    const value = document.createElement("div");
    value.className = "property-value";

    const list = document.createElement("ul");
    list.className = "caal-bibliography-list";

    const items =
      await Promise.all(
        uris.map((uri) =>
          caalBuildRdfXmlReferenceItem(
            uri,
            xml
          )
        )
      );

    items.forEach((item) => {
      list.appendChild(item);
    });

    value.appendChild(list);
    property.appendChild(label);
    property.appendChild(value);

    return property;
  }

  function caalRdfXmlLiteralValues(
    xml,
    subjectUri,
    namespaceUri,
    predicateLocalName
  ) {
    const RDF_NS =
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    const XML_NS =
      "http://www.w3.org/XML/1998/namespace";

    const values = [];

    [...xml.getElementsByTagName("*")].forEach((element) => {
      const about =
        element.getAttributeNS(RDF_NS, "about") ||
        element.getAttribute("rdf:about");

      if (about !== subjectUri) {
        return;
      }

      [...element.children].forEach((child) => {
        if (
          child.namespaceURI !== namespaceUri ||
          child.localName !== predicateLocalName
        ) {
          return;
        }

        const text = child.textContent.trim();
        if (!text) return;

        const lang = (
          child.getAttributeNS(XML_NS, "lang") ||
          child.getAttribute("xml:lang") ||
          ""
        )
          .toLowerCase()
          .split("-")[0];

        values.push({
          lang,
          text
        });
      });
    });

    return values;
  }

  const caalDefinitionHeadingNames = new Set([
    "Definition",
    "Определение",
    "定义",
    "Анықтама",
    "Аныктама",
    "Таъриф",
    "Kesgitleme",
    "Ta'rif"
  ]);

  function caalRemoveNativeDefinitionProperties() {
    [...document.querySelectorAll(".property")]
      .filter((property) => {
        const heading =
          property.querySelector(".property-label h2")
            ?.textContent.trim();

        return (
          property.classList.contains(
            "caal-definition-property"
          ) ||
          caalDefinitionHeadingNames.has(heading)
        );
      })
      .forEach((property) => property.remove());
  }

  function caalDefinitionProperty(
    definitions
  ) {
    const property =
      document.createElement("div");

    property.className =
      "property caal-definition-property";

    const label =
      document.createElement("div");

    label.className = "property-label";

    const h2 =
      document.createElement("h2");

    h2.textContent =
      caalUi("definition");
    label.appendChild(h2);

    const value =
      document.createElement("div");

    value.className = "property-value";

    const list =
      document.createElement("ul");

    list.className =
      "caal-definition-list";

    definitions
      .sort(
        (a, b) =>
          caalLanguageRank(a.lang) -
          caalLanguageRank(b.lang)
      )
      .forEach(({ lang, text }) => {
        const item =
          document.createElement("li");

        item.dataset.lang = lang;
        item.className =
          "caal-scope-note-row caal-definition-row";

        const languageLabel =
          document.createElement("span");

        languageLabel.className =
          "caal-scope-note-language caal-definition-language";

        languageLabel.textContent =
          caalConceptLanguageNames[lang] || lang;

        const definitionText =
          document.createElement("span");

        definitionText.className =
          "caal-scope-note-text caal-definition-text";

        definitionText.dataset.lang = lang;
        definitionText.textContent = text;

        item.appendChild(languageLabel);
        item.appendChild(definitionText);
        list.appendChild(item);
      });

    value.appendChild(list);
    property.appendChild(label);
    property.appendChild(value);

    return property;
  }

  function caalDefinitionsFromXml(
    xml,
    conceptUri
  ) {
    const SKOS_NS =
      "http://www.w3.org/2004/02/skos/core#";

    return caalRdfXmlLiteralValues(
      xml,
      conceptUri,
      SKOS_NS,
      "definition"
    ).filter(
      (row) => row.lang && row.text
    );
  }

  async function caalFetchAllDefinitions(
    vocabularyId,
    conceptUri
  ) {
    /*
     * Skosmos may filter concept RDF according to `lang`.
     * Instead of relying on one response to contain every language,
     * request the concept once for each configured CAAL language and
     * merge/deduplicate the returned skos:definition values.
     *
     * This also fixes the Chinese page when the concept has no Chinese
     * definition: the custom Definition property is created from the
     * definitions fetched in the other languages rather than relying on
     * Skosmos to render a native Definition row first.
     */
    if (!vocabularyId || !conceptUri) {
      return [];
    }

    const requests =
      caalConceptLanguageOrder.map(
        async (lang) => {
          const url =
            `/rest/v1/${
              encodeURIComponent(vocabularyId)
            }/data?uri=${
              encodeURIComponent(conceptUri)
            }&format=${
              encodeURIComponent(
                "application/rdf+xml"
              )
            }&lang=${
              encodeURIComponent(lang)
            }`;

          try {
            const response =
              await fetch(url, {
                cache: "no-store",
                headers: {
                  Accept:
                    "application/rdf+xml"
                }
              });

            if (!response.ok) {
              return [];
            }

            const rdfXml =
              await response.text();

            const xml =
              new DOMParser().parseFromString(
                rdfXml,
                "application/xml"
              );

            if (
              xml.querySelector("parsererror")
            ) {
              return [];
            }

            return caalDefinitionsFromXml(
              xml,
              conceptUri
            );
          } catch {
            return [];
          }
        }
      );

    const groups =
      await Promise.all(requests);

    const byLanguage =
      new Map();

    groups
      .flat()
      .forEach(({ lang, text }) => {
        const code =
          String(lang || "")
            .toLowerCase()
            .split("-")[0];

        if (
          code &&
          text &&
          !byLanguage.has(code)
        ) {
          byLanguage.set(code, text);
        }
      });

    return caalConceptLanguageOrder
      .filter((lang) =>
        byLanguage.has(lang)
      )
      .map((lang) => ({
        lang,
        text: byLanguage.get(lang)
      }));
  }

  function caalRenderMultilingualDefinitions(
    definitions,
    uriProperty
  ) {
    caalRemoveNativeDefinitionProperties();

    if (
      !definitions.length ||
      !uriProperty?.parentNode
    ) {
      return;
    }

    uriProperty.parentNode.insertBefore(
      caalDefinitionProperty(definitions),
      uriProperty
    );
  }

  function caalCacheDefinitions(
    conceptUri,
    definitions
  ) {
    if (
      !conceptUri ||
      !Array.isArray(definitions) ||
      !definitions.length
    ) {
      return;
    }

    caalDefinitionCache.set(
      conceptUri,
      definitions.map((row) => ({ ...row }))
    );
  }

  function caalRestoreCachedDefinitions() {
    /*
     * If Skosmos has redrawn the concept-property area, our injected
     * Definition property will have disappeared. Recreate it from the
     * complete definition set already fetched for this concept.
     */
    if (
      document.querySelector(
        ".caal-definition-property"
      )
    ) {
      return;
    }

    const conceptUri =
      caalCurrentConceptUri();

    const definitions =
      caalDefinitionCache.get(conceptUri);

    if (!definitions?.length) {
      return;
    }

    const uriProperty =
      caalCurrentConceptUriProperty();

    if (!uriProperty) {
      return;
    }

    caalRenderMultilingualDefinitions(
      definitions,
      uriProperty
    );
  }

  function caalScheduleDefinitionRestore() {
    window.clearTimeout(
      caalDefinitionRestoreTimer
    );

    caalDefinitionRestoreTimer =
      window.setTimeout(
        caalRestoreCachedDefinitions,
        40
      );
  }

  async function caalRenderBibliography() {
    const conceptUri =
      caalCurrentConceptUri();

    const uriProperty =
      caalCurrentConceptUriProperty();

    document
      .querySelectorAll(".caal-bibliography-property")
      .forEach((element) => element.remove());

    if (!conceptUri || !uriProperty) {
      return;
    }

    const requestId =
      ++caalBibliographyRequestId;

    try {
      const vocabularyId =
        caalCurrentVocabularyId();

      /*
       * Definitions are fetched separately for every configured language,
       * then merged. This avoids all dependency on the active Skosmos page
       * language and works even when the active language has no definition.
       */
      const definitions =
        await caalFetchAllDefinitions(
          vocabularyId,
          conceptUri
        );

      if (
        requestId !== caalBibliographyRequestId
      ) {
        return;
      }

      caalCacheDefinitions(
        conceptUri,
        definitions
      );

      caalRenderMultilingualDefinitions(
        definitions,
        uriProperty
      );

      /*
       * Keep one normal concept RDF/XML response for Source/Reference
       * discovery. Bibliographic resource metadata is still resolved
       * individually by the Phase 3.5 code.
       */
      const rdfXmlUrl =
        vocabularyId
          ? (
              `/rest/v1/${
                encodeURIComponent(vocabularyId)
              }/data?uri=${
                encodeURIComponent(conceptUri)
              }&format=${
                encodeURIComponent(
                  "application/rdf+xml"
                )
              }`
            )
          : (
              `/rest/v1/data?uri=${
                encodeURIComponent(conceptUri)
              }&format=${
                encodeURIComponent(
                  "application/rdf+xml"
                )
              }`
            );

      const response = await fetch(
        rdfXmlUrl,
        {
          cache: "no-store",
          headers: {
            Accept:
              "application/rdf+xml"
          }
        }
      );

      if (!response.ok) {
        return;
      }

      const rdfXml =
        await response.text();

      if (
        requestId !==
        caalBibliographyRequestId
      ) {
        return;
      }

      const xml =
        new DOMParser().parseFromString(
          rdfXml,
          "application/xml"
        );

      if (
        xml.querySelector("parsererror")
      ) {
        console.warn(
          "CAAL bibliography: Skosmos returned invalid RDF/XML"
        );
        return;
      }

      const sources =
        caalRdfXmlResourceValues(
          xml,
          conceptUri,
          "source"
        );

      const references =
        caalRdfXmlResourceValues(
          xml,
          conceptUri,
          "references"
        );

      const parent = uriProperty.parentNode;

      if (!parent) {
        return;
      }

      if (sources.length) {
        const sourceProperty =
          await caalBuildRdfXmlBibliographyProperty(
            sources.length === 1
              ? caalUi("source")
              : caalUi("sources"),
            sources,
            xml
          );

        if (
          requestId !==
          caalBibliographyRequestId
        ) {
          return;
        }

        parent.insertBefore(
          sourceProperty,
          uriProperty
        );
      }

      if (references.length) {
        const referenceProperty =
          await caalBuildRdfXmlBibliographyProperty(
            references.length === 1
              ? caalUi("reference")
              : caalUi("references"),
            references,
            xml
          );

        if (
          requestId !==
          caalBibliographyRequestId
        ) {
          return;
        }

        parent.insertBefore(
          referenceProperty,
          uriProperty
        );
      }
    } catch (error) {
      console.warn(
        "CAAL bibliography display failed:",
        error
      );
    }
  }


  let caalHierarchyRequestId = 0;
  let caalHierarchyRenderTimer = null;

  const caalExpandedHierarchyChildren =
    new Set();

  const caalNativeHierarchyHeadings =
    new Set([
      "Broader concept",
      "Broader concepts",
      "Narrower concept",
      "Narrower concepts",
      "Broader",
      "Narrower",

      "Концепция более широкого понятия",
      "Концепции более широкого понятия",
      "Концепция более узкого понятия",
      "Концепции более узкого понятия",
      "Более широкое понятие",
      "Более узкое понятие",

      "上位概念",
      "下位概念",
      "上层概念",
      "下层概念",

      "Кеңірек ұғым",
      "Тар ұғым",
      "Кеңири түшүнүк",
      "Тар түшүнүк",
      "Мафҳуми васеътар",
      "Мафҳуми маҳдудтар",
      "Has giň düşünje",
      "Has dar düşünje",
      "Kengroq tushuncha",
      "Tor tushuncha"
    ]);

  function caalRemoveNativeHierarchyProperties() {
    document
      .querySelectorAll(
        ".caal-hierarchy-property"
      )
      .forEach(
        (element) => element.remove()
      );

    [...document.querySelectorAll(".property")]
      .forEach((property) => {
        const heading =
          property
            .querySelector(
              ".property-label h2"
            )
            ?.textContent.trim();

        if (
          heading &&
          caalNativeHierarchyHeadings.has(
            heading
          )
        ) {
          property.remove();
        }
      });
  }

  let caalPreferredLabelRequestId = 0;
  let caalPreferredLabelRenderTimer = null;

  const caalNativePreferredLabelHeadings =
    new Set([
      "Preferred term",
      "Preferred label",
      "Предпочитаемый термин",
      "Предпочтительная метка",
      "首选词",
      "首选标签",
      "优选词，正式主题词",
      "优选词, 正式主题词",
      "Таңдаулы термин",
      "Артыкчылыктуу термин",
      "Истилоҳи афзал",
      "Ileri tutulýan termin",
      "Afzal atama"
    ]);

  function caalNotationProperty() {
    const conceptUri =
      caalCurrentConceptUri();

    const conceptId =
      caalConceptIdFromUri(
        conceptUri
      );

    return [
      ...document.querySelectorAll(
        ".property"
      )
    ].find((property) => {
      if (
        property.classList.contains(
          "caal-preferred-label-property"
        )
      ) {
        return false;
      }

      const heading =
        property
          .querySelector(
            ".property-label h2"
          )
          ?.textContent
          .trim();

      const value =
        property
          .querySelector(
            ".property-value"
          )
          ?.textContent
          .trim();

      return (
        heading === "Notation" ||
        (
          conceptId &&
          value === conceptId
        )
      );
    }) || null;
  }

  function caalNativePreferredLabelProperty() {
    const properties = [
      ...document.querySelectorAll(
        ".property"
      )
    ];

    const byHeading =
      properties.find((property) => {
        if (
          property.classList.contains(
            "caal-preferred-label-property"
          )
        ) {
          return false;
        }

        const heading =
          property
            .querySelector(
              ".property-label h2"
            )
            ?.textContent
            .trim();

        return (
          heading &&
          caalNativePreferredLabelHeadings
            .has(heading)
        );
      });

    if (byHeading) {
      return byHeading;
    }

    /*
     * Skosmos translations can change the heading text. The Preferred term
     * property is immediately before Notation in the normal concept layout,
     * so use that structural relationship as a safe fallback.
     */
    const notation =
      caalNotationProperty();

    const previous =
      notation?.previousElementSibling;

    if (
      previous?.classList?.contains(
        "property"
      ) &&
      !previous.classList.contains(
        "caal-preferred-label-property"
      )
    ) {
      return previous;
    }

    return null;
  }

  function caalPreferredLabelProperty(
    labelText,
    lang,
    requestedLang,
    conceptUri
  ) {
    const property =
      document.createElement("div");

    property.className =
      "property caal-preferred-label-property";

    property.dataset.requestedLang =
      requestedLang || "";

    property.dataset.labelLang =
      lang || "";

    property.dataset.conceptUri =
      conceptUri || "";

    const label =
      document.createElement("div");

    label.className =
      "property-label";

    const h2 =
      document.createElement("h2");

    const languageName =
      caalConceptLanguageNames[
        lang
      ] || lang;

    h2.textContent =
      `Preferred label (${languageName})`;

    label.appendChild(h2);

    const value =
      document.createElement("div");

    value.className =
      "property-value";

    value.setAttribute(
      "lang",
      lang
    );

    value.textContent =
      labelText;

    property.appendChild(label);
    property.appendChild(value);

    return property;
  }

  async function caalFetchPreferredLabel(
    vocabularyId,
    conceptUri,
    requestedLang
  ) {
    const SKOS_NS =
      "http://www.w3.org/2004/02/skos/core#";

    const languages = [
      requestedLang,
      ...caalConceptLanguageOrder
        .filter(
          (lang) =>
            lang !== requestedLang
        )
    ];

    for (const requestLang of languages) {
      const url =
        `/rest/v1/${
          encodeURIComponent(
            vocabularyId
          )
        }/data?uri=${
          encodeURIComponent(
            conceptUri
          )
        }&format=${
          encodeURIComponent(
            "application/rdf+xml"
          )
        }&lang=${
          encodeURIComponent(
            requestLang
          )
        }`;

      try {
        const response =
          await fetch(
            url,
            {
              cache: "no-store",
              headers: {
                Accept:
                  "application/rdf+xml"
              }
            }
          );

        if (!response.ok) {
          continue;
        }

        const rdfXml =
          await response.text();

        const xml =
          new DOMParser()
            .parseFromString(
              rdfXml,
              "application/xml"
            );

        if (
          xml.querySelector(
            "parsererror"
          )
        ) {
          continue;
        }

        const labels =
          caalRdfXmlLiteralValues(
            xml,
            conceptUri,
            SKOS_NS,
            "prefLabel"
          )
            .filter(
              (row) =>
                row.lang &&
                row.text
            );

        const exact =
          labels.find(
            (row) =>
              row.lang ===
              requestedLang
          );

        if (exact) {
          return exact;
        }

        if (labels.length) {
          return labels[0];
        }
      } catch {
        /* Try the next configured language. */
      }
    }

    return null;
  }

  async function caalRenderPreferredLabel() {
    const conceptUri =
      caalCurrentConceptUri();

    const vocabularyId =
      caalCurrentVocabularyId();

    const requestedLang =
      caalCurrentUiLanguage();

    if (
      !conceptUri ||
      !vocabularyId
    ) {
      return;
    }

    const existing =
      document.querySelector(
        ".caal-preferred-label-property"
      );

    const nativeProperty =
      caalNativePreferredLabelProperty();

    if (
      existing &&
      !nativeProperty &&
      existing.dataset.conceptUri ===
        conceptUri &&
      existing.dataset.requestedLang ===
        requestedLang
    ) {
      return;
    }

    const requestId =
      ++caalPreferredLabelRequestId;

    const result =
      await caalFetchPreferredLabel(
        vocabularyId,
        conceptUri,
        requestedLang
      );

    if (
      requestId !==
        caalPreferredLabelRequestId ||
      !result?.text
    ) {
      return;
    }

    const replacement =
      caalPreferredLabelProperty(
        result.text,
        result.lang,
        requestedLang,
        conceptUri
      );

    const currentCustom =
      document.querySelector(
        ".caal-preferred-label-property"
      );

    const currentNative =
      caalNativePreferredLabelProperty();

    if (
      currentNative?.parentNode
    ) {
      currentCustom?.remove();

      currentNative.replaceWith(
        replacement
      );

      return;
    }

    if (
      currentCustom?.parentNode
    ) {
      currentCustom.replaceWith(
        replacement
      );

      return;
    }

    const notationProperty =
      caalNotationProperty();

    if (
      notationProperty?.parentNode
    ) {
      notationProperty.parentNode
        .insertBefore(
          replacement,
          notationProperty
        );
    }
  }

  function caalSchedulePreferredLabelRender() {
    window.clearTimeout(
      caalPreferredLabelRenderTimer
    );

    caalPreferredLabelRenderTimer =
      window.setTimeout(
        caalRenderPreferredLabel,
        80
      );
  }

  function caalConceptIdFromUri(uri) {
    try {
      const parsed =
        new URL(uri);

      const parts =
        parsed.pathname
          .split("/")
          .filter(Boolean);

      return (
        decodeURIComponent(
          parts[parts.length - 1] || ""
        )
      );
    } catch {
      return (
        String(uri || "")
          .split("/")
          .filter(Boolean)
          .pop() || ""
      );
    }
  }

  function caalConceptPageHref(
    vocabularyId,
    lang,
    uri
  ) {
    const conceptId =
      caalConceptIdFromUri(uri);

    return (
      `/${encodeURIComponent(
        vocabularyId
      )}/${encodeURIComponent(
        lang
      )}/page/${encodeURIComponent(
        conceptId
      )}`
    );
  }

  async function caalFetchJson(url) {
    const response =
      await fetch(
        url,
        {
          cache: "no-store",
          headers: {
            Accept: "application/json"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `Skosmos hierarchy request failed: ${response.status}`
      );
    }

    return response.json();
  }

  async function caalFetchHierarchyLabel(
    vocabularyId,
    uri,
    lang
  ) {
    const url =
      `/rest/v1/${
        encodeURIComponent(vocabularyId)
      }/label?uri=${
        encodeURIComponent(uri)
      }&lang=${
        encodeURIComponent(lang)
      }`;

    const data =
      await caalFetchJson(url);

    return {
      uri,
      prefLabel:
        data.prefLabel ||
        caalConceptIdFromUri(uri)
    };
  }

  async function caalFetchBroaderConcepts(
    vocabularyId,
    uri,
    lang
  ) {
    const url =
      `/rest/v1/${
        encodeURIComponent(vocabularyId)
      }/broader?uri=${
        encodeURIComponent(uri)
      }&lang=${
        encodeURIComponent(lang)
      }`;

    const data =
      await caalFetchJson(url);

    return Array.isArray(data.broader)
      ? data.broader
      : [];
  }

  async function caalFetchNarrowerConcepts(
    vocabularyId,
    uri,
    lang
  ) {
    const url =
      `/rest/v1/${
        encodeURIComponent(vocabularyId)
      }/narrower?uri=${
        encodeURIComponent(uri)
      }&lang=${
        encodeURIComponent(lang)
      }`;

    const data =
      await caalFetchJson(url);

    return Array.isArray(data.narrower)
      ? data.narrower
      : [];
  }

  async function caalHierarchyData(
    vocabularyId,
    conceptUri,
    lang
  ) {
    const current =
      await caalFetchHierarchyLabel(
        vocabularyId,
        conceptUri,
        lang
      );

    /*
     * Levels are collected from current concept upwards:
     *
     *   level 0 = current
     *   level 1 = direct broader
     *   level 2 = broader of broader
     *
     * Multiple broader concepts are retained if a vocabulary is
     * polyhierarchical.
     */
    const upwardLevels =
      [[current]];

    const edges = [];
    const seen =
      new Set([conceptUri]);

    let frontier =
      [current];

    for (
      let depth = 0;
      depth < 12;
      depth += 1
    ) {
      const results =
        await Promise.all(
          frontier.map(
            async (node) => ({
              node,
              broader:
                await caalFetchBroaderConcepts(
                  vocabularyId,
                  node.uri,
                  lang
                )
            })
          )
        );

      const nextByUri =
        new Map();

      results.forEach(
        ({ node, broader }) => {
          broader.forEach(
            (parent) => {
              if (
                !parent?.uri
              ) {
                return;
              }

              edges.push({
                from: parent.uri,
                to: node.uri
              });

              if (
                !seen.has(
                  parent.uri
                )
              ) {
                seen.add(
                  parent.uri
                );

                nextByUri.set(
                  parent.uri,
                  {
                    uri:
                      parent.uri,
                    prefLabel:
                      parent.prefLabel ||
                      caalConceptIdFromUri(
                        parent.uri
                      )
                  }
                );
              }
            }
          );
        }
      );

      const next =
        [...nextByUri.values()];

      if (!next.length) {
        break;
      }

      upwardLevels.push(next);
      frontier = next;
    }

    const narrower =
      await caalFetchNarrowerConcepts(
        vocabularyId,
        conceptUri,
        lang
      );

    const children =
      narrower
        .filter(
          (child) => child?.uri
        )
        .map(
          (child) => ({
            uri: child.uri,
            prefLabel:
              child.prefLabel ||
              caalConceptIdFromUri(
                child.uri
              )
          })
        );

    children.forEach(
      (child) => {
        edges.push({
          from: conceptUri,
          to: child.uri
        });
      }
    );

    const levels =
      upwardLevels
        .slice()
        .reverse();

    if (children.length) {
      levels.push(children);
    }

    return {
      currentUri: conceptUri,
      levels,
      edges,
      children
    };
  }

  function caalHierarchyNodeElement(
    node,
    {
      currentUri,
      vocabularyId,
      lang,
      onExpandChildren
    }
  ) {
    const isCurrent =
      node.uri === currentUri;

    const isMore =
      node.isMore === true;

    const element =
      document.createElement(
        isMore
          ? "button"
          : (
              isCurrent
                ? "div"
                : "a"
            )
      );

    element.className =
      "caal-hierarchy-node";

    if (isCurrent) {
      element.classList.add(
        "is-current"
      );
      element.setAttribute(
        "aria-current",
        "true"
      );
    }

    if (isMore) {
      element.classList.add(
        "is-more"
      );
      element.type = "button";
      element.addEventListener(
        "click",
        onExpandChildren
      );
    } else if (!isCurrent) {
      element.href =
        caalConceptPageHref(
          vocabularyId,
          lang,
          node.uri
        );
    }

    const code =
      document.createElement("span");

    code.className =
      "caal-hierarchy-node__code";

    code.textContent =
      isMore
        ? (node.countLabel || "")
        : caalConceptIdFromUri(
            node.uri
          );

    const label =
      document.createElement("span");

    label.className =
      "caal-hierarchy-node__label";

    label.textContent =
      node.prefLabel ||
      caalConceptIdFromUri(
        node.uri
      );

    element.appendChild(code);
    element.appendChild(label);

    return element;
  }

  function caalHierarchyProperty(
    data,
    vocabularyId,
    lang
  ) {
    const property =
      document.createElement("div");

    property.className =
      "property caal-hierarchy-property";

    const label =
      document.createElement("div");

    label.className =
      "property-label";

    const h2 =
      document.createElement("h2");

    h2.textContent =
      caalUi("hierarchy");

    label.appendChild(h2);

    const value =
      document.createElement("div");

    value.className =
      "property-value";

    const scroll =
      document.createElement("div");

    scroll.className =
      "caal-hierarchy-scroll";

    const canvas =
      document.createElement("div");

    canvas.className =
      "caal-hierarchy-canvas";

    /*
     * More compact than Phase 3.11. This keeps the visual tree while reducing
     * the amount of horizontal/vertical space consumed by ordinary concepts.
     */
    const nodeWidth = 154;
    const nodeHeight = 48;
    const horizontalGap = 12;
    const verticalGap = 30;
    const sidePadding = 10;
    const topPadding = 6;

    const allChildren =
      Array.isArray(data.children)
        ? data.children
        : [];

    const isExpanded =
      caalExpandedHierarchyChildren.has(
        data.currentUri
      );

    const maxCollapsedChildren = 5;

    let visualChildren =
      allChildren;

    let moreNode = null;

    if (
      allChildren.length >
        maxCollapsedChildren &&
      !isExpanded
    ) {
      const shownCount =
        maxCollapsedChildren - 1;

      const hiddenCount =
        allChildren.length -
        shownCount;

      visualChildren =
        allChildren.slice(
          0,
          shownCount
        );

      moreNode = {
        uri:
          `__caal_more__${
            data.currentUri
          }`,
        prefLabel:
          `+ ${hiddenCount} more`,
        countLabel:
          `${allChildren.length} narrower`,
        isMore: true
      };

      visualChildren.push(
        moreNode
      );
    }

    const levels =
      data.levels.map(
        (level) => level.slice()
      );

    /*
     * The final level is the current concept's direct narrower concepts.
     * Substitute the compact/collapsed visual row only; ancestor levels are
     * untouched.
     */
    if (allChildren.length) {
      levels[levels.length - 1] =
        visualChildren;
    }

    const maxNodes =
      Math.max(
        1,
        ...levels.map(
          (level) => level.length
        )
      );

    const width =
      Math.max(
        360,
        (
          maxNodes * nodeWidth
        ) +
        (
          Math.max(
            0,
            maxNodes - 1
          ) * horizontalGap
        ) +
        (
          sidePadding * 2
        )
      );

    const height =
      (
        levels.length *
        nodeHeight
      ) +
      (
        Math.max(
          0,
          levels.length - 1
        ) * verticalGap
      ) +
      (
        topPadding * 2
      );

    canvas.style.width =
      `${width}px`;

    canvas.style.height =
      `${height}px`;

    const svg =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );

    svg.setAttribute(
      "class",
      "caal-hierarchy-lines"
    );

    svg.setAttribute(
      "width",
      String(width)
    );

    svg.setAttribute(
      "height",
      String(height)
    );

    svg.setAttribute(
      "viewBox",
      `0 0 ${width} ${height}`
    );

    canvas.appendChild(svg);

    const positions =
      new Map();

    const expandChildren =
      () => {
        caalExpandedHierarchyChildren.add(
          data.currentUri
        );

        caalScheduleConceptPageRender(true);
      };

    levels.forEach(
      (level, levelIndex) => {
        const rowWidth =
          (
            level.length *
            nodeWidth
          ) +
          (
            Math.max(
              0,
              level.length - 1
            ) * horizontalGap
          );

        const rowStart =
          (width - rowWidth) / 2;

        const top =
          topPadding +
          (
            levelIndex *
            (
              nodeHeight +
              verticalGap
            )
          );

        level.forEach(
          (node, nodeIndex) => {
            const left =
              rowStart +
              (
                nodeIndex *
                (
                  nodeWidth +
                  horizontalGap
                )
              );

            positions.set(
              node.uri,
              {
                x:
                  left +
                  (
                    nodeWidth / 2
                  ),
                yTop: top,
                yBottom:
                  top +
                  nodeHeight
              }
            );

            const element =
              caalHierarchyNodeElement(
                node,
                {
                  currentUri:
                    data.currentUri,
                  vocabularyId,
                  lang,
                  onExpandChildren:
                    expandChildren
                }
              );

            element.style.left =
              `${left}px`;

            element.style.top =
              `${top}px`;

            element.style.width =
              `${nodeWidth}px`;

            element.style.height =
              `${nodeHeight}px`;

            canvas.appendChild(
              element
            );
          }
        );
      }
    );

    const visualEdges =
      data.edges.filter(
        ({ from, to }) =>
          positions.has(from) &&
          positions.has(to)
      );

    if (moreNode) {
      visualEdges.push({
        from: data.currentUri,
        to: moreNode.uri
      });
    }

    visualEdges.forEach(
      ({ from, to }) => {
        const parent =
          positions.get(from);

        const child =
          positions.get(to);

        if (
          !parent ||
          !child
        ) {
          return;
        }

        const midY =
          (
            parent.yBottom +
            child.yTop
          ) / 2;

        const path =
          document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
          );

        path.setAttribute(
          "class",
          "caal-hierarchy-edge"
        );

        path.setAttribute(
          "d",
          [
            `M ${parent.x} ${parent.yBottom}`,
            `L ${parent.x} ${midY}`,
            `L ${child.x} ${midY}`,
            `L ${child.x} ${child.yTop}`
          ].join(" ")
        );

        svg.appendChild(path);
      }
    );

    scroll.appendChild(canvas);
    value.appendChild(scroll);

    if (
      isExpanded &&
      allChildren.length >
        maxCollapsedChildren
    ) {
      const collapseButton =
        document.createElement("button");

      collapseButton.type = "button";
      collapseButton.textContent =
        "Show fewer";

      collapseButton.style.display =
        "block";
      collapseButton.style.margin =
        "0.3rem auto 0";
      collapseButton.style.padding =
        "0.25rem 0.65rem";
      collapseButton.style.border =
        "1px solid #cbd3da";
      collapseButton.style.borderRadius =
        "4px";
      collapseButton.style.background =
        "#f8f9fa";
      collapseButton.style.cursor =
        "pointer";
      collapseButton.style.fontSize =
        "0.78rem";

      collapseButton.addEventListener(
        "click",
        () => {
          caalExpandedHierarchyChildren.delete(
            data.currentUri
          );

          caalScheduleConceptPageRender(true);
        }
      );

      value.appendChild(
        collapseButton
      );
    }

    property.appendChild(label);
    property.appendChild(value);

    return property;
  }

  function caalHierarchyInsertAnchor() {
    const otherLanguages =
      document
        .querySelector(
          "#concept-other-languages"
        )
        ?.closest(".property");

    if (otherLanguages) {
      return otherLanguages;
    }

    const definition =
      document.querySelector(
        ".caal-definition-property"
      );

    if (definition) {
      return definition;
    }

    return (
      caalCurrentConceptUriProperty()
    );
  }

  async function caalRenderHierarchy() {
    const conceptUri =
      caalCurrentConceptUri();

    const vocabularyId =
      caalCurrentVocabularyId();

    const lang =
      caalCurrentUiLanguage();

    caalRemoveNativeHierarchyProperties();

    if (
      !conceptUri ||
      !vocabularyId
    ) {
      return;
    }

    const requestId =
      ++caalHierarchyRequestId;

    try {
      const data =
        await caalHierarchyData(
          vocabularyId,
          conceptUri,
          lang
        );

      if (
        requestId !==
        caalHierarchyRequestId
      ) {
        return;
      }

      const anchor =
        caalHierarchyInsertAnchor();

      if (
        !anchor?.parentNode
      ) {
        return;
      }

      const property =
        caalHierarchyProperty(
          data,
          vocabularyId,
          lang
        );

      anchor.parentNode.insertBefore(
        property,
        anchor
      );
    } catch (error) {
      console.warn(
        "CAAL hierarchy graph failed:",
        error
      );
    }
  }

  function caalScheduleHierarchyRender() {
    window.clearTimeout(
      caalHierarchyRenderTimer
    );

    caalHierarchyRenderTimer =
      window.setTimeout(
        () => {
          if (
            !document.querySelector(
              ".caal-hierarchy-property"
            )
          ) {
            caalRenderHierarchy();
          }
        },
        80
      );
  }


  /* ------------------------------------------------------------------
   * Phase 3.13 - unified, collapsible concept presentation
   * ------------------------------------------------------------------
   *
   * Skosmos remains the browser and REST/RDF provider, but the visible
   * concept body is assembled here from standard SKOS + DCTERMS data.
   * Native Skosmos properties are kept in the DOM (hidden) so URI/state
   * discovery still works when Skosmos redraws the page.
   */

  let caalConceptPageRequestId = 0;
  let caalConceptPageRenderTimer = null;

  const caalConceptSectionState = new Map();

  const caalConceptUi = {
    en: {
      labels: "Labels",
      definition: "Definition",
      scopeNotes: "Scope notes",
      hierarchy: "Hierarchy",
      uriDownloads: "URI and downloads",
      relations: "Related and mapped concepts",
      bibliography: "Bibliography",
      preferred: "Preferred",
      alternative: "Alternative",
      label: "Label",
      language: "Language",
      type: "Type",
      notation: "Notation",
      uri: "URI",
      downloads: "Downloads",
      related: "Related concepts",
      mappings: "Mappings",
      source: "Source",
      sources: "Sources",
      reference: "Reference",
      references: "References",
      exactMatch: "Exact match",
      closeMatch: "Close match",
      broadMatch: "Broad match",
      narrowMatch: "Narrow match",
      relatedMatch: "Related match",
      noDefinitions: "No definitions.",
      noScopeNotes: "No scope notes.",
      noHierarchy: "No broader or narrower concepts.",
      noRelations: "No related or mapped concepts.",
      noBibliography: "No bibliography entries.",
      path: "path",
      paths: "paths",
      copyUri: "Copy concept URI"
    },
    ru: {
      labels: "Метки",
      definition: "Определение",
      scopeNotes: "Примечания по области применения",
      hierarchy: "Иерархия",
      uriDownloads: "URI и загрузки",
      relations: "Связанные и сопоставленные понятия",
      bibliography: "Библиография",
      preferred: "Предпочтительная",
      alternative: "Альтернативная",
      label: "Метка",
      language: "Язык",
      type: "Тип",
      notation: "Нотация",
      uri: "URI",
      downloads: "Загрузки",
      related: "Связанные понятия",
      mappings: "Сопоставления",
      source: "Источник",
      sources: "Источники",
      reference: "Литература",
      references: "Литература",
      exactMatch: "Точное соответствие",
      closeMatch: "Близкое соответствие",
      broadMatch: "Широкое соответствие",
      narrowMatch: "Узкое соответствие",
      relatedMatch: "Связанное соответствие",
      noDefinitions: "Определения отсутствуют.",
      noScopeNotes: "Примечания отсутствуют.",
      noHierarchy: "Более широкие или узкие понятия отсутствуют.",
      noRelations: "Связанные или сопоставленные понятия отсутствуют.",
      noBibliography: "Библиографические записи отсутствуют.",
      path: "путь",
      paths: "пути",
      copyUri: "Копировать URI понятия"
    },
    zh: {
      labels: "标签",
      definition: "定义",
      scopeNotes: "范围注释",
      hierarchy: "层级结构",
      uriDownloads: "URI 和下载",
      relations: "相关和映射概念",
      bibliography: "参考文献",
      preferred: "首选",
      alternative: "备选",
      label: "标签",
      language: "语言",
      type: "类型",
      notation: "记号",
      uri: "URI",
      downloads: "下载",
      related: "相关概念",
      mappings: "映射",
      source: "来源",
      sources: "来源",
      reference: "参考文献",
      references: "参考文献",
      exactMatch: "精确匹配",
      closeMatch: "近似匹配",
      broadMatch: "广义匹配",
      narrowMatch: "狭义匹配",
      relatedMatch: "相关匹配",
      noDefinitions: "没有定义。",
      noScopeNotes: "没有范围注释。",
      noHierarchy: "没有上位或下位概念。",
      noRelations: "没有相关或映射概念。",
      noBibliography: "没有参考文献记录。",
      path: "路径",
      paths: "路径",
      copyUri: "复制概念 URI"
    }
  };

  function caalConceptText(key) {
    const lang = caalCurrentUiLanguage();

    return (
      caalConceptUi[lang]?.[key] ||
      caalConceptUi.en[key] ||
      key
    );
  }

  function caalInjectConceptPageStyles() {
    if (
      document.getElementById(
        "caal-phase313-concept-styles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "caal-phase313-concept-styles";

    style.textContent = `
      .caal-native-concept-property {
        display: none !important;
      }

      .caal-concept-identity {
        padding: 0.9rem 1rem 1.15rem;
        border-bottom: 1px solid #d7dee5;
      }

      .caal-concept-identity__top {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }

      .caal-concept-identity__label {
        margin: 0;
        color: #10284e;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(1.75rem, 3vw, 2.65rem);
        font-weight: 700;
        line-height: 1.1;
      }

      .caal-concept-identity__notation {
        margin-top: 0.35rem;
        color: #10284e;
        font-size: 1.05rem;
        line-height: 1.3;
      }

      .caal-concept-copy {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        padding: 0;
        border: 0;
        background: transparent;
        color: #10284e;
        cursor: pointer;
      }

      .caal-concept-copy svg {
        width: 1.45rem;
        height: 1.45rem;
      }

      .caal-concept-sections {
        width: 100%;
      }

      details.caal-concept-section {
        display: block;
        margin: 0;
        padding: 0;
        border: 0;
        border-bottom: 1px solid #d7dee5;
      }

      details.caal-concept-section > summary {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        min-height: 3rem;
        padding: 0.55rem 1rem;
        color: #10284e;
        cursor: pointer;
        list-style: none;
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 1.25;
      }

      details.caal-concept-section > summary::-webkit-details-marker {
        display: none;
      }

      details.caal-concept-section > summary::before {
        content: "›";
        display: inline-block;
        width: 0.8rem;
        font-size: 1.45rem;
        font-weight: 400;
        line-height: 1;
        transform-origin: 45% 50%;
        transition: transform 120ms ease;
      }

      details.caal-concept-section[open] > summary::before {
        transform: rotate(90deg);
      }

      .caal-concept-section__title {
        flex: 1 1 auto;
      }

      .caal-concept-section__meta {
        flex: 0 0 auto;
        padding: 0.08rem 0.45rem;
        border-radius: 999px;
        background: #f1f4f6;
        color: #5e6b75;
        font-size: 0.78rem;
        font-weight: 600;
        line-height: 1.45;
      }

      .caal-concept-section__body {
        padding: 0.25rem 1rem 1rem 2.35rem;
      }

      .caal-section-empty {
        margin: 0.2rem 0;
        color: #6c757d;
      }

      .caal-label-grid,
      .caal-relation-grid {
        width: 100%;
      }

      .caal-label-grid__header,
      .caal-label-row {
        display: grid;
        grid-template-columns: minmax(220px, 1.7fr) minmax(120px, 0.65fr) minmax(105px, 0.55fr);
        column-gap: 1rem;
        align-items: start;
      }

      .caal-label-grid__header {
        padding: 0 0 0.35rem;
        border-bottom: 1px solid #e2e7eb;
        color: #65717b;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .caal-label-row {
        padding: 0.35rem 0;
        border-bottom: 1px solid #eef1f3;
        line-height: 1.35;
      }

      .caal-label-row__label {
        color: #17345d;
        font-weight: 600;
      }

      .caal-label-row__language,
      .caal-label-row__type {
        color: #364554;
      }

      .caal-definition-list,
      .caal-scope-list,
      .caal-bibliography-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .caal-concept-definition-row,
      .caal-concept-scope-row {
        display: grid;
        grid-template-columns: 165px minmax(0, 1fr);
        column-gap: 1rem;
        align-items: start;
        margin: 0;
        padding: 0.12rem 0;
        line-height: 1.35;
      }

      .caal-concept-language {
        font-weight: 700;
      }

      .caal-concept-hierarchy-body .property-value {
        width: 100%;
      }

      .caal-concept-hierarchy-body .caal-hierarchy-scroll {
        margin: 0;
      }

      .caal-technical-grid {
        display: grid;
        grid-template-columns: 145px minmax(0, 1fr);
        column-gap: 1rem;
        row-gap: 0.5rem;
        align-items: start;
      }

      .caal-technical-grid__label {
        font-weight: 700;
      }

      .caal-technical-grid__value {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .caal-download-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem 0.8rem;
      }

      .caal-relation-group + .caal-relation-group,
      .caal-bibliography-group + .caal-bibliography-group {
        margin-top: 1rem;
      }

      .caal-relation-group h3,
      .caal-bibliography-group h3,
      .caal-definition-scope-notes h3 {
        margin: 0 0 0.4rem;
        color: #10284e;
        font-size: 1rem;
        font-weight: 700;
      }

      .caal-relation-row {
        display: grid;
        grid-template-columns: minmax(220px, 1.5fr) minmax(130px, 0.65fr) minmax(90px, 0.45fr);
        column-gap: 1rem;
        align-items: start;
        padding: 0.3rem 0;
        border-bottom: 1px solid #eef1f3;
      }

      .caal-relation-row__label {
        font-weight: 600;
      }

      .caal-relation-row__relation,
      .caal-relation-row__authority {
        color: #5b6873;
      }

      .caal-concept-section .caal-bibliography-row {
        padding: 0.35rem 0;
      }

      @media (max-width: 767px) {
        .caal-concept-identity {
          padding-left: 0.5rem;
          padding-right: 0.5rem;
        }

        details.caal-concept-section > summary {
          padding-left: 0.5rem;
          padding-right: 0.5rem;
        }

        .caal-concept-section__body {
          padding-left: 1.85rem;
          padding-right: 0.5rem;
        }

        .caal-label-grid__header {
          display: none;
        }

        .caal-label-row,
        .caal-relation-row {
          grid-template-columns: 1fr;
          row-gap: 0.08rem;
        }

        .caal-label-row__language,
        .caal-label-row__type,
        .caal-relation-row__relation,
        .caal-relation-row__authority {
          font-size: 0.82rem;
        }

        .caal-concept-definition-row,
        .caal-concept-scope-row,
        .caal-technical-grid {
          grid-template-columns: 1fr;
          row-gap: 0.1rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function caalConceptSectionKey(
    conceptUri,
    sectionKey
  ) {
    return `${conceptUri}::${sectionKey}`;
  }

  function caalCreateConceptSection({
    conceptUri,
    key,
    title,
    meta = "",
    populated = false,
    body
  }) {
    const details =
      document.createElement("details");

    details.className =
      `property caal-concept-section caal-concept-section--${key}`;

    const stateKey =
      caalConceptSectionKey(
        conceptUri,
        key
      );

    details.open =
      caalConceptSectionState.has(
        stateKey
      )
        ? caalConceptSectionState.get(
            stateKey
          )
        : Boolean(populated);

    details.addEventListener(
      "toggle",
      () => {
        caalConceptSectionState.set(
          stateKey,
          details.open
        );
      }
    );

    const summary =
      document.createElement("summary");

    const titleEl =
      document.createElement("span");

    titleEl.className =
      "caal-concept-section__title";

    titleEl.textContent = title;

    summary.appendChild(titleEl);

    if (
      meta !== "" &&
      meta !== null &&
      meta !== undefined
    ) {
      const metaEl =
        document.createElement("span");

      metaEl.className =
        "caal-concept-section__meta";

      metaEl.textContent =
        String(meta);

      summary.appendChild(metaEl);
    }

    const bodyEl =
      document.createElement("div");

    bodyEl.className =
      "caal-concept-section__body";

    if (body) {
      bodyEl.appendChild(body);
    }

    details.appendChild(summary);
    details.appendChild(bodyEl);

    return details;
  }

  function caalEmptySectionMessage(text) {
    const p = document.createElement("p");
    p.className = "caal-section-empty";
    p.textContent = text;
    return p;
  }

  async function caalCopyText(text) {
    try {
      await navigator.clipboard.writeText(
        text
      );
      return;
    } catch {
      /* Fall back for non-secure/local contexts. */
    }

    const textarea =
      document.createElement("textarea");

    textarea.value = text;
    textarea.setAttribute(
      "readonly",
      ""
    );
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand("copy");
    } catch {
      /* No further fallback required. */
    }

    textarea.remove();
  }

  function caalBuildConceptIdentity(
    conceptUri,
    preferredLabel,
    notation,
    lang
  ) {
    const identity =
      document.createElement("div");

    identity.className =
      "caal-concept-identity";

    const top =
      document.createElement("div");

    top.className =
      "caal-concept-identity__top";

    const title =
      document.createElement("h1");

    title.className =
      "caal-concept-identity__label";

    if (lang) {
      title.setAttribute(
        "lang",
        lang
      );
    }

    title.textContent =
      preferredLabel;

    const copy =
      document.createElement("button");

    copy.type = "button";
    copy.className =
      "caal-concept-copy";
    copy.title =
      caalConceptText("copyUri");
    copy.setAttribute(
      "aria-label",
      caalConceptText("copyUri")
    );

    copy.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 7.5V5.8C8 4.25 9.25 3 10.8 3h6.4C18.75 3 20 4.25 20 5.8v9.4c0 1.55-1.25 2.8-2.8 2.8h-1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="4" y="7" width="11" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    `;

    copy.addEventListener(
      "click",
      () => caalCopyText(
        conceptUri
      )
    );

    const notationEl =
      document.createElement("div");

    notationEl.className =
      "caal-concept-identity__notation";

    notationEl.textContent =
      notation;

    top.appendChild(title);
    top.appendChild(copy);
    identity.appendChild(top);
    identity.appendChild(notationEl);

    return identity;
  }

  async function caalFetchConceptXml(
    vocabularyId,
    conceptUri,
    lang = ""
  ) {
    const langPart = lang
      ? `&lang=${encodeURIComponent(lang)}`
      : "";

    const url =
      `/rest/v1/${
        encodeURIComponent(vocabularyId)
      }/data?uri=${
        encodeURIComponent(conceptUri)
      }&format=${
        encodeURIComponent(
          "application/rdf+xml"
        )
      }${langPart}`;

    try {
      const response = await fetch(
        url,
        {
          cache: "no-store",
          headers: {
            Accept: "application/rdf+xml"
          }
        }
      );

      if (!response.ok) {
        return null;
      }

      const rdfXml =
        await response.text();

      const xml =
        new DOMParser().parseFromString(
          rdfXml,
          "application/xml"
        );

      return xml.querySelector("parsererror")
        ? null
        : xml;
    } catch {
      return null;
    }
  }

  async function caalFetchConceptLanguageXmls(
    vocabularyId,
    conceptUri
  ) {
    const rows = await Promise.all(
      caalConceptLanguageOrder.map(
        async (lang) => ({
          lang,
          xml: await caalFetchConceptXml(
            vocabularyId,
            conceptUri,
            lang
          )
        })
      )
    );

    return rows.filter(
      (row) => row.xml
    );
  }

  function caalCollectLiteralRows(
    xmlRows,
    conceptUri,
    predicateLocalName
  ) {
    const SKOS_NS =
      "http://www.w3.org/2004/02/skos/core#";

    const seen = new Set();
    const result = [];

    xmlRows.forEach(({ xml }) => {
      caalRdfXmlLiteralValues(
        xml,
        conceptUri,
        SKOS_NS,
        predicateLocalName
      ).forEach(({ lang, text }) => {
        const code = String(lang || "")
          .toLowerCase()
          .split("-")[0];

        const clean =
          String(text || "").trim();

        if (!clean) return;

        const key =
          `${code}\u0000${clean}`;

        if (seen.has(key)) return;

        seen.add(key);
        result.push({
          lang: code,
          text: clean
        });
      });
    });

    return result.sort((a, b) => {
      const langDiff =
        caalLanguageRank(a.lang) -
        caalLanguageRank(b.lang);

      if (langDiff !== 0) {
        return langDiff;
      }

      return a.text.localeCompare(
        b.text
      );
    });
  }

  function caalRdfXmlResourceValuesNs(
    xml,
    subjectUri,
    namespaceUri,
    predicateLocalName
  ) {
    if (!xml) return [];

    const RDF_NS =
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

    const values = [];

    [...xml.getElementsByTagName("*")]
      .forEach((element) => {
        const about =
          element.getAttributeNS(
            RDF_NS,
            "about"
          ) ||
          element.getAttribute(
            "rdf:about"
          );

        if (about !== subjectUri) {
          return;
        }

        [...element.children]
          .forEach((child) => {
            if (
              child.namespaceURI !==
                namespaceUri ||
              child.localName !==
                predicateLocalName
            ) {
              return;
            }

            const resource =
              child.getAttributeNS(
                RDF_NS,
                "resource"
              ) ||
              child.getAttribute(
                "rdf:resource"
              );

            if (resource) {
              values.push(resource);
            }
          });
      });

    return [...new Set(values)];
  }

  function caalPreferredLabelForLanguage(
    preferredLabels,
    requestedLang
  ) {
    return (
      preferredLabels.find(
        (row) =>
          row.lang === requestedLang
      ) ||
      preferredLabels.find(
        (row) => row.lang === "en"
      ) ||
      preferredLabels[0] ||
      null
    );
  }

  function caalNotationFromXml(
    xml,
    conceptUri
  ) {
    if (!xml) {
      return caalConceptIdFromUri(
        conceptUri
      );
    }

    const SKOS_NS =
      "http://www.w3.org/2004/02/skos/core#";

    const rows =
      caalRdfXmlLiteralValues(
        xml,
        conceptUri,
        SKOS_NS,
        "notation"
      );

    return (
      rows[0]?.text ||
      caalConceptIdFromUri(
        conceptUri
      )
    );
  }

  function caalBuildLabelsBody(
    preferredLabels,
    alternativeLabels
  ) {
    const wrap =
      document.createElement("div");

    wrap.className =
      "caal-label-grid";

    const header =
      document.createElement("div");

    header.className =
      "caal-label-grid__header";

    [
      caalConceptText("label"),
      caalConceptText("language"),
      caalConceptText("type")
    ].forEach((text) => {
      const cell =
        document.createElement("span");
      cell.textContent = text;
      header.appendChild(cell);
    });

    wrap.appendChild(header);

    const rows = [
      ...preferredLabels.map(
        (row) => ({
          ...row,
          type: "preferred"
        })
      ),
      ...alternativeLabels.map(
        (row) => ({
          ...row,
          type: "alternative"
        })
      )
    ].sort((a, b) => {
      const langDiff =
        caalLanguageRank(a.lang) -
        caalLanguageRank(b.lang);

      if (langDiff !== 0) {
        return langDiff;
      }

      const typeDiff =
        (a.type === "preferred" ? 0 : 1) -
        (b.type === "preferred" ? 0 : 1);

      if (typeDiff !== 0) {
        return typeDiff;
      }

      return a.text.localeCompare(
        b.text
      );
    });

    rows.forEach((row) => {
      const item =
        document.createElement("div");

      item.className =
        "caal-label-row";

      const label =
        document.createElement("span");
      label.className =
        "caal-label-row__label";
      label.textContent = row.text;
      if (row.lang) {
        label.setAttribute(
          "lang",
          row.lang
        );
      }

      const language =
        document.createElement("span");
      language.className =
        "caal-label-row__language";
      language.textContent =
        caalConceptLanguageNames[
          row.lang
        ] || row.lang || "-";

      const type =
        document.createElement("span");
      type.className =
        "caal-label-row__type";
      type.textContent =
        row.type === "preferred"
          ? caalConceptText(
              "preferred"
            )
          : caalConceptText(
              "alternative"
            );

      item.appendChild(label);
      item.appendChild(language);
      item.appendChild(type);
      wrap.appendChild(item);
    });

    return wrap;
  }

  function caalBuildLanguageTextBody(
    rows,
    classStem,
    emptyText
  ) {
    if (!rows.length) {
      return caalEmptySectionMessage(
        emptyText
      );
    }

    const list =
      document.createElement("ul");

    list.className =
      `${classStem}-list`;

    rows.forEach(({ lang, text }) => {
      const item =
        document.createElement("li");

      item.className =
        classStem === "caal-definition"
          ? "caal-concept-definition-row"
          : "caal-concept-scope-row";

      const language =
        document.createElement("span");

      language.className =
        "caal-concept-language";

      language.textContent =
        caalConceptLanguageNames[
          lang
        ] || lang || "-";

      const value =
        document.createElement("span");

      if (lang) {
        value.setAttribute(
          "lang",
          lang
        );
      }

      value.textContent = text;

      item.appendChild(language);
      item.appendChild(value);
      list.appendChild(item);
    });

    return list;
  }

  function caalBuildDefinitionBody(
    definitions,
    scopeNotes
  ) {
    const wrap =
      document.createElement("div");

    if (definitions.length) {
      wrap.appendChild(
        caalBuildLanguageTextBody(
          definitions,
          "caal-definition",
          caalConceptText(
            "noDefinitions"
          )
        )
      );
    } else {
      wrap.appendChild(
        caalEmptySectionMessage(
          caalConceptText(
            "noDefinitions"
          )
        )
      );
    }

    if (scopeNotes.length) {
      const notes =
        document.createElement("div");

      notes.className =
        "caal-definition-scope-notes";

      const h3 =
        document.createElement("h3");

      h3.textContent =
        caalConceptText(
          "scopeNotes"
        );

      notes.appendChild(h3);
      notes.appendChild(
        caalBuildLanguageTextBody(
          scopeNotes,
          "caal-scope",
          caalConceptText(
            "noScopeNotes"
          )
        )
      );

      wrap.appendChild(notes);
    }

    return wrap;
  }

  function caalHierarchyPathCount(data) {
    const parentsByChild = new Map();

    (data?.edges || []).forEach(
      ({ from, to }) => {
        if (
          !from ||
          !to ||
          from.startsWith(
            "__caal_more__"
          ) ||
          to.startsWith(
            "__caal_more__"
          )
        ) {
          return;
        }

        if (
          !parentsByChild.has(to)
        ) {
          parentsByChild.set(
            to,
            new Set()
          );
        }

        parentsByChild.get(to).add(
          from
        );
      }
    );

    const memo = new Map();

    function count(uri, visiting) {
      if (memo.has(uri)) {
        return memo.get(uri);
      }

      if (visiting.has(uri)) {
        return 0;
      }

      const parents =
        [...(
          parentsByChild.get(uri) ||
          []
        )];

      if (!parents.length) {
        memo.set(uri, 1);
        return 1;
      }

      const nextVisiting =
        new Set(visiting);
      nextVisiting.add(uri);

      const total = parents.reduce(
        (sum, parent) =>
          sum + count(
            parent,
            nextVisiting
          ),
        0
      );

      memo.set(uri, total || 1);
      return total || 1;
    }

    return count(
      data.currentUri,
      new Set()
    );
  }

  function caalHierarchyHasRelations(data) {
    const children =
      Array.isArray(data?.children)
        ? data.children.length
        : 0;

    const parentEdges =
      (data?.edges || []).some(
        ({ to }) =>
          to === data.currentUri
      );

    return Boolean(
      children || parentEdges
    );
  }

  function caalBuildHierarchyBody(
    data,
    vocabularyId,
    lang
  ) {
    if (!caalHierarchyHasRelations(data)) {
      return caalEmptySectionMessage(
        caalConceptText(
          "noHierarchy"
        )
      );
    }

    const property =
      caalHierarchyProperty(
        data,
        vocabularyId,
        lang
      );

    const value =
      property.querySelector(
        ".property-value"
      );

    const body =
      document.createElement("div");

    body.className =
      "caal-concept-hierarchy-body";

    if (value) {
      body.appendChild(value);
    }

    return body;
  }

  function caalBuildTechnicalBody(
    vocabularyId,
    conceptUri,
    notation
  ) {
    const grid =
      document.createElement("div");

    grid.className =
      "caal-technical-grid";

    function addRow(labelText, value) {
      const label =
        document.createElement("div");
      label.className =
        "caal-technical-grid__label";
      label.textContent = labelText;

      const valueEl =
        document.createElement("div");
      valueEl.className =
        "caal-technical-grid__value";

      if (
        value instanceof Node
      ) {
        valueEl.appendChild(value);
      } else {
        valueEl.textContent =
          String(value || "");
      }

      grid.appendChild(label);
      grid.appendChild(valueEl);
    }

    addRow(
      caalConceptText("notation"),
      notation
    );

    const uriLink =
      document.createElement("a");
    uriLink.href = conceptUri;
    uriLink.textContent = conceptUri;

    addRow(
      caalConceptText("uri"),
      uriLink
    );

    const downloads =
      document.createElement("div");
    downloads.className =
      "caal-download-links";

    [
      ["RDF/XML", "application/rdf+xml", "rdf"],
      ["Turtle", "text/turtle", "ttl"],
      ["JSON-LD", "application/ld+json", "jsonld"]
    ].forEach(
      ([label, format, extension]) => {
        const link =
          document.createElement("a");

        link.href =
          `/rest/v1/${
            encodeURIComponent(
              vocabularyId
            )
          }/data?uri=${
            encodeURIComponent(
              conceptUri
            )
          }&format=${
            encodeURIComponent(
              format
            )
          }`;

        link.textContent = label;
        link.download =
          `${caalConceptIdFromUri(
            conceptUri
          )}.${extension}`;

        downloads.appendChild(link);
      }
    );

    addRow(
      caalConceptText("downloads"),
      downloads
    );

    return grid;
  }

  async function caalFetchResourceLabel(
    uri,
    requestedLang
  ) {
    try {
      const response = await fetch(
        `/rest/v1/data?uri=${
          encodeURIComponent(uri)
        }&format=${
          encodeURIComponent(
            "application/rdf+xml"
          )
        }`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/rdf+xml"
          }
        }
      );

      if (!response.ok) {
        return "";
      }

      const rdfXml =
        await response.text();

      const xml =
        new DOMParser().parseFromString(
          rdfXml,
          "application/xml"
        );

      if (
        xml.querySelector("parsererror")
      ) {
        return "";
      }

      const SKOS_NS =
        "http://www.w3.org/2004/02/skos/core#";

      const labels =
        caalRdfXmlLiteralValues(
          xml,
          uri,
          SKOS_NS,
          "prefLabel"
        );

      return (
        labels.find(
          (row) =>
            row.lang === requestedLang
        )?.text ||
        labels.find(
          (row) => row.lang === "en"
        )?.text ||
        labels[0]?.text ||
        ""
      );
    } catch {
      return "";
    }
  }

  function caalMappingDisplayHref(uri) {
    try {
      const url = new URL(uri);
      const match = url.pathname.match(
        /^\/aatReference\/[^/]+\/page\/(\d+)\/?$/
      );

      if (match) {
        return `https://www.getty.edu/vow/AATFullDisplay?find=&logic=AND&note=&subjectid=${match[1]}`;
      }
    } catch {
      /* Keep the original URI. */
    }

    return uri;
  }

  function caalMappingAuthority(uri) {
    if (
      uri.includes("aatReference/") ||
      uri.includes("vocab.getty.edu/aat/") ||
      uri.includes("getty.edu/")
    ) {
      return "AAT";
    }

    try {
      return new URL(uri).hostname;
    } catch {
      return "";
    }
  }

  async function caalBuildRelationsBody(
    conceptUri,
    vocabularyId,
    requestedLang,
    relatedUris,
    mappings
  ) {
    const wrap =
      document.createElement("div");

    if (
      !relatedUris.length &&
      !mappings.length
    ) {
      return caalEmptySectionMessage(
        caalConceptText(
          "noRelations"
        )
      );
    }

    if (relatedUris.length) {
      const group =
        document.createElement("div");
      group.className =
        "caal-relation-group";

      const h3 =
        document.createElement("h3");
      h3.textContent =
        caalConceptText("related");
      group.appendChild(h3);

      const labels =
        await Promise.all(
          relatedUris.map(
            (uri) =>
              caalFetchResourceLabel(
                uri,
                requestedLang
              )
          )
        );

      relatedUris.forEach(
        (uri, index) => {
          const row =
            document.createElement("div");
          row.className =
            "caal-relation-row";

          const link =
            document.createElement("a");
          link.className =
            "caal-relation-row__label";

          link.href =
            uri.startsWith(
              "https://vocab.uclcaal.org/concept/"
            )
              ? caalConceptPageHref(
                  vocabularyId,
                  requestedLang,
                  uri
                )
              : uri;

          link.textContent =
            labels[index] ||
            caalConceptIdFromUri(uri) ||
            uri;

          const relation =
            document.createElement("span");
          relation.className =
            "caal-relation-row__relation";
          relation.textContent =
            caalConceptText("related");

          const authority =
            document.createElement("span");
          authority.className =
            "caal-relation-row__authority";
          authority.textContent = "";

          row.appendChild(link);
          row.appendChild(relation);
          row.appendChild(authority);
          group.appendChild(row);
        }
      );

      wrap.appendChild(group);
    }

    if (mappings.length) {
      const group =
        document.createElement("div");
      group.className =
        "caal-relation-group";

      const h3 =
        document.createElement("h3");
      h3.textContent =
        caalConceptText("mappings");
      group.appendChild(h3);

      const labels =
        await Promise.all(
          mappings.map(
            (mapping) =>
              caalFetchResourceLabel(
                mapping.uri,
                requestedLang
              )
          )
        );

      mappings.forEach(
        (mapping, index) => {
          const row =
            document.createElement("div");
          row.className =
            "caal-relation-row";

          const link =
            document.createElement("a");
          link.className =
            "caal-relation-row__label";
          link.href =
            caalMappingDisplayHref(
              mapping.uri
            );
          link.target = "_blank";
          link.rel =
            "noopener noreferrer";
          link.textContent =
            labels[index] ||
            caalConceptIdFromUri(
              mapping.uri
            ) ||
            mapping.uri;

          const relation =
            document.createElement("span");
          relation.className =
            "caal-relation-row__relation";
          relation.textContent =
            caalConceptText(
              mapping.type
            );

          const authority =
            document.createElement("span");
          authority.className =
            "caal-relation-row__authority";
          authority.textContent =
            caalMappingAuthority(
              mapping.uri
            );

          row.appendChild(link);
          row.appendChild(relation);
          row.appendChild(authority);
          group.appendChild(row);
        }
      );

      wrap.appendChild(group);
    }

    return wrap;
  }

  async function caalBuildBibliographyBody(
    sources,
    references,
    xml
  ) {
    const wrap =
      document.createElement("div");

    if (
      !sources.length &&
      !references.length
    ) {
      return caalEmptySectionMessage(
        caalConceptText(
          "noBibliography"
        )
      );
    }

    async function addGroup(
      heading,
      uris
    ) {
      if (!uris.length) return;

      const group =
        document.createElement("div");
      group.className =
        "caal-bibliography-group";

      const h3 =
        document.createElement("h3");
      h3.textContent = heading;
      group.appendChild(h3);

      const list =
        document.createElement("ul");
      list.className =
        "caal-bibliography-list";

      const items =
        await Promise.all(
          uris.map(
            (uri) =>
              caalBuildRdfXmlReferenceItem(
                uri,
                xml
              )
          )
        );

      items.forEach(
        (item) =>
          list.appendChild(item)
      );

      group.appendChild(list);
      wrap.appendChild(group);
    }

    await addGroup(
      sources.length === 1
        ? caalConceptText("source")
        : caalConceptText("sources"),
      sources
    );

    await addGroup(
      references.length === 1
        ? caalConceptText("reference")
        : caalConceptText("references"),
      references
    );

    return wrap;
  }

  function caalHideNativeConceptProperties(
    parent,
    identity,
    sections
  ) {
    if (!parent) return;

    [...parent.children].forEach(
      (child) => {
        if (
          child === identity ||
          child === sections
        ) {
          return;
        }

        if (
          child.classList?.contains(
            "property"
          )
        ) {
          child.classList.add(
            "caal-native-concept-property"
          );
        }
      }
    );
  }


  /*
   * Skosmos renders a few concept blocks outside the main property container.
   * Phase 3.13 hid the native properties inside that container, but the native
   * Preferred term and native mapping rows can therefore remain visible above
   * or below the CAAL concept presentation. Hide those globally while leaving
   * the CAAL-rendered sections untouched.
   */
  const caalLegacySkosmosHeadingNames =
    new Set([
      "Preferred term",
      "Preferred label",
      "Exact matching concepts",
      "Closely matching concepts",
      "Broader matching concepts",
      "Narrower matching concepts",
      "Related matching concepts",
      "Related concepts",

      "Предпочитаемый термин",
      "Предпочтительная метка",
      "Точно совпадающие понятия",
      "Близко совпадающие понятия",
      "Более широкие совпадающие понятия",
      "Более узкие совпадающие понятия",
      "Связанные совпадающие понятия",
      "Связанные понятия",

      "首选词",
      "首选标签",
      "优选词，正式主题词",
      "优选词, 正式主题词",
      "精确匹配概念",
      "近似匹配概念",
      "广义匹配概念",
      "狭义匹配概念",
      "相关匹配概念",
      "相关概念"
    ]);

  function caalIsLegacySkosmosHeading(text) {
    const value =
      String(text || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!value) return false;

    if (
      caalLegacySkosmosHeadingNames.has(
        value
      )
    ) {
      return true;
    }

    /*
     * Keep this English fallback deliberately narrow so future Skosmos wording
     * changes such as "Exactly matching concepts" are still caught without
     * accidentally hiding ordinary CAAL headings.
     */
    return (
      /^(?:exact(?:ly)?|close(?:ly)?|broader|narrower|related) matching concepts?$/i
        .test(value)
    );
  }

  function caalLegacySkosmosBlock(
    heading,
    conceptId
  ) {
    const property =
      heading.closest?.(".property");

    if (property) {
      return property;
    }

    /*
     * Some Skosmos concept-page blocks sit outside .property. For Preferred
     * term, walk upwards until the row also contains the concept notation.
     */
    let node = heading.parentElement;

    if (conceptId) {
      for (
        let depth = 0;
        node &&
          node !== document.body &&
          depth < 7;
        depth += 1,
        node = node.parentElement
      ) {
        if (
          node.closest?.(
            ".caal-concept-identity, .caal-concept-sections"
          )
        ) {
          return null;
        }

        const text =
          String(node.textContent || "")
            .replace(/\s+/g, " ")
            .trim();

        if (
          text.includes(conceptId) &&
          text.length < 1200
        ) {
          return node;
        }
      }
    }

    /*
     * Native mapping rows contain a heading plus one or more target links.
     * Use the first reasonably small ancestor containing a link as fallback.
     */
    node = heading.parentElement;

    for (
      let depth = 0;
      node &&
        node !== document.body &&
        depth < 7;
      depth += 1,
      node = node.parentElement
    ) {
      if (
        node.closest?.(
          ".caal-concept-identity, .caal-concept-sections"
        )
      ) {
        return null;
      }

      const text =
        String(node.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

      if (
        node.querySelector?.("a[href]") &&
        text.length < 1200
      ) {
        return node;
      }
    }

    return heading.parentElement || null;
  }

  function caalHideLegacySkosmosConceptBlocks(
    conceptUri = ""
  ) {
    const conceptId =
      caalConceptIdFromUri(conceptUri) ||
      caalConceptIdFromUri(
        caalCurrentConceptUri()
      );

    /*
     * Skosmos does not use one consistent heading element for every
     * concept-page block. Find leaf elements by their exact visible heading
     * text as well as the normal heading/property-label elements.
     */
    const candidates =
      new Set([
        ...document.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, dt, th, .property-label"
        ),
        ...[
          ...document.querySelectorAll(
            "body *"
          )
        ].filter((element) => {
          if (element.children.length) {
            return false;
          }

          return caalIsLegacySkosmosHeading(
            element.textContent
          );
        })
      ]);

    candidates.forEach((heading) => {
      if (
        heading.closest(
          ".caal-concept-identity, .caal-concept-sections"
        )
      ) {
        return;
      }

      const text =
        heading.textContent?.trim();

      if (
        !caalIsLegacySkosmosHeading(
          text
        )
      ) {
        return;
      }

      const isPreferred =
        /preferred/i.test(text || "") ||
        text === "Предпочитаемый термин" ||
        text === "Предпочтительная метка" ||
        text === "首选词" ||
        text === "首选标签" ||
        text === "优选词，正式主题词" ||
        text === "优选词, 正式主题词";

      const block =
        caalLegacySkosmosBlock(
          heading,
          isPreferred
            ? conceptId
            : ""
        );

      if (block) {
        block.classList.add(
          "caal-native-concept-property"
        );
        block.style.setProperty(
          "display",
          "none",
          "important"
        );
      }
    });
  }

  function caalConceptPageNeedsRender() {
    if (
      !document.querySelector(
        ".caal-concept-identity"
      ) ||
      !document.querySelector(
        ".caal-concept-sections"
      )
    ) {
      return true;
    }

    const uriProperty =
      caalCurrentConceptUriProperty();

    const parent =
      uriProperty?.parentNode;

    if (!parent) {
      return false;
    }

    return [...parent.children]
      .some((child) => {
        if (
          !child.classList?.contains(
            "property"
          )
        ) {
          return false;
        }

        if (
          child.classList.contains(
            "caal-concept-section"
          )
        ) {
          return false;
        }

        return !child.classList.contains(
          "caal-native-concept-property"
        );
      });
  }

  async function caalRenderConceptPage() {
    caalInjectConceptPageStyles();

    const conceptUri =
      caalCurrentConceptUri();

    const vocabularyId =
      caalCurrentVocabularyId();

    const requestedLang =
      caalCurrentUiLanguage();

    const uriProperty =
      caalCurrentConceptUriProperty();

    if (
      !conceptUri ||
      !vocabularyId ||
      !uriProperty?.parentNode
    ) {
      return;
    }

    const requestId =
      ++caalConceptPageRequestId;

    const parent =
      uriProperty.parentNode;

    const xmlRows =
      await caalFetchConceptLanguageXmls(
        vocabularyId,
        conceptUri
      );

    if (
      requestId !==
      caalConceptPageRequestId
    ) {
      return;
    }

    const baseXml =
      xmlRows.find(
        (row) =>
          row.lang === requestedLang
      )?.xml ||
      xmlRows[0]?.xml ||
      null;

    const preferredLabels =
      caalCollectLiteralRows(
        xmlRows,
        conceptUri,
        "prefLabel"
      );

    const alternativeLabels =
      caalCollectLiteralRows(
        xmlRows,
        conceptUri,
        "altLabel"
      );

    const definitions =
      caalCollectLiteralRows(
        xmlRows,
        conceptUri,
        "definition"
      );

    const scopeNotes =
      caalCollectLiteralRows(
        xmlRows,
        conceptUri,
        "scopeNote"
      );

    const selectedLabel =
      caalPreferredLabelForLanguage(
        preferredLabels,
        requestedLang
      );

    const preferredText =
      selectedLabel?.text ||
      caalConceptIdFromUri(
        conceptUri
      );

    const notation =
      caalNotationFromXml(
        baseXml,
        conceptUri
      );

    const hierarchyData =
      await caalHierarchyData(
        vocabularyId,
        conceptUri,
        requestedLang
      );

    if (
      requestId !==
      caalConceptPageRequestId
    ) {
      return;
    }

    const SKOS_NS =
      "http://www.w3.org/2004/02/skos/core#";

    const relatedUris =
      caalRdfXmlResourceValuesNs(
        baseXml,
        conceptUri,
        SKOS_NS,
        "related"
      );

    const mappingPredicates = [
      "exactMatch",
      "closeMatch",
      "broadMatch",
      "narrowMatch",
      "relatedMatch"
    ];

    const mappings = [];

    mappingPredicates.forEach(
      (type) => {
        caalRdfXmlResourceValuesNs(
          baseXml,
          conceptUri,
          SKOS_NS,
          type
        ).forEach((uri) => {
          mappings.push({
            type,
            uri
          });
        });
      }
    );

    const uniqueMappings = [];
    const mappingSeen = new Set();

    mappings.forEach((mapping) => {
      const key =
        `${mapping.type}\u0000${mapping.uri}`;
      if (mappingSeen.has(key)) return;
      mappingSeen.add(key);
      uniqueMappings.push(mapping);
    });

    const sources = baseXml
      ? caalRdfXmlResourceValues(
          baseXml,
          conceptUri,
          "source"
        )
      : [];

    const references = baseXml
      ? caalRdfXmlResourceValues(
          baseXml,
          conceptUri,
          "references"
        )
      : [];

    const relationsBody =
      await caalBuildRelationsBody(
        conceptUri,
        vocabularyId,
        requestedLang,
        relatedUris,
        uniqueMappings
      );

    const bibliographyBody =
      await caalBuildBibliographyBody(
        sources,
        references,
        baseXml
      );

    if (
      requestId !==
      caalConceptPageRequestId
    ) {
      return;
    }

    const oldIdentity =
      parent.querySelector(
        ":scope > .caal-concept-identity"
      );

    const oldSections =
      parent.querySelector(
        ":scope > .caal-concept-sections"
      );

    oldIdentity?.remove();
    oldSections?.remove();

    const identity =
      caalBuildConceptIdentity(
        conceptUri,
        preferredText,
        notation,
        selectedLabel?.lang ||
          requestedLang
      );

    const sections =
      document.createElement("div");

    sections.className =
      "caal-concept-sections";

    const labelCount =
      preferredLabels.length +
      alternativeLabels.length;

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "labels",
        title:
          caalConceptText("labels"),
        meta: labelCount,
        populated: labelCount > 0,
        body: labelCount
          ? caalBuildLabelsBody(
              preferredLabels,
              alternativeLabels
            )
          : caalEmptySectionMessage(
              "No labels."
            )
      })
    );

    const definitionCount =
      definitions.length +
      scopeNotes.length;

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "definition",
        title:
          caalConceptText(
            "definition"
          ),
        meta: definitionCount,
        populated:
          definitionCount > 0,
        body:
          caalBuildDefinitionBody(
            definitions,
            scopeNotes
          )
      })
    );

    const hierarchyPopulated =
      caalHierarchyHasRelations(
        hierarchyData
      );

    const pathCount =
      hierarchyPopulated
        ? caalHierarchyPathCount(
            hierarchyData
          )
        : 0;

    const pathMeta =
      hierarchyPopulated
        ? `${pathCount} ${
            pathCount === 1
              ? caalConceptText(
                  "path"
                )
              : caalConceptText(
                  "paths"
                )
          }`
        : 0;

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "hierarchy",
        title:
          caalConceptText(
            "hierarchy"
          ),
        meta: pathMeta,
        populated:
          hierarchyPopulated,
        body:
          caalBuildHierarchyBody(
            hierarchyData,
            vocabularyId,
            requestedLang
          )
      })
    );

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "uri-downloads",
        title:
          caalConceptText(
            "uriDownloads"
          ),
        populated: true,
        body:
          caalBuildTechnicalBody(
            vocabularyId,
            conceptUri,
            notation
          )
      })
    );

    const relationCount =
      relatedUris.length +
      uniqueMappings.length;

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "relations",
        title:
          caalConceptText(
            "relations"
          ),
        meta: relationCount,
        populated:
          relationCount > 0,
        body: relationsBody
      })
    );

    const bibliographyCount =
      sources.length +
      references.length;

    sections.appendChild(
      caalCreateConceptSection({
        conceptUri,
        key: "bibliography",
        title:
          caalConceptText(
            "bibliography"
          ),
        meta: bibliographyCount,
        populated:
          bibliographyCount > 0,
        body: bibliographyBody
      })
    );

    const firstProperty =
      [...parent.children].find(
        (child) =>
          child.classList?.contains(
            "property"
          )
      ) || null;

    parent.insertBefore(
      identity,
      firstProperty
    );

    identity.insertAdjacentElement(
      "afterend",
      sections
    );

    caalHideNativeConceptProperties(
      parent,
      identity,
      sections
    );

    caalHideLegacySkosmosConceptBlocks(
      conceptUri
    );

    caalFixAatMappingLinks();
  }

  function caalScheduleConceptPageRender(
    force = false
  ) {
    window.clearTimeout(
      caalConceptPageRenderTimer
    );

    caalConceptPageRenderTimer =
      window.setTimeout(
        () => {
          if (
            force ||
            caalConceptPageNeedsRender()
          ) {
            caalRenderConceptPage();
          }
        },
        90
      );
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
    caalInjectConceptPageStyles();
    caalFixAatMappingLinks();
    caalHideLegacySkosmosConceptBlocks();
    caalRenderConceptPage();

    function caalRefreshConceptPresentation() {
      caalScheduleConceptPageRender(true);
    }

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        caalRefreshConceptPresentation,
        { once: true }
      );
    } else {
      caalRefreshConceptPresentation();
    }

    document.addEventListener(
      "loadConceptPage",
      caalRefreshConceptPresentation
    );

    const conceptObserver =
      new MutationObserver(() => {
        /*
         * Skosmos can recreate its native Preferred term and mapping rows
         * independently of the main property container. Hide them on every
         * redraw, then rebuild the CAAL presentation only when required.
         */
        caalHideLegacySkosmosConceptBlocks();

        if (
          caalConceptPageNeedsRender()
        ) {
          caalScheduleConceptPageRender();
        }
      });

    conceptObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    document.addEventListener(
      "change",
      (event) => {
        const select =
          event.target.closest?.("select");

        if (!select) return;

        const selectedLanguage =
          caalLanguageCodeFromSelect(
            select
          );

        if (!selectedLanguage) {
          return;
        }

        const conceptUri =
          caalCurrentConceptUri();

        const vocabularyId =
          caalCurrentVocabularyId();

        /*
         * Use a normal concept-page navigation for vocabulary-language
         * changes. This avoids a race between Skosmos' partial DOM redraw and
         * the CAAL concept-page renderer (most visible on Chinese concepts).
         * A full page navigation also gives every language the same reliable
         * starting state.
         */
        if (
          conceptUri &&
          vocabularyId
        ) {
          caalSelectedLanguageOverride =
            selectedLanguage;

          event.stopImmediatePropagation();

          window.location.assign(
            caalConceptPageHref(
              vocabularyId,
              selectedLanguage,
              conceptUri
            )
          );

          return;
        }

        caalSelectedLanguageOverride =
          selectedLanguage;

        caalScheduleConceptPageRender(
          true
        );
      },
      true
    );

    document.addEventListener(
      "click",
      (event) => {
        const link =
          event.target.closest?.(
            'a[href*="aatReference/"]'
          );

        if (!link) return;

        const gettyUrl =
          caalGettyUrl(link);

        if (!gettyUrl) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        window.open(
          gettyUrl,
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
