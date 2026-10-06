let reviewOffset = 0;
let reviewLimit = 25;
let reviewMatched = 0;
let reviewRequestId = 0;
let reviewDirty = false;
let reviewUserKey = null;
let reviewAppliedFilters = null;

function initialiseReview() {
  const key = String(session?.user?.user_id || "");
  if (key === reviewUserKey) return;
  reviewUserKey = key;
  reviewDirty = false;
  reviewOffset = 0;
  reviewAppliedFilters = null;
  document.getElementById("reviewTable").innerHTML = "";
  document.getElementById("reviewUsageDialog").close();
  document.getElementById("reviewUsage").textContent = "";
  const options = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
  document.getElementById("reviewLanguage").innerHTML = options;
  document.getElementById("reviewReferenceLanguage").innerHTML = options;
  document.getElementById("reviewLanguage").value = LANGUAGES.some(([code]) => code === session?.profile?.preferred_language) ? session.profile.preferred_language : "en";
  document.getElementById("reviewReferenceLanguage").value = "en";
  document.getElementById("reviewMissing").value = "any";
}

function allowReviewNavigation() {
  if (!reviewDirty) return true;
  if (!window.confirm("Leave the unsaved translation changes?")) return false;
  reviewDirty = false;
  return true;
}

function updateReviewDirty() {
  reviewDirty = Array.from(document.querySelectorAll("#reviewTable [data-review-input]"))
    .some(input => input.value !== input.dataset.original);
}

function reviewFilters() {
  return {
    language: document.getElementById("reviewLanguage").value,
    reference_language: document.getElementById("reviewReferenceLanguage").value,
    missing: document.getElementById("reviewMissing").value
  };
}

function renderReviewCounts(data) {
  document.getElementById("reviewCounts").innerHTML = [
    ["Active concepts", data.counts.total], ["Missing labels", data.counts.missing_label],
    ["Missing definitions", data.counts.missing_definition], ["Missing both", data.counts.missing_both],
    ["Duplicate entries", data.counts.conflicts]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("reviewResultCount").textContent = `${data.matched} concepts match your filters.`;
}

async function loadReview() {
  if (!allowReviewNavigation()) return;
  const requestId = ++reviewRequestId;
  const userKey = reviewUserKey;
  const filters = reviewFilters();
  const status = document.getElementById("reviewStatus");
  status.textContent = "Loading translations...";
  try {
    let data = await api(`/api/vocabularies/site-types/review?${new URLSearchParams({ ...filters, offset: reviewOffset, limit: reviewLimit })}`);
    if (requestId !== reviewRequestId || userKey !== reviewUserKey) return;
    if (data.matched && reviewOffset >= data.matched) {
      reviewOffset = Math.floor((data.matched - 1) / reviewLimit) * reviewLimit;
      data = await api(`/api/vocabularies/site-types/review?${new URLSearchParams({ ...filters, offset: reviewOffset, limit: reviewLimit })}`);
      if (requestId !== reviewRequestId || userKey !== reviewUserKey) return;
    }
    reviewAppliedFilters = filters;
    reviewMatched = data.matched;
    renderReviewCounts(data);
    const languageName = LANGUAGES.find(([code]) => code === filters.language)?.[1] || filters.language;
    const referenceName = LANGUAGES.find(([code]) => code === filters.reference_language)?.[1] || filters.reference_language;
    document.getElementById("reviewTable").innerHTML = data.rows.length ? `
      <table class="review-table"><thead><tr><th>Concept and ${referenceName} text</th><th>${languageName} labels</th><th>${languageName} definition</th></tr></thead>
      <tbody>${data.rows.map(row => {
        const id = escapeHtml(row.concept_id);
        const editor = (field, value, count) => {
          const fieldName = field === "label" ? "preferred label" : "definition";
          const input = field === "label" ? `<input data-review-input data-original="${escapeHtml(value || "")}" aria-label="${languageName} ${fieldName} for ${id}" value="${escapeHtml(value || "")}" ${count > 1 ? "disabled" : ""}>` : `<textarea data-review-input data-original="${escapeHtml(value || "")}" aria-label="${languageName} ${fieldName} for ${id}" rows="4" ${count > 1 ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>`;
          return `<form data-review-save="${field}" data-concept="${id}">
            <span class="review-field-state">${count > 1 ? "Duplicate entries: open concept to resolve" : (field === "label" ? "Preferred" : "Definition")}</span>
            ${input}<div class="review-save-row"><button type="submit" ${count > 1 ? "disabled" : ""}>Save ${fieldName}</button><span class="save-status" role="status"></span></div>
          </form>`;
        };
        return `<tr><td><strong>${escapeHtml(row.reference_label || row.en_label || row.concept_id)}</strong><div class="concept-id">${id}</div>
          ${!row.reference_label ? `<div class="muted">No ${referenceName} label; English label or ID shown.</div>` : ""}
          <details class="review-reference" open><summary>${referenceName} definition</summary><p>${escapeHtml(row.reference_definition || `No ${referenceName} definition stored.`)}</p></details>
          <div class="review-concept-actions"><button class="secondary" type="button" data-review-open="${id}">Open concept</button><button class="secondary" type="button" data-review-usage="${id}">Find records using this type</button></div>
          </td><td>${editor("label", row.preferred_label, row.label_count)}${renderReviewAlternatives(row, languageName)}</td><td>${editor("definition", row.definition, row.definition_count)}</td></tr>`;
      }).join("")}</tbody></table>` : '<p class="empty-state">No concepts match these filters.</p>';
    status.textContent = "";
    document.getElementById("reviewPrevious").disabled = reviewOffset === 0;
    document.getElementById("reviewNext").disabled = reviewOffset + reviewLimit >= reviewMatched;
    document.getElementById("reviewPageStatus").textContent = reviewMatched ? `${reviewOffset + 1}-${Math.min(reviewOffset + reviewLimit, reviewMatched)} of ${reviewMatched}` : "0 concepts";
    bindReviewEditors(filters);
  } catch (error) {
    if (requestId !== reviewRequestId || userKey !== reviewUserKey) return;
    status.textContent = error.message;
    // Do not leave a stale list under a new language selector.
    document.getElementById("reviewTable").innerHTML = "";
    document.getElementById("reviewCounts").innerHTML = "";
    document.getElementById("reviewPrevious").disabled = true;
    document.getElementById("reviewNext").disabled = true;
  }
}

function bindReviewEditors(filters) {
  const table = document.getElementById("reviewTable");
  table.querySelectorAll("[data-review-alternatives]").forEach(container => bindReviewAlternatives(container, filters));
  table.querySelectorAll("[data-review-input]").forEach(input => input.addEventListener("input", updateReviewDirty));
  table.querySelectorAll("[data-review-save]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const field = form.dataset.reviewSave;
    const input = form.querySelector("[data-review-input]");
    const value = input.value.trim();
    const status = form.querySelector(".save-status");
    if (!value) { status.textContent = "Enter text before saving. Use the concept editor to remove existing text."; return; }
    const button = form.querySelector("button");
    button.disabled = true;
    input.disabled = true;
    status.textContent = "Saving...";
    try {
      await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(form.dataset.concept)}/${field === "label" ? "labels" : "definitions"}/${filters.language}`, {
        method: "PUT", body: JSON.stringify(field === "label" ? { label: value } : { note: value })
      });
      input.value = value;
      input.dataset.original = value;
      form.querySelector(".review-field-state").textContent = field === "label" ? "Preferred" : "Definition";
      status.textContent = "Saved";
      updateReviewDirty();
      try {
        const data = await api(`/api/vocabularies/site-types/review?${new URLSearchParams({ ...filters, limit: 1 })}`);
        if (form.isConnected && session && filters.language === reviewAppliedFilters?.language) {
          renderReviewCounts(data);
          document.getElementById("reviewStatus").textContent = "";
        }
        if (session) await loadVocabularySummary();
      } catch (error) {
        status.textContent = "Saved. Coverage refresh failed: " + error.message;
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      input.disabled = false;
    }
  }));
  table.querySelectorAll("[data-review-open]").forEach(button => button.addEventListener("click", async () => {
    if (!allowReviewNavigation()) return;
    document.querySelector('[data-main-tab="vocabularies"]').click();
    try { await loadConcept(button.dataset.reviewOpen); } catch (error) { document.getElementById("reviewStatus").textContent = error.message; }
  }));
  table.querySelectorAll("[data-review-usage]").forEach(button => button.addEventListener("click", () => loadReviewUsage(button.dataset.reviewUsage)));
}

function renderReviewAlternativeForm(conceptId, languageName, row = null) {
  return `<form data-review-alt-form data-concept="${escapeHtml(conceptId)}" data-label-id="${escapeHtml(row?.label_id || "")}">
    <input data-review-input data-original="${escapeHtml(row?.label || "")}" value="${escapeHtml(row?.label || "")}" aria-label="${languageName} alternative label for ${escapeHtml(conceptId)}" placeholder="Optional alternative label">
    <div class="review-save-row"><button type="submit">${row ? "Save" : "Add"}</button>${row ? '<button type="button" class="secondary" data-review-alt-remove>Remove</button>' : ""}<span class="save-status" role="status"></span></div>
  </form>`;
}

function renderReviewAlternatives(row, languageName) {
  return `<section class="review-alternatives" data-review-alternatives data-concept="${escapeHtml(row.concept_id)}">
    <span class="review-field-state">Alternative <span class="muted">(optional)</span></span>
    <div data-review-alt-existing>${(row.alternative_labels || []).map(label => renderReviewAlternativeForm(row.concept_id, languageName, label)).join("")}</div>
    <div data-review-alt-new>${renderReviewAlternativeForm(row.concept_id, languageName)}</div>
  </section>`;
}

function bindReviewAlternatives(container, filters) {
  if (container.dataset.bound === "true") return;
  container.dataset.bound = "true";
  const languageName = LANGUAGES.find(([code]) => code === filters.language)?.[1] || filters.language;
  container.addEventListener("input", updateReviewDirty);
  container.addEventListener("submit", async event => {
    const form = event.target.closest("[data-review-alt-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const value = input.value.trim();
    const status = form.querySelector(".save-status");
    if (!value) { status.textContent = "Enter an alternative label."; return; }
    const button = form.querySelector('button[type="submit"]');
    input.disabled = button.disabled = true;
    const removeButton = form.querySelector("[data-review-alt-remove]");
    if (removeButton) removeButton.disabled = true;
    const conceptId = form.dataset.concept;
    const labelId = form.dataset.labelId;
    status.textContent = "Saving...";
    try {
      const result = await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(conceptId)}/alternative-labels${labelId ? "/" + encodeURIComponent(labelId) : ""}`, {
        method: labelId ? "PUT" : "POST", body: JSON.stringify({ lang: filters.language, label: value })
      });
      if (!form.isConnected) return;
      if (labelId) {
        input.value = value; input.dataset.original = value; status.textContent = "Saved";
      } else {
        container.querySelector("[data-review-alt-existing]").insertAdjacentHTML("beforeend", renderReviewAlternativeForm(conceptId, languageName, result.label));
        input.value = ""; input.dataset.original = ""; status.textContent = "Added";
      }
      updateReviewDirty();
    } catch (error) { status.textContent = error.message; }
    finally { input.disabled = button.disabled = false; if (removeButton) removeButton.disabled = false; }
  });
  container.addEventListener("click", async event => {
    const button = event.target.closest("[data-review-alt-remove]");
    if (!button) return;
    const form = button.closest("form");
    const input = form.querySelector("input");
    if (!window.confirm(`Remove "${input.value.trim()}"?`)) return;
    const status = form.querySelector(".save-status");
    const saveButton = form.querySelector('button[type="submit"]');
    button.disabled = input.disabled = saveButton.disabled = true;
    try {
      await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(form.dataset.concept)}/alternative-labels/${encodeURIComponent(form.dataset.labelId)}`, { method: "DELETE" });
      form.remove(); updateReviewDirty();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = input.disabled = saveButton.disabled = false; }
  });
}

let reviewUsageRequestId = 0;
let reviewUsageController = null;
function reviewSourceLabel(row) {
  return `${row.source_table} (${row.source_schema === "public" ? "CAAL" : row.source_schema === "kz" ? "KZ" : row.source_schema.toUpperCase()})`;
}
async function loadReviewUsage(conceptId) {
  reviewUsageController?.abort();
  const controller = new AbortController();
  reviewUsageController = controller;
  const timeoutId = window.setTimeout(() => controller.abort(), 35000);
  const requestId = ++reviewUsageRequestId;
  const userKey = reviewUserKey;
  const dialog = document.getElementById("reviewUsageDialog");
  const panel = document.getElementById("reviewUsage");
  document.getElementById("reviewUsageTitle").textContent = `Records matching ${conceptId}`;
  panel.textContent = "Finding records...";
  if (!dialog.open) dialog.showModal();
  try {
    const data = await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(conceptId)}/usage`, { signal: controller.signal });
    if (requestId !== reviewUsageRequestId || userKey !== reviewUserKey || !dialog.open) return;
    panel.innerHTML = `<p><strong>${data.record_count}</strong> matching records</p>
      <table class="review-records-summary"><thead><tr><th>Table (workspace)</th><th>Records</th><th>Fields</th></tr></thead><tbody>${data.sources.map(row => `<tr><td>${escapeHtml(reviewSourceLabel(row))}</td><td>${row.record_count}</td><td>${row.field_count}</td></tr>`).join("") || '<tr><td colspan="3">No matching records found.</td></tr>'}</tbody></table>
      <div class="review-table-wrap"><table class="review-records-details"><thead><tr><th>Table (workspace)</th><th>CAAL ID</th><th>Field</th><th>Stored value</th></tr></thead><tbody>${data.examples.map(row => `<tr><td>${escapeHtml(reviewSourceLabel(row))}</td><td>${escapeHtml(row.caal_id || "Not recorded")}</td><td>${escapeHtml(row.field)}</td><td>${escapeHtml(row.value)}${row.english_label ? ` (${escapeHtml(row.english_label)})` : ""}${row.match_kind === "ambiguous_label" ? ' <span class="review-possible-match" title="This stored label belongs to more than one concept.">Possible match</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
      ${data.field_count > data.examples.length ? `<p class="muted">Showing ${data.examples.length} of ${data.field_count} matching fields.</p>` : ""}`;
  } catch (error) {
    if (requestId !== reviewUsageRequestId || userKey !== reviewUserKey || !dialog.open) return;
    panel.textContent = error.name === "AbortError" ? "The record check timed out. Close and try again." : `Records could not be checked. ${error.message}`;
  } finally {
    window.clearTimeout(timeoutId);
    if (reviewUsageController === controller) reviewUsageController = null;
  }
}
document.getElementById("reviewUsageClose").addEventListener("click", () => document.getElementById("reviewUsageDialog").close());
document.getElementById("reviewUsageDialog").addEventListener("close", () => { reviewUsageRequestId += 1; reviewUsageController?.abort(); });
document.getElementById("reviewUsageDialog").addEventListener("click", event => {
  const dialog = event.currentTarget;
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});

document.getElementById("reviewFilters").addEventListener("submit", event => {
  event.preventDefault();
  if (!allowReviewNavigation()) return;
  reviewOffset = 0;
  loadReview();
});
document.getElementById("reviewRefresh").addEventListener("click", () => loadReview());
document.getElementById("reviewPrevious").addEventListener("click", () => { if (allowReviewNavigation()) { reviewOffset = Math.max(0, reviewOffset - reviewLimit); loadReview(); } });
document.getElementById("reviewNext").addEventListener("click", () => { if (allowReviewNavigation()) { reviewOffset += reviewLimit; loadReview(); } });
// Capture before the existing main-tab handlers can hide the review editor.
document.querySelectorAll("[data-main-tab]").forEach(button => button.addEventListener("click", event => {
  if (!allowReviewNavigation()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true));
window.addEventListener("beforeunload", event => { if (reviewDirty) { event.preventDefault(); event.returnValue = ""; } });
