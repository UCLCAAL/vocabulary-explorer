const WORKBENCH_BASE =
  window.location.pathname === "/admin" ||
  window.location.pathname.startsWith("/admin/")
    ? "/admin"
    : "";

const LANGUAGES = [
  ["en", "English"],
  ["ru", "Russian"],
  ["zh", "Chinese"],
  ["kk", "Kazakh"],
  ["ky", "Kyrgyz"],
  ["tg", "Tajik"],
  ["tk", "Turkmen"],
  ["uz", "Uzbek"]
];

let session = null;
let selectedConcept = null;
let selectedDetailTab = "overview";
let currentVocabulary = null;
let labelFlashMessage = null;
let hierarchyConcepts = [];
let hierarchyById = new Map();
let hierarchyChildren = new Map();
let expandedTreeIds = new Set();
let conceptSearchResultsData = [];
let conceptSearchRequestId = 0;
let creatingConcept = false;

const MAX_HIERARCHY_LEVEL = 4;

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const conceptSearch = document.getElementById("conceptSearch");
const conceptSearchResults = document.getElementById("conceptSearchResults");
const conceptTree = document.getElementById("conceptTree");
const newConceptButton = document.getElementById("newConceptButton");
const collapseTreeButton = document.getElementById("collapseTreeButton");

function apiPath(path) {
  return `${WORKBENCH_BASE}${path}`;
}

async function api(path, options = {}) {
  const response = await fetch(apiPath(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { ok: false, error: "Invalid server response" };
  }

  if (!response.ok) {
    const message = data.detail
      ? `${data.error || "Request failed"}: ${data.detail}`
      : (data.error || `Request failed (${response.status})`);

    throw new Error(message);
  }

  return data;
}

async function loadSession() {
  try {
    const data = await api("/api/auth/session");
    session = data.session;
    await showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  session = null;
  loginView.hidden = false;
  appView.hidden = true;
}

async function showApp() {
  loginView.hidden = true;
  appView.hidden = false;

  const workspace = session?.user?.workspace_code
    ? String(session.user.workspace_code).toUpperCase()
    : "";

  document.getElementById("signedInAs").textContent =
    `${session?.user?.username || ""}${workspace ? ` (${workspace} admin)` : ""}`;

  await Promise.all([
    loadVocabularySummary(),
    loadHierarchyTree()
  ]);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      })
    });

    session = data.session;
    await showApp();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});

async function loadVocabularySummary() {
  const container = document.getElementById("vocabularySummary");

  try {
    const data = await api("/api/vocabularies");
    const vocab = data.vocabularies[0];
    currentVocabulary = vocab;

    const labelCoverage = Object.entries(vocab.labels_by_language)
      .map(([lang, count]) =>
        `<span class="coverage-chip">${lang}: ${count}/${vocab.concept_count}</span>`
      )
      .join("");

    container.classList.remove("loading");
    container.innerHTML = `
      <div class="summary-row">
        <div>
          <div class="eyebrow">Hosted vocabulary</div>
          <h2>Site Types</h2>
        </div>
        <div class="metric">
          <span class="muted">Concepts</span>
          <strong>${vocab.concept_count}</strong>
        </div>
      </div>

      <div class="uri-row">
        <a
          class="uri-link"
          href="${escapeHtml(vocab.scheme_uri)}"
          target="_blank"
          rel="noopener"
        >${escapeHtml(vocab.scheme_uri)}</a>
        <button
          class="copy-button"
          type="button"
          data-copy-uri="${escapeHtml(vocab.scheme_uri)}"
        >Copy URI</button>
        <span class="save-status" data-copy-status></span>
      </div>

      <div class="coverage">${labelCoverage}</div>
    `;

    bindCopyButtons();
  } catch (error) {
    container.textContent = error.message;
  }
}

async function loadHierarchyTree() {
  const data = await api(
    "/api/vocabularies/site-types/concepts?q="
  );

  hierarchyConcepts = data.concepts || [];
  rebuildHierarchyIndex();

  if (selectedConcept?.concept?.concept_id) {
    expandPathToConcept(selectedConcept.concept.concept_id);
  }

  renderHierarchyTree();
}

function levelNumber(value) {
  const match = String(value || "").match(/^(?:L)?(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function conceptNavigationLabel(concept) {
  return (
    concept?.label_en ||
    concept?.label_ru ||
    concept?.label_zh ||
    concept?.concept_id ||
    "Untitled concept"
  );
}

function rebuildHierarchyIndex() {
  hierarchyById = new Map(
    hierarchyConcepts.map((concept) => [concept.concept_id, concept])
  );

  hierarchyChildren = new Map();

  for (const concept of hierarchyConcepts) {
    const parentId = concept.parent_id || null;

    if (!hierarchyChildren.has(parentId)) {
      hierarchyChildren.set(parentId, []);
    }

    hierarchyChildren.get(parentId).push(concept);
  }

  for (const children of hierarchyChildren.values()) {
    children.sort((a, b) => {
      const aOrder = Number(a.sort_order);
      const bOrder = Number(b.sort_order);

      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      return conceptNavigationLabel(a).localeCompare(
        conceptNavigationLabel(b),
        undefined,
        { sensitivity: "base" }
      );
    });
  }
}

function expandPathToConcept(conceptId) {
  let current = hierarchyById.get(conceptId);
  const seen = new Set();

  while (current?.parent_id && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    expandedTreeIds.add(current.parent_id);
    current = hierarchyById.get(current.parent_id);
  }
}

function hierarchyRoots() {
  return hierarchyConcepts.filter((concept) => {
    const parentId = concept.parent_id || null;
    return !parentId || !hierarchyById.has(parentId);
  }).sort((a, b) => {
    const aOrder = Number(a.sort_order);
    const bOrder = Number(b.sort_order);

    if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    return conceptNavigationLabel(a).localeCompare(conceptNavigationLabel(b));
  });
}

function renderTreeNode(concept, depth = 0, ancestry = new Set()) {
  if (!concept?.concept_id || ancestry.has(concept.concept_id)) {
    return "";
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(concept.concept_id);

  const children = hierarchyChildren.get(concept.concept_id) || [];
  const hasChildren = children.length > 0;
  const expanded = hasChildren && expandedTreeIds.has(concept.concept_id);
  const active =
    selectedConcept?.concept?.concept_id === concept.concept_id &&
    !creatingConcept;

  return `
    <div class="tree-node">
      <div
        class="tree-row ${active ? "active" : ""}"
        style="--tree-depth:${depth}"
      >
        ${hasChildren ? `
          <button
            type="button"
            class="tree-toggle"
            data-tree-toggle="${escapeHtml(concept.concept_id)}"
            aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(conceptNavigationLabel(concept))}"
            aria-expanded="${expanded ? "true" : "false"}"
          >${expanded ? "▾" : "▸"}</button>
        ` : `<span class="tree-toggle-spacer"></span>`}

        <button
          type="button"
          class="tree-concept"
          data-tree-concept="${escapeHtml(concept.concept_id)}"
        >
          <span class="tree-label">${escapeHtml(conceptNavigationLabel(concept))}</span>
          <span class="tree-id">${escapeHtml(concept.concept_id)}</span>
        </button>
      </div>

      ${expanded ? `
        <div class="tree-children">
          ${children.map((child) =>
            renderTreeNode(child, depth + 1, nextAncestry)
          ).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderHierarchyTree() {
  if (!conceptTree) return;

  if (!hierarchyConcepts.length) {
    conceptTree.innerHTML =
      `<div class="tree-empty">No Site Types concepts found.</div>`;
    return;
  }

  conceptTree.innerHTML = hierarchyRoots()
    .map((concept) => renderTreeNode(concept))
    .join("");

  conceptTree.querySelectorAll("[data-tree-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const conceptId = button.dataset.treeToggle;

      if (expandedTreeIds.has(conceptId)) {
        expandedTreeIds.delete(conceptId);
      } else {
        expandedTreeIds.add(conceptId);
      }

      renderHierarchyTree();
    });
  });

  conceptTree.querySelectorAll("[data-tree-concept]").forEach((button) => {
    button.addEventListener("click", () => {
      loadConcept(button.dataset.treeConcept);
    });
  });
}

function conceptSearchMatchContext(concept) {
  if (!concept?.show_match_context || !concept?.match_label) {
    return "";
  }

  const languageName =
    LANGUAGES.find(([code]) => code === concept.match_lang)?.[1] ||
    concept.match_lang ||
    "Label";

  const isAlternative =
    String(concept.match_status || "").toLowerCase() !== "preferred";

  const labelType = isAlternative
    ? `${languageName} alternative`
    : languageName;

  return `
    <div class="concept-row-match">
      Match - ${escapeHtml(labelType)}:
      <strong>${escapeHtml(concept.match_label)}</strong>
    </div>
  `;
}

async function loadConceptSearch(query) {
  const trimmed = String(query || "").trim();
  const requestId = ++conceptSearchRequestId;

  if (!trimmed) {
    conceptSearchResultsData = [];
    renderConceptSearchResults();
    return;
  }

  try {
    const data = await api(
      `/api/vocabularies/site-types/concepts?q=${encodeURIComponent(trimmed)}`
    );

    if (requestId !== conceptSearchRequestId) return;

    conceptSearchResultsData = (data.concepts || []).slice(0, 12);
    renderConceptSearchResults();
  } catch (error) {
    if (requestId !== conceptSearchRequestId) return;

    conceptSearchResultsData = [];
    conceptSearchResults.hidden = false;
    conceptSearchResults.innerHTML =
      `<div class="search-result-message error">${escapeHtml(error.message)}</div>`;
  }
}

function renderConceptSearchResults() {
  if (!conceptSearchResults) return;

  const query = conceptSearch.value.trim();

  if (!query) {
    conceptSearchResults.hidden = true;
    conceptSearchResults.innerHTML = "";
    return;
  }

  conceptSearchResults.hidden = false;

  if (!conceptSearchResultsData.length) {
    conceptSearchResults.innerHTML =
      `<div class="search-result-message">No concepts found.</div>`;
    return;
  }

  conceptSearchResults.innerHTML = conceptSearchResultsData.map((concept) => `
    <button
      type="button"
      class="concept-search-result"
      data-search-concept="${escapeHtml(concept.concept_id)}"
    >
      <span class="concept-search-result-main">
        <strong>${escapeHtml(conceptNavigationLabel(concept))}</strong>
        <span class="concept-row-id">${escapeHtml(concept.concept_id)}</span>
      </span>
      ${conceptSearchMatchContext(concept)}
    </button>
  `).join("");

  conceptSearchResults.querySelectorAll("[data-search-concept]").forEach((button) => {
    button.addEventListener("click", async () => {
      const conceptId = button.dataset.searchConcept;
      conceptSearch.value = "";
      conceptSearchResultsData = [];
      renderConceptSearchResults();
      await loadConcept(conceptId);
    });
  });
}

let searchTimer = null;

conceptSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadConceptSearch(conceptSearch.value);
  }, 180);
});

conceptSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    conceptSearch.value = "";
    conceptSearchResultsData = [];
    renderConceptSearchResults();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".concept-search-wrap")) {
    conceptSearchResults.hidden = true;
  }
});

collapseTreeButton.addEventListener("click", () => {
  expandedTreeIds.clear();
  renderHierarchyTree();
});

newConceptButton.addEventListener("click", () => {
  openNewConceptForm();
});

function defaultNewConceptParentId() {
  const selected = selectedConcept?.concept;

  if (!selected) return "";

  const selectedLevel = levelNumber(selected.level);

  if (selectedLevel && selectedLevel < MAX_HIERARCHY_LEVEL) {
    return selected.concept_id;
  }

  return selected.parent_id || "";
}

function newConceptParentOptions(selectedParentId = "") {
  const options = [
    `<option value="" ${selectedParentId ? "" : "selected"}>No parent - new top concept</option>`
  ];

  for (const concept of hierarchyConcepts) {
    const level = levelNumber(concept.level);

    if (!level || level >= MAX_HIERARCHY_LEVEL) continue;

    const selected = concept.concept_id === selectedParentId
      ? "selected"
      : "";
    const indent = "- ".repeat(Math.max(0, level - 1));

    options.push(`
      <option value="${escapeHtml(concept.concept_id)}" ${selected}>
        ${escapeHtml(`${indent}${conceptNavigationLabel(concept)} (${concept.concept_id})`)}
      </option>
    `);
  }

  return options.join("");
}

function predictedLevelForParent(parentId) {
  if (!parentId) return 1;

  const parent = hierarchyById.get(parentId);
  const parentLevel = levelNumber(parent?.level);

  return parentLevel ? parentLevel + 1 : null;
}

function openNewConceptForm() {
  creatingConcept = true;

  const parentId = defaultNewConceptParentId();
  const predictedLevel = predictedLevelForParent(parentId) || 1;

  document.getElementById("conceptEmpty").hidden = true;
  document.getElementById("conceptDetail").hidden = false;
  document.getElementById("conceptTitle").textContent = "New term";
  document.getElementById("conceptId").textContent =
    "Concept ID will be allocated automatically when saved";
  document.getElementById("conceptLevel").textContent = `L${predictedLevel}`;
  document.querySelector(".detail-tabs").hidden = true;

  const container = document.getElementById("detailContent");

  container.innerHTML = `
    <form id="newConceptForm" class="new-concept-form">
      <div class="new-concept-intro">
        <p>
          Create the concept in PostgreSQL first. It will not appear in the
          public Vocabulary Explorer until Site Types is published.
        </p>
      </div>

      <label>
        Preferred label - English
        <input
          id="newConceptLabelEn"
          required
          autocomplete="off"
          placeholder="Enter the new Site Type"
        >
      </label>

      <label>
        Parent concept
        <select id="newConceptParent">
          ${newConceptParentOptions(parentId)}
        </select>
      </label>

      <div id="newConceptHierarchyHelp" class="new-concept-hierarchy-help">
        This will create an L${predictedLevel} concept.
      </div>

      <details class="new-concept-language-details">
        <summary>Additional language labels</summary>
        <p class="muted">
          Optional. These are stored as preferred labels for the new concept.
          They can also be added or revised after creation.
        </p>

        <div class="new-concept-language-grid">
          ${LANGUAGES.filter(([lang]) => lang !== "en").map(([lang, name]) => `
            <label>
              ${escapeHtml(name)} <span class="field-meta">${escapeHtml(lang)}</span>
              <input
                data-new-concept-label="${escapeHtml(lang)}"
                autocomplete="off"
              >
            </label>
          `).join("")}
        </div>
      </details>

      <div class="new-concept-actions">
        <button type="submit" id="createConceptButton">Create term</button>
        <button type="button" class="secondary" id="cancelNewConceptButton">Cancel</button>
        <span id="newConceptStatus" class="save-status"></span>
      </div>
    </form>
  `;

  bindNewConceptForm();
  renderHierarchyTree();

  window.setTimeout(() => {
    document.getElementById("newConceptLabelEn")?.focus();
  }, 0);
}

function bindNewConceptForm() {
  const form = document.getElementById("newConceptForm");
  const parentSelect = document.getElementById("newConceptParent");
  const status = document.getElementById("newConceptStatus");

  parentSelect.addEventListener("change", () => {
    const level = predictedLevelForParent(parentSelect.value);
    document.getElementById("conceptLevel").textContent =
      level ? `L${level}` : "";
    document.getElementById("newConceptHierarchyHelp").textContent =
      level
        ? `This will create an L${level} concept.`
        : "Choose a valid parent concept.";
  });

  document.getElementById("cancelNewConceptButton").addEventListener("click", async () => {
    creatingConcept = false;
    document.querySelector(".detail-tabs").hidden = false;
    renderHierarchyTree();

    if (selectedConcept?.concept?.concept_id) {
      await loadConcept(selectedConcept.concept.concept_id, true);
      return;
    }

    document.getElementById("conceptDetail").hidden = true;
    document.getElementById("conceptEmpty").hidden = false;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const english = document.getElementById("newConceptLabelEn").value.trim();
    const labels = { en: english };

    document.querySelectorAll("[data-new-concept-label]").forEach((input) => {
      const value = input.value.trim();
      if (value) labels[input.dataset.newConceptLabel] = value;
    });

    if (!english) {
      status.textContent = "English preferred label is required.";
      status.className = "save-status error";
      return;
    }

    const submitButton = document.getElementById("createConceptButton");
    submitButton.disabled = true;
    status.textContent = "Creating...";
    status.className = "save-status";

    try {
      const result = await api(
        "/api/vocabularies/site-types/concepts",
        {
          method: "POST",
          body: JSON.stringify({
            parent_id: parentSelect.value || null,
            labels
          })
        }
      );

      creatingConcept = false;
      selectedDetailTab = "labels";
      document.querySelector(".detail-tabs").hidden = false;

      await Promise.all([
        loadVocabularySummary(),
        loadHierarchyTree()
      ]);

      await loadConcept(result.concept.concept_id, true);
    } catch (error) {
      status.textContent = error.message;
      status.className = "save-status error";
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function loadConcept(conceptId, keepTab = false) {
  const data = await api(
    `/api/vocabularies/site-types/concepts/${encodeURIComponent(conceptId)}`
  );

  creatingConcept = false;
  selectedConcept = data;

  if (!keepTab) {
    selectedDetailTab = "overview";
  }

  document.getElementById("conceptEmpty").hidden = true;
  document.getElementById("conceptDetail").hidden = false;
  document.querySelector(".detail-tabs").hidden = false;
  document.getElementById("conceptId").textContent =
    data.concept.concept_id;
  document.getElementById("conceptLevel").textContent =
    data.concept.level || "";

  const englishPreferred = data.labels.find(
    (row) =>
      row.lang === "en" &&
      String(row.status || "").toLowerCase() === "preferred"
  );

  document.getElementById("conceptTitle").textContent =
    englishPreferred?.label ||
    data.concept.en_label ||
    data.concept.concept_id;

  document.querySelectorAll(".detail-tab").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.detailTab === selectedDetailTab
    );
  });

  expandPathToConcept(conceptId);
  renderHierarchyTree();
  renderDetail();

  window.setTimeout(() => {
    conceptTree
      .querySelector(`[data-tree-concept="${cssEscape(conceptId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, 0);
}

document.querySelectorAll(".detail-tab").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDetailTab = button.dataset.detailTab;

    document.querySelectorAll(".detail-tab").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    renderDetail();
  });
});

function renderDetail() {
  const container = document.getElementById("detailContent");
  if (!selectedConcept) return;

  if (selectedDetailTab === "labels") {
    container.innerHTML = renderLabelsEditor(selectedConcept.labels);
    bindLabelEditors();
    return;
  }

  if (selectedDetailTab === "definitions") {
    container.innerHTML = renderDefinitionsEditor(selectedConcept.definitions);
    bindDefinitionEditors();
    return;
  }

  if (selectedDetailTab === "scope-notes") {
    container.innerHTML = renderScopeNotesEditor(selectedConcept.scope_notes || []);
    bindScopeNoteEditors();
    return;
  }

  if (selectedDetailTab === "bibliography") {
    container.innerHTML = renderBibliographyEditor(selectedConcept.bibliography || []);
    bindBibliographyEditor();
    return;
  }

  if (selectedDetailTab === "hierarchy") {
    container.innerHTML = renderHierarchy(selectedConcept.hierarchy);
    bindHierarchyLinks();
    return;
  }

  if (selectedDetailTab === "history") {
    container.innerHTML = renderHistory(selectedConcept.history || []);
    return;
  }

  container.innerHTML = renderOverview(selectedConcept);
  bindCopyButtons();
}

function renderOverview(data) {
  const preferredLabels = data.labels.filter(
    (row) => String(row.status || "").toLowerCase() === "preferred"
  );

  const conceptUri = currentVocabulary?.concept_uri_base
    ? `${currentVocabulary.concept_uri_base}${data.concept.concept_id}`
    : "";

  return `
    ${conceptUri ? `
      <div class="uri-row">
        <a
          class="uri-link"
          href="${escapeHtml(conceptUri)}"
          target="_blank"
          rel="noopener"
        >${escapeHtml(conceptUri)}</a>
        <button
          class="copy-button"
          type="button"
          data-copy-uri="${escapeHtml(conceptUri)}"
        >Copy URI</button>
        <span class="save-status" data-copy-status></span>
      </div>
    ` : ""}

    <table class="data-table">
      <tr>
        <th>Concept ID</th>
        <td>${escapeHtml(data.concept.concept_id)}</td>
      </tr>
      <tr>
        <th>Level</th>
        <td>${escapeHtml(data.concept.level || "")}</td>
      </tr>
      <tr>
        <th>Parent</th>
        <td>${escapeHtml(data.concept.parent_id || "Top concept")}</td>
      </tr>
      <tr>
        <th>Sort order</th>
        <td>${escapeHtml(String(data.concept.sort_order ?? ""))}</td>
      </tr>
      <tr>
        <th>Active</th>
        <td>${escapeHtml(data.concept.is_active || "")}</td>
      </tr>
      <tr>
        <th>Preferred labels</th>
        <td>${preferredLabels.length}</td>
      </tr>
      <tr>
        <th>Definitions</th>
        <td>${data.definitions.length}</td>
      </tr>
      <tr>
        <th>Scope notes</th>
        <td>${(data.scope_notes || []).length}</td>
      </tr>
      <tr>
        <th>Bibliographic references</th>
        <td>${(data.bibliography || []).length}</td>
      </tr>
      <tr>
        <th>Children</th>
        <td>${data.hierarchy.children.length}</td>
      </tr>
    </table>
  `;
}

function renderLabelsEditor(labels) {
  const grouped = new Map(
    LANGUAGES.map(([lang, languageName]) => [
      lang,
      {
        languageName,
        preferred: null,
        alternatives: []
      }
    ])
  );

  const unspecified = [];

  for (const row of labels) {
    const lang = String(row.lang || "").toLowerCase();

    if (!grouped.has(lang)) {
      unspecified.push(row);
      continue;
    }

    if (String(row.status || "").toLowerCase() === "preferred") {
      grouped.get(lang).preferred = row;
    } else {
      grouped.get(lang).alternatives.push(row);
    }
  }

  const sections = LANGUAGES.map(([lang, languageName]) => {
    const group = grouped.get(lang);
    const preferred = group.preferred;

    const alternatives = group.alternatives.length
      ? group.alternatives.map((row) => renderAlternativeRow(row)).join("")
      : `<p class="muted compact">No alternative labels.</p>`;

    return `
      <section class="language-label-card">
        <div class="language-label-heading">
          <div>
            <strong>${escapeHtml(languageName)}</strong>
            <span class="badge">${escapeHtml(lang)}</span>
          </div>
        </div>

        <div class="preferred-editor">
          <div class="label-role">Preferred</div>

          <div class="editor-field">
            <input
              type="text"
              data-label-input="${escapeHtml(lang)}"
              value="${escapeHtml(preferred?.label || "")}"
              placeholder="No preferred label stored"
            >
            <div class="field-meta">
              ${preferred ? "Preferred label" : "No preferred label"}
            </div>
            <div
              class="save-status"
              data-label-status="${escapeHtml(lang)}"
            ></div>
          </div>

          <div class="label-actions">
            <button
              type="button"
              class="save-action"
              data-save-label="${escapeHtml(lang)}"
            >Save changes</button>

            ${preferred ? `
              <button
                type="button"
                class="role-action"
                data-demote-label="${escapeHtml(preferred.label_id)}"
                data-label-lang="${escapeHtml(lang)}"
              >Make alternative</button>
            ` : ""}
          </div>
        </div>

        <div class="alternatives-block">
          <div class="label-role">Alternatives</div>
          <div class="alternative-list">
            ${alternatives}
          </div>

          <div class="add-alternative-row">
            <input
              type="text"
              data-new-alt-input="${escapeHtml(lang)}"
              placeholder="Add alternative label"
            >
            <button
              type="button"
              class="save-action"
              data-add-alt="${escapeHtml(lang)}"
            >Add alternative</button>
            <span
              class="save-status"
              data-add-alt-status="${escapeHtml(lang)}"
            ></span>
          </div>
        </div>
      </section>
    `;
  }).join("");

  const unspecifiedHtml = unspecified.length
    ? `
      <section class="unassigned-labels">
        <h3>Unassigned / legacy labels</h3>
        <p class="muted">
          Choose a language and Save changes. The label will move into that
          language's Alternatives list, where it can then be made preferred.
        </p>
        <div class="alternative-list">
          ${unspecified.map((row) => renderAlternativeRow(row, true)).join("")}
        </div>
      </section>
    `
    : "";

  const flashHtml = labelFlashMessage
    ? `
      <div class="label-flash ${escapeHtml(labelFlashMessage.type)}">
        ${escapeHtml(labelFlashMessage.text)}
      </div>
    `
    : "";

  labelFlashMessage = null;

  return `
    ${flashHtml}

    <p class="muted">
      Each language may have one preferred label and any number of alternatives.
      Adding an alternative saves it immediately. Clear an existing alternative
      and press Save changes to remove it.
    </p>

    <div class="language-label-list">
      ${sections}
    </div>

    ${unspecifiedHtml}
  `;
}

function renderAlternativeRow(row, showLanguagePicker = false) {
  const currentLang = String(row.lang || "").toLowerCase();

  const languageControl = showLanguagePicker
    ? `
      <select data-alt-lang="${escapeHtml(row.label_id)}">
        <option value="">Choose language</option>
        ${LANGUAGES.map(([lang, languageName]) => `
          <option
            value="${escapeHtml(lang)}"
            ${lang === currentLang ? "selected" : ""}
          >${escapeHtml(languageName)} (${escapeHtml(lang)})</option>
        `).join("")}
      </select>
    `
    : `<span class="badge">${escapeHtml(currentLang)}</span>`;

  return `
    <div class="alternative-row" data-alt-row="${escapeHtml(row.label_id)}">
      <div class="alternative-lang">
        ${languageControl}
      </div>

      <div class="editor-field">
        <input
          type="text"
          data-alt-input="${escapeHtml(row.label_id)}"
          value="${escapeHtml(row.label)}"
        >
        <div class="field-meta">
          Alternative label
        </div>
        <div
          class="save-status"
          data-alt-status="${escapeHtml(row.label_id)}"
        ></div>
      </div>

      <div class="label-actions">
        <button
          type="button"
          class="save-action"
          data-save-alt="${escapeHtml(row.label_id)}"
          data-existing-lang="${escapeHtml(currentLang)}"
        >Save changes</button>

        <button
          type="button"
          class="role-action"
          data-promote-label="${escapeHtml(row.label_id)}"
          ${showLanguagePicker ? "disabled" : ""}
        >Make preferred</button>

        <button
          type="button"
          class="remove-action"
          data-delete-alt="${escapeHtml(row.label_id)}"
        >Remove</button>
      </div>
    </div>
  `;
}

function bindLabelEditors() {
  document.querySelectorAll("[data-save-label]").forEach((button) => {
    button.addEventListener("click", async () => {
      const lang = button.dataset.saveLabel;
      const input = document.querySelector(
        `[data-label-input="${cssEscape(lang)}"]`
      );
      const status = document.querySelector(
        `[data-label-status="${cssEscape(lang)}"]`
      );
      const label = input.value.trim();

      if (!label) {
        status.textContent =
          "Use Make alternative on the current preferred label if you want no preferred value.";
        status.className = "save-status error";
        return;
      }

      button.disabled = true;
      status.textContent = "Saving...";
      status.className = "save-status";

      try {
        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(selectedConcept.concept.concept_id)
          }/labels/${encodeURIComponent(lang)}`,
          {
            method: "PUT",
            body: JSON.stringify({ label })
          }
        );

        await refreshSelectedConcept();
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-add-alt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const lang = button.dataset.addAlt;
      const input = document.querySelector(
        `[data-new-alt-input="${cssEscape(lang)}"]`
      );
      const status = document.querySelector(
        `[data-add-alt-status="${cssEscape(lang)}"]`
      );
      const label = input.value.trim();

      if (!label) {
        status.textContent = "Enter an alternative label.";
        status.className = "save-status error";
        return;
      }

      button.disabled = true;
      status.textContent = "Adding...";
      status.className = "save-status";

      try {
        const result = await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(selectedConcept.concept.concept_id)
          }/alternative-labels`,
          {
            method: "POST",
            body: JSON.stringify({ lang, label })
          }
        );

        status.textContent = result?.label
          ? "Alternative added"
          : "Saved";
        status.className = "save-status success";

        labelFlashMessage = {
          type: "success",
          text: "Alternative label added and saved."
        };

        await refreshSelectedConcept();
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-save-alt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const labelId = button.dataset.saveAlt;
      const input = document.querySelector(
        `[data-alt-input="${cssEscape(labelId)}"]`
      );
      const langSelect = document.querySelector(
        `[data-alt-lang="${cssEscape(labelId)}"]`
      );
      const status = document.querySelector(
        `[data-alt-status="${cssEscape(labelId)}"]`
      );

      const label = input.value.trim();
      const lang = langSelect
        ? langSelect.value
        : button.dataset.existingLang;

      if (!LANGUAGES.some(([code]) => code === lang)) {
        status.textContent = "Choose a language.";
        status.className = "save-status error";
        return;
      }

      button.disabled = true;
      status.textContent = "Saving...";
      status.className = "save-status";

      try {
        const conceptId = selectedConcept.concept.concept_id;
        const path =
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(conceptId)
          }/alternative-labels/${encodeURIComponent(labelId)}`;

        if (!label) {
          await api(path, {
            method: "DELETE"
          });

          labelFlashMessage = {
            type: "success",
            text: "Alternative label removed."
          };
        } else {
          await api(path, {
            method: "PUT",
            body: JSON.stringify({ label, lang })
          });

          labelFlashMessage = {
            type: "success",
            text: "Alternative label changes saved."
          };
        }

        await refreshSelectedConcept();
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-delete-alt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const labelId = button.dataset.deleteAlt;
      const row = document.querySelector(
        `[data-alt-row="${cssEscape(labelId)}"]`
      );
      const input = row?.querySelector("[data-alt-input]");
      const labelText = input?.value?.trim() || "this alternative label";

      const confirmed = window.confirm(
        `Remove "${labelText}" from this concept?`
      );

      if (!confirmed) return;

      button.disabled = true;

      try {
        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(selectedConcept.concept.concept_id)
          }/alternative-labels/${encodeURIComponent(labelId)}`,
          {
            method: "DELETE"
          }
        );

        labelFlashMessage = {
          type: "success",
          text: "Alternative label removed."
        };

        await refreshSelectedConcept();
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-promote-label]").forEach((button) => {
    button.addEventListener("click", async () => {
      const labelId = button.dataset.promoteLabel;
      const status = document.querySelector(
        `[data-alt-status="${cssEscape(labelId)}"]`
      );

      button.disabled = true;
      if (status) {
        status.textContent = "Promoting...";
        status.className = "save-status";
      }

      try {
        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(selectedConcept.concept.concept_id)
          }/labels/${encodeURIComponent(labelId)}/promote`,
          {
            method: "POST",
            body: JSON.stringify({})
          }
        );

        labelFlashMessage = {
          type: "success",
          text: "Preferred label changed. The previous preferred label is now an alternative."
        };

        await refreshSelectedConcept();
      } catch (error) {
        if (status) {
          status.textContent = error.message;
          status.className = "save-status error";
        }
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-demote-label]").forEach((button) => {
    button.addEventListener("click", async () => {
      const labelId = button.dataset.demoteLabel;
      const lang = button.dataset.labelLang;

      const confirmed = window.confirm(
        `Make the ${lang} preferred label an alternative? ` +
        `This language will have no preferred label until another is promoted.`
      );

      if (!confirmed) return;

      button.disabled = true;

      try {
        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(selectedConcept.concept.concept_id)
          }/labels/${encodeURIComponent(labelId)}/demote`,
          {
            method: "POST",
            body: JSON.stringify({})
          }
        );

        labelFlashMessage = {
          type: "success",
          text: "Preferred label changed to an alternative."
        };

        await refreshSelectedConcept();
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

}

async function refreshSelectedConcept() {
  const conceptId = selectedConcept.concept.concept_id;

  await Promise.all([
    loadVocabularySummary(),
    loadHierarchyTree()
  ]);

  await loadConcept(conceptId, true);
}

function renderDefinitionsEditor(notes) {
  const definitions = new Map();

  for (const row of notes) {
    if (String(row.note_type || "").toLowerCase() === "definition") {
      definitions.set(row.lang, row);
    }
  }

  return `
    <p class="muted">
      Clear a definition field and press Save to remove that language's definition.
    </p>
    <div class="editor-list">
      ${LANGUAGES.map(([lang, languageName]) => {
        const row = definitions.get(lang);

        return `
          <div class="editor-row">
            <div class="editor-language">
              <strong>${escapeHtml(languageName)}</strong>
              <span>${escapeHtml(lang)}</span>
            </div>

            <div class="editor-field">
              <textarea
                data-note-input="${escapeHtml(lang)}"
                placeholder="No definition stored"
              >${escapeHtml(row?.note || "")}</textarea>
              <div class="field-meta">
                ${row?.review_status
                  ? escapeHtml(row.review_status)
                  : (row ? "Definition" : "New definition")}
              </div>
              <div
                class="save-status"
                data-note-status="${escapeHtml(lang)}"
              ></div>
            </div>

            <button
              type="button"
              data-save-note="${escapeHtml(lang)}"
            >Save</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function bindDefinitionEditors() {
  document.querySelectorAll("[data-save-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      const lang = button.dataset.saveNote;
      const input = document.querySelector(
        `[data-note-input="${cssEscape(lang)}"]`
      );
      const status = document.querySelector(
        `[data-note-status="${cssEscape(lang)}"]`
      );
      const note = input.value.trim();

      button.disabled = true;
      status.textContent = note ? "Saving..." : "Removing...";
      status.className = "save-status";

      try {
        const conceptId = selectedConcept.concept.concept_id;
        const path =
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(conceptId)
          }/definitions/${encodeURIComponent(lang)}`;

        if (note) {
          await api(path, {
            method: "PUT",
            body: JSON.stringify({ note })
          });

          status.textContent = "Saved";
        } else {
          const result = await api(path, {
            method: "DELETE"
          });

          status.textContent = result.deleted
            ? "Removed"
            : "No definition stored";
        }

        status.className = "save-status success";

        await loadVocabularySummary();
        await loadConcept(conceptId, true);
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });
}


function renderScopeNotesEditor(notes) {
  const scopeNotes = new Map();

  for (const row of notes) {
    if (String(row.note_type || "").toLowerCase() === "scopenote") {
      scopeNotes.set(row.lang, row);
    }
  }

  return `
    <p class="muted">
      Use scope notes for guidance about how a concept should be applied,
      distinguished, included or excluded. Definitions belong in the
      Definitions tab.
    </p>

    <div class="editor-list">
      ${LANGUAGES.map(([lang, languageName]) => {
        const row = scopeNotes.get(lang);

        return `
          <div class="editor-row">
            <div class="editor-language">
              <strong>${escapeHtml(languageName)}</strong>
              <span>${escapeHtml(lang)}</span>
            </div>

            <div class="editor-field">
              <textarea
                data-scope-note-input="${escapeHtml(lang)}"
                placeholder="No scope note stored"
              >${escapeHtml(row?.note || "")}</textarea>

              <div class="field-meta">
                ${row?.review_status
                  ? escapeHtml(row.review_status)
                  : (row ? "Scope note" : "New scope note")}
              </div>

              <div
                class="save-status"
                data-scope-note-status="${escapeHtml(lang)}"
              ></div>
            </div>

            <button
              type="button"
              class="save-action"
              data-save-scope-note="${escapeHtml(lang)}"
            >Save changes</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function bindScopeNoteEditors() {
  document.querySelectorAll("[data-save-scope-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      const lang = button.dataset.saveScopeNote;
      const input = document.querySelector(
        `[data-scope-note-input="${cssEscape(lang)}"]`
      );
      const status = document.querySelector(
        `[data-scope-note-status="${cssEscape(lang)}"]`
      );

      const note = input.value.trim();
      const conceptId = selectedConcept.concept.concept_id;
      const path =
        `/api/vocabularies/site-types/concepts/${
          encodeURIComponent(conceptId)
        }/scope-notes/${encodeURIComponent(lang)}`;

      button.disabled = true;
      status.textContent = note ? "Saving..." : "Removing...";
      status.className = "save-status";

      try {
        if (note) {
          await api(path, {
            method: "PUT",
            body: JSON.stringify({ note })
          });

          status.textContent = "Saved";
        } else {
          const result = await api(path, {
            method: "DELETE"
          });

          status.textContent = result.deleted
            ? "Removed"
            : "No scope note stored";
        }

        status.className = "save-status success";
        await loadConcept(conceptId, true);
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });
}

function bibliographyRelationLabel(value) {
  const labels = {
    source: "Source",
    reference: "Reference"
  };

  return labels[value] || value || "Reference";
}

function bibliographyPrimaryLabel(row) {
  return (
    row.citation ||
    row.caal_permalink ||
    (row.doi ? `DOI: ${row.doi}` : "") ||
    row.zotero_uri ||
    row.external_uri ||
    "Bibliographic reference"
  );
}

function bibliographyLinks(row) {
  const links = [];

  if (row.caal_permalink) {
    links.push(
      `<a href="${escapeHtml(row.caal_permalink)}" target="_blank" rel="noopener">CAAL bibliography</a>`
    );
  }

  if (row.doi) {
    const doiUrl = `https://doi.org/${encodeURI(row.doi)}`;
    links.push(
      `<a href="${escapeHtml(doiUrl)}" target="_blank" rel="noopener">DOI</a>`
    );
  }

  if (row.zotero_uri) {
    links.push(
      `<a href="${escapeHtml(row.zotero_uri)}" target="_blank" rel="noopener">Zotero</a>`
    );
  }

  if (row.external_uri) {
    links.push(
      `<a href="${escapeHtml(row.external_uri)}" target="_blank" rel="noopener">External link</a>`
    );
  }

  return links.join(`<span class="reference-separator">·</span>`);
}

function renderBibliographyEditor(rows) {
  const existing = rows.length
    ? rows.map((row) => `
        <article class="reference-card" data-reference-card="${escapeHtml(row.link_id)}">
          <div class="reference-main">
            <div class="reference-relation">
              ${escapeHtml(bibliographyRelationLabel(row.relation_type))}
            </div>

            <div class="reference-citation">
              ${escapeHtml(bibliographyPrimaryLabel(row))}
            </div>

            ${bibliographyLinks(row)
              ? `<div class="reference-links">${bibliographyLinks(row)}</div>`
              : ""}

            ${row.link_note
              ? `<div class="reference-note">${escapeHtml(row.link_note)}</div>`
              : ""}

            <div
              class="reference-edit-panel"
              data-reference-edit-panel="${escapeHtml(row.link_id)}"
              hidden
            >
              <div class="reference-form-grid">
                <label class="full-width">
                  Citation or title
                  <textarea
                    data-edit-bib-field="citation"
                    rows="3"
                  >${escapeHtml(row.citation || "")}</textarea>
                </label>

                <label>
                  CAAL bibliography permalink
                  <input
                    data-edit-bib-field="caal_permalink"
                    type="url"
                    value="${escapeHtml(row.caal_permalink || "")}"
                  >
                </label>

                <label>
                  DOI
                  <input
                    data-edit-bib-field="doi"
                    type="text"
                    value="${escapeHtml(row.doi || "")}"
                  >
                </label>

                <label>
                  Zotero link
                  <input
                    data-edit-bib-field="zotero_uri"
                    type="url"
                    value="${escapeHtml(row.zotero_uri || "")}"
                  >
                </label>

                <label>
                  Other URI
                  <input
                    data-edit-bib-field="external_uri"
                    type="url"
                    value="${escapeHtml(row.external_uri || "")}"
                  >
                </label>

                <label>
                  Relationship
                  <select data-edit-bib-field="relation_type">
                    <option
                      value="source"
                      ${row.relation_type === "source" ? "selected" : ""}
                    >Source</option>
                    <option
                      value="reference"
                      ${row.relation_type === "reference" ? "selected" : ""}
                    >Reference</option>
                  </select>
                </label>

                <label class="full-width">
                  Note
                  <input
                    data-edit-bib-field="note"
                    type="text"
                    value="${escapeHtml(row.link_note || "")}"
                    placeholder="Optional note about why this reference is linked"
                  >
                </label>
              </div>

              <div class="reference-form-actions">
                <button
                  type="button"
                  class="save-action"
                  data-save-reference="${escapeHtml(row.link_id)}"
                >Save changes</button>

                <button
                  type="button"
                  class="secondary-action"
                  data-cancel-edit-reference="${escapeHtml(row.link_id)}"
                >Cancel</button>

                <span
                  class="save-status"
                  data-edit-bib-status="${escapeHtml(row.link_id)}"
                ></span>
              </div>
            </div>
          </div>

          <div class="reference-actions">
            <button
              type="button"
              class="secondary-action"
              data-edit-reference="${escapeHtml(row.link_id)}"
            >Edit</button>

            <button
              type="button"
              class="remove-action"
              data-remove-reference="${escapeHtml(row.link_id)}"
            >Remove</button>
          </div>
        </article>
      `).join("")
    : `<p class="muted">No bibliographic references linked to this concept.</p>`;

  return `
    <div class="bibliography-intro">
      <p class="muted">
        Link publications to this concept. Use Source when the publication
        directly supports the concept or its definition, and Reference for
        other relevant cited literature. You can use a CAAL bibliography
        permalink, DOI, Zotero link, another URI, or a citation.
      </p>
    </div>

    <div class="reference-list">
      ${existing}
    </div>

    <section class="add-reference-card">
      <h3>Add bibliographic reference</h3>

      <div class="reference-form-grid">
        <label class="full-width">
          Citation or title
          <textarea
            data-bib-field="citation"
            rows="3"
            placeholder="Optional if a persistent link or DOI is supplied"
          ></textarea>
        </label>

        <label>
          CAAL bibliography permalink
          <input
            data-bib-field="caal_permalink"
            type="url"
            placeholder="https://uclcaal.org/bibliography/..."
          >
        </label>

        <label>
          DOI
          <input
            data-bib-field="doi"
            type="text"
            placeholder="10.xxxx/xxxxx or https://doi.org/..."
          >
        </label>

        <label>
          Zotero link
          <input
            data-bib-field="zotero_uri"
            type="url"
            placeholder="https://www.zotero.org/..."
          >
        </label>

        <label>
          Other URI
          <input
            data-bib-field="external_uri"
            type="url"
            placeholder="https://..."
          >
        </label>

        <label>
          Relationship
          <select data-bib-field="relation_type">
            <option value="source">Source</option>
            <option value="reference">Reference</option>
          </select>
        </label>

        <label class="full-width">
          Note
          <input
            data-bib-field="note"
            type="text"
            placeholder="Optional note about why this reference is linked"
          >
        </label>
      </div>

      <div class="reference-form-actions">
        <button
          type="button"
          class="save-action"
          data-add-reference
        >Add reference</button>

        <span class="save-status" data-bib-status></span>
      </div>
    </section>
  `;
}

function bindBibliographyEditor() {
  const addButton = document.querySelector("[data-add-reference]");

  if (addButton) {
    addButton.addEventListener("click", async () => {
      const status = document.querySelector("[data-bib-status]");
      const payload = {};

      document.querySelectorAll("[data-bib-field]").forEach((field) => {
        payload[field.dataset.bibField] = field.value.trim();
      });

      addButton.disabled = true;
      status.textContent = "Adding...";
      status.className = "save-status";

      try {
        const conceptId = selectedConcept.concept.concept_id;

        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(conceptId)
          }/bibliography`,
          {
            method: "POST",
            body: JSON.stringify(payload)
          }
        );

        status.textContent = "Reference added";
        status.className = "save-status success";

        await loadConcept(conceptId, true);
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        addButton.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-edit-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      const linkId = button.dataset.editReference;
      const panel = document.querySelector(
        `[data-reference-edit-panel="${cssEscape(linkId)}"]`
      );

      if (panel) {
        panel.hidden = false;
      }
    });
  });

  document.querySelectorAll("[data-cancel-edit-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      const linkId = button.dataset.cancelEditReference;
      const panel = document.querySelector(
        `[data-reference-edit-panel="${cssEscape(linkId)}"]`
      );

      if (panel) {
        panel.hidden = true;
      }
    });
  });

  document.querySelectorAll("[data-save-reference]").forEach((button) => {
    button.addEventListener("click", async () => {
      const linkId = button.dataset.saveReference;
      const panel = document.querySelector(
        `[data-reference-edit-panel="${cssEscape(linkId)}"]`
      );
      const status = document.querySelector(
        `[data-edit-bib-status="${cssEscape(linkId)}"]`
      );

      if (!panel || !status) return;

      const payload = {};

      panel.querySelectorAll("[data-edit-bib-field]").forEach((field) => {
        payload[field.dataset.editBibField] = field.value.trim();
      });

      button.disabled = true;
      status.textContent = "Saving...";
      status.className = "save-status";

      try {
        const conceptId = selectedConcept.concept.concept_id;

        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(conceptId)
          }/bibliography/${encodeURIComponent(linkId)}`,
          {
            method: "PUT",
            body: JSON.stringify(payload)
          }
        );

        status.textContent = "Saved";
        status.className = "save-status success";

        await loadConcept(conceptId, true);
      } catch (error) {
        status.textContent = error.message;
        status.className = "save-status error";
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-remove-reference]").forEach((button) => {
    button.addEventListener("click", async () => {
      const linkId = button.dataset.removeReference;

      if (!window.confirm("Remove this reference from the concept?")) {
        return;
      }

      button.disabled = true;

      try {
        const conceptId = selectedConcept.concept.concept_id;

        await api(
          `/api/vocabularies/site-types/concepts/${
            encodeURIComponent(conceptId)
          }/bibliography/${encodeURIComponent(linkId)}`,
          {
            method: "DELETE"
          }
        );

        await loadConcept(conceptId, true);
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}


function renderHierarchy(hierarchy) {
  const parent = hierarchy.parent
    ? `
      <div>
        <h3>Parent</h3>
        <button
          class="hierarchy-item"
          data-open-concept="${escapeHtml(hierarchy.parent.concept_id)}"
        >
          ${escapeHtml(
            hierarchy.parent.label_en || hierarchy.parent.concept_id
          )}
          <span class="concept-row-id">
            ${escapeHtml(hierarchy.parent.concept_id)}
          </span>
        </button>
      </div>
    `
    : `
      <div>
        <h3>Parent</h3>
        <p class="muted">Top concept</p>
      </div>
    `;

  const children = hierarchy.children.length
    ? hierarchy.children.map((child) => `
        <button
          class="hierarchy-item"
          data-open-concept="${escapeHtml(child.concept_id)}"
        >
          ${escapeHtml(child.label_en || child.concept_id)}
          <span class="concept-row-id">
            ${escapeHtml(child.concept_id)}
          </span>
        </button>
      `).join("")
    : `<p class="muted">No narrower concepts.</p>`;

  return `
    <div class="hierarchy-list">
      ${parent}
      <div>
        <h3>Children</h3>
        <div class="hierarchy-list">${children}</div>
      </div>
    </div>
  `;
}

function bindHierarchyLinks() {
  document.querySelectorAll("[data-open-concept]").forEach((button) => {
    button.addEventListener("click", () => {
      loadConcept(button.dataset.openConcept);
    });
  });
}

function renderHistory(history) {
  if (history.length === 0) {
    return `
      <div class="empty-state">
        No workbench edits have been recorded for this concept yet.
      </div>
    `;
  }

  return `
    <div class="history-list">
      ${history.map((row) => {
        const oldValue = historyValue(row.entity_type, row.old_data);
        const newValue = historyValue(row.entity_type, row.new_data);

        return `
          <div class="history-item">
            <div class="history-head">
              <strong>${escapeHtml(historyType(row.entity_type))}</strong>
              ${row.lang && row.lang !== "und"
                ? `<span class="badge">${escapeHtml(row.lang)}</span>`
                : ""}
              <span class="muted">
                ${escapeHtml(row.action)}
                · ${escapeHtml(row.changed_by_username || "")}
                · ${escapeHtml(formatDate(row.changed_at))}
              </span>
            </div>

            ${oldValue !== null ? `
              <div class="history-change">
                <span class="muted">Before</span>
                <code>${escapeHtml(oldValue)}</code>
              </div>
            ` : ""}

            ${row.action === "delete" ? `
              <div class="history-change">
                <span class="muted">After</span>
                <code>Removed</code>
              </div>
            ` : `
              <div class="history-change">
                <span class="muted">After</span>
                <code>${escapeHtml(newValue || "")}</code>
              </div>
            `}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function historyValue(entityType, data) {
  if (!data) return null;
  if (entityType === "preferred_label") return data.label ?? "";
  if (entityType === "label") {
    const label = data.label ?? "";
    const status = data.status ? ` [${data.status}]` : "";
    return `${label}${status}`;
  }
  if (entityType === "definition") return data.note ?? "";
  if (entityType === "scope_note") return data.note ?? "";
  if (entityType === "bibliographic_reference") {
    const reference = data.reference || data;
    return (
      reference.citation ||
      reference.caal_permalink ||
      reference.doi ||
      reference.zotero_uri ||
      reference.external_uri ||
      JSON.stringify(data)
    );
  }
  return JSON.stringify(data);
}

function historyType(entityType) {
  if (entityType === "preferred_label") return "Preferred label";
  if (entityType === "label") return "Label";
  if (entityType === "definition") return "Definition";
  if (entityType === "scope_note") return "Scope note";
  if (entityType === "bibliographic_reference") return "Bibliographic reference";
  return entityType;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function bindCopyButtons() {
  document.querySelectorAll("[data-copy-uri]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.dataset.copyUri || "";
      const status = button.parentElement?.querySelector("[data-copy-status]");

      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        if (status) status.textContent = "";

        setTimeout(() => {
          button.textContent = "Copy URI";
        }, 1400);
      } catch {
        if (status) {
          status.textContent = "Could not copy automatically.";
          status.className = "save-status error";
        }
      }
    });
  });
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function bindMainTabs() {
  document.querySelectorAll("[data-main-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tab = button.dataset.mainTab;

      document.querySelectorAll("[data-main-tab]").forEach((tabButton) => {
        tabButton.classList.toggle(
          "active",
          tabButton === button
        );
      });

      document.querySelectorAll("[data-main-view]").forEach((view) => {
        view.hidden = view.dataset.mainView !== tab;
      });

      if (tab === "publishing") {
        await loadPublishingStatus();
      }
    });
  });
}

async function loadPublishingStatus() {
  const statusContainer =
    document.getElementById("publishingStatus");

  const historyContainer =
    document.getElementById("publicationHistory");

  if (!statusContainer || !historyContainer) {
    return;
  }

  statusContainer.textContent =
    "Loading publishing status...";

  try {
    const data = await api(
      "/api/publishing/site-types/status"
    );

    const current = data.current_data || {};
    const latestSuccess = data.latest_success;

    const pendingText =
      data.unpublished_changes === null
        ? "No workbench publication has been recorded yet."
        : data.unpublished_changes === 0
          ? "No recorded workbench changes since the last successful publication."
          : `${data.unpublished_changes} recorded workbench change${
              data.unpublished_changes === 1 ? "" : "s"
            } since the last successful publication.`;

    statusContainer.innerHTML = `
      <div class="publish-metrics">
        <div class="publish-metric">
          <span>Concepts</span>
          <strong>${escapeHtml(current.concepts ?? "")}</strong>
        </div>

        <div class="publish-metric">
          <span>Preferred labels</span>
          <strong>${escapeHtml(current.preferred_labels ?? "")}</strong>
        </div>

        <div class="publish-metric">
          <span>Alternative labels</span>
          <strong>${escapeHtml(current.alternative_labels ?? "")}</strong>
        </div>

        <div class="publish-metric">
          <span>Definitions</span>
          <strong>${escapeHtml(current.definitions ?? "")}</strong>
        </div>

        <div class="publish-metric">
          <span>Scope notes</span>
          <strong>${escapeHtml(current.scope_notes ?? "")}</strong>
        </div>

        <div class="publish-metric">
          <span>Bibliography links</span>
          <strong>${escapeHtml(current.bibliography_links ?? "")}</strong>
        </div>
      </div>

      <div class="publish-state">
        <strong>${escapeHtml(pendingText)}</strong>

        <div class="muted">
          ${
            latestSuccess
              ? `Last successful publication: ${
                  escapeHtml(formatDate(latestSuccess.finished_at))
                }`
              : "No successful workbench publication recorded."
          }
        </div>

        <div class="muted publish-graph-uri">
          Graph:
          <code>${escapeHtml(data.graph_uri || "")}</code>
        </div>
      </div>
    `;

    historyContainer.innerHTML =
      renderPublicationHistory(
        data.latest_runs || []
      );
  } catch (error) {
    statusContainer.innerHTML = `
      <p class="error">${escapeHtml(error.message)}</p>
    `;

    historyContainer.innerHTML = "";
  }
}

function renderPublicationHistory(rows) {
  if (!rows.length) {
    return `
      <section class="publication-history">
        <h3>Publication history</h3>
        <p class="muted">
          No workbench publications have been recorded yet.
        </p>
      </section>
    `;
  }

  return `
    <section class="publication-history">
      <h3>Publication history</h3>

      <div class="publication-run-list">
        ${rows.map((row) => {
          const summary = row.generated_summary || {};

          return `
            <article class="publication-run">
              <div>
                <strong>
                  ${escapeHtml(
                    row.status === "succeeded"
                      ? "Published"
                      : row.status === "failed"
                        ? "Failed"
                        : "Running"
                  )}
                </strong>

                <span class="badge">
                  ${escapeHtml(row.status)}
                </span>
              </div>

              <div class="muted">
                ${escapeHtml(row.requested_by_username || "")}
                · ${escapeHtml(formatDate(row.started_at))}
              </div>

              ${
                row.status === "succeeded"
                  ? `
                    <div class="publication-summary-line">
                      ${escapeHtml(summary.triples ?? "")} RDF triples
                      · ${escapeHtml(summary.alt_labels ?? 0)} alternative labels
                      · ${escapeHtml(summary.bibliography_sources ?? 0)} sources
                      · ${escapeHtml(summary.bibliography_references ?? 0)} references
                    </div>
                  `
                  : ""
              }

              ${
                row.error
                  ? `<div class="error publication-error">${
                      escapeHtml(row.error)
                    }</div>`
                  : ""
              }
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

async function publishSiteTypes() {
  const button =
    document.getElementById("publishSiteTypesButton");

  const status =
    document.getElementById("publishActionStatus");

  if (!button || !status) {
    return;
  }

  const confirmed = window.confirm(
    "Publish the current Site Types changes now?"
  );

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  status.textContent = "Publishing...";
  status.className = "save-status";

  try {
    const result = await api(
      "/api/publishing/site-types/publish",
      {
        method: "POST",
        body: JSON.stringify({
          confirm: "PUBLISH_SITE_TYPES"
        })
      }
    );

    status.textContent =
      `Published successfully: ${
        result.summary?.triples ?? ""
      } RDF triples.`;

    status.className =
      "save-status success";

    await loadPublishingStatus();
  } catch (error) {
    status.textContent = error.message;
    status.className =
      "save-status error";

    await loadPublishingStatus();
  } finally {
    button.disabled = false;
  }
}

bindMainTabs();

document
  .getElementById("publishSiteTypesButton")
  ?.addEventListener(
    "click",
    publishSiteTypes
  );

loadSession();
