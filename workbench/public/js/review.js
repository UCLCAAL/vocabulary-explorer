let reviewOffset = 0;
let reviewLimit = 25;
let reviewMatched = 0;
let reviewRequestId = 0;
let reviewDirty = false;
let reviewPreferencePromise = null;
let reviewUserKey = null;
let reviewAppliedFilters = null;

function initialiseReview() {
  const key = String(session?.user?.user_id || "");
  if (key === reviewUserKey) return;
  reviewUserKey = key;
  reviewPreferencePromise = null;
  reviewDirty = false;
  reviewOffset = 0;
  reviewAppliedFilters = null;
  document.getElementById("reviewTable").innerHTML = "";
  document.getElementById("reviewUsage").hidden = true;
  const options = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
  document.getElementById("reviewLanguage").innerHTML = options;
  document.getElementById("reviewReferenceLanguage").innerHTML = options;
  document.getElementById("reviewLanguage").value = LANGUAGES.some(([code]) => code === session?.profile?.preferred_language) ? session.profile.preferred_language : "en";
  document.getElementById("reviewReferenceLanguage").value = "en";
  document.getElementById("reviewMissing").value = "any";
  document.getElementById("reviewSearch").value = "";
  document.getElementById("reviewPreferenceStatus").textContent = "";
}

function initialiseReviewPreference() {
  if (!reviewPreferencePromise) {
    const userKey = reviewUserKey;
    reviewPreferencePromise = api("/api/vocabularies/site-types/review/preference")
      .then(data => {
        if (userKey !== reviewUserKey) return;
        document.getElementById("reviewLanguage").value = data.language;
        document.getElementById("reviewPreferenceStatus").textContent = data.saved_default ? "Your saved default language is selected." : "Starting with your profile language. You can save a different default.";
      }).catch(error => {
        if (userKey !== reviewUserKey) return;
        reviewPreferencePromise = null;
        document.getElementById("reviewPreferenceStatus").textContent = error.message;
      });
  }
  return reviewPreferencePromise;
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
    missing: document.getElementById("reviewMissing").value,
    q: document.getElementById("reviewSearch").value.trim()
  };
}

function renderReviewCounts(data) {
  document.getElementById("reviewCounts").innerHTML = [
    ["Active concepts", data.counts.total], ["Missing labels", data.counts.missing_label],
    ["Missing definitions", data.counts.missing_definition], ["Missing both", data.counts.missing_both],
    ["Duplicate entries", data.counts.conflicts]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("reviewResultCount").textContent = `${data.matched} concepts match your filters. Counts above cover the whole active vocabulary.`;
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
      <table class="review-table"><thead><tr><th>Concept and ${referenceName} reference</th><th>${languageName} preferred label</th><th>${languageName} definition</th></tr></thead>
      <tbody>${data.rows.map(row => {
        const id = escapeHtml(row.concept_id);
        const editor = (field, value, count) => {
          const fieldName = field === "label" ? "preferred label" : "definition";
          const input = field === "label" ? `<input data-review-input data-original="${escapeHtml(value || "")}" aria-label="${languageName} ${fieldName} for ${id}" value="${escapeHtml(value || "")}" ${count > 1 ? "disabled" : ""}>` : `<textarea data-review-input data-original="${escapeHtml(value || "")}" aria-label="${languageName} ${fieldName} for ${id}" rows="4" ${count > 1 ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>`;
          return `<form data-review-save="${field}" data-concept="${id}">
            <span class="review-field-state">${count > 1 ? "Duplicate entries: resolve in the concept editor" : (value ? "Present" : "Missing")}</span>
            ${input}<div class="review-save-row"><button type="submit" ${count > 1 ? "disabled" : ""}>Save ${fieldName}</button><span class="save-status" role="status"></span></div>
          </form>`;
        };
        return `<tr><td><strong>${escapeHtml(row.reference_label || row.en_label || row.concept_id)}</strong><div class="concept-id">${id}</div>
          ${!row.reference_label ? '<div class="muted">No preferred label in the reference language; showing the English compatibility label or ID.</div>' : ""}
          <details class="review-reference"><summary>Reference definition</summary><p>${escapeHtml(row.reference_definition || "No definition in the reference language.")}</p></details>
          <div class="review-concept-actions"><button class="secondary" type="button" data-review-open="${id}">Open concept</button><button class="secondary" type="button" data-review-usage="${id}">Check usage</button></div>
          </td><td>${editor("label", row.preferred_label, row.label_count)}</td><td>${editor("definition", row.definition, row.definition_count)}</td></tr>`;
      }).join("")}</tbody></table>` : '<p class="empty-state">No concepts match these filters.</p>';
    status.textContent = "Save each field separately. Saved changes appear publicly after Publish.";
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
      form.querySelector(".review-field-state").textContent = "Present";
      status.textContent = "Saved";
      updateReviewDirty();
      try {
        const data = await api(`/api/vocabularies/site-types/review?${new URLSearchParams({ ...filters, limit: 1 })}`);
        if (form.isConnected && session && filters.language === reviewAppliedFilters?.language) {
          renderReviewCounts(data);
          document.getElementById("reviewStatus").textContent = "Saved. Refresh the list to update which rows match your filters. Other unsaved fields are kept.";
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

let reviewUsageRequestId = 0;
async function loadReviewUsage(conceptId) {
  const requestId = ++reviewUsageRequestId;
  const userKey = reviewUserKey;
  const panel = document.getElementById("reviewUsage");
  panel.hidden = false;
  panel.textContent = "Checking original source records...";
  try {
    const data = await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(conceptId)}/usage`);
    if (requestId !== reviewUsageRequestId || userKey !== reviewUserKey) return;
    panel.innerHTML = `<h3>Usage of ${escapeHtml(conceptId)}</h3><p><strong>${data.record_count}</strong> source records, <strong>${data.field_count}</strong> matching fields. ${data.ambiguous_field_count} fields use a label shared by multiple concepts.</p>
      <p class="muted">${escapeHtml(data.limitation)}</p>
      <table><thead><tr><th>Source</th><th>Records</th><th>Fields</th></tr></thead><tbody>${data.sources.map(row => `<tr><td>${escapeHtml(row.source_schema)}.${escapeHtml(row.source_table)}</td><td>${row.record_count}</td><td>${row.field_count}</td></tr>`).join("") || '<tr><td colspan="3">No matches found under the stated checks.</td></tr>'}</tbody></table>
      <details><summary>Matching examples, up to 100</summary><div class="review-table-wrap"><table><thead><tr><th>Source / row</th><th>Field</th><th>Stored value</th><th>Match</th><th>Candidate concepts</th></tr></thead><tbody>${data.examples.map(row => `<tr><td>${escapeHtml(row.source_schema)}.${escapeHtml(row.source_table)} / ${escapeHtml(row.row_id)}</td><td>${escapeHtml(row.field)}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.match_kind)}</td><td>${escapeHtml(row.candidates.join(", "))}</td></tr>`).join("")}</tbody></table></div></details>
      <p class="muted">Checked ${escapeHtml(formatDate(data.checked_at))}. Counts include records regardless of viewer filters or deletion status.</p>`;
  } catch (error) {
    if (requestId !== reviewUsageRequestId || userKey !== reviewUserKey) return;
    panel.textContent = `Usage unknown. ${error.message}`;
  }
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("reviewFilters").addEventListener("submit", event => {
  event.preventDefault();
  if (!allowReviewNavigation()) return;
  reviewOffset = 0;
  loadReview();
});
document.getElementById("reviewRefresh").addEventListener("click", () => loadReview());
document.getElementById("reviewPrevious").addEventListener("click", () => { if (allowReviewNavigation()) { reviewOffset = Math.max(0, reviewOffset - reviewLimit); loadReview(); } });
document.getElementById("reviewNext").addEventListener("click", () => { if (allowReviewNavigation()) { reviewOffset += reviewLimit; loadReview(); } });
document.getElementById("reviewSaveDefault").addEventListener("click", async () => {
  const button = document.getElementById("reviewSaveDefault");
  const status = document.getElementById("reviewPreferenceStatus");
  button.disabled = true;
  try {
    const data = await api("/api/vocabularies/site-types/review/preference", { method: "PUT", body: JSON.stringify({ language: document.getElementById("reviewLanguage").value }) });
    status.textContent = `Default Review language saved: ${data.language}.`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
// Capture before the existing main-tab handlers can hide the review editor.
document.querySelectorAll("[data-main-tab]").forEach(button => button.addEventListener("click", event => {
  if (!allowReviewNavigation()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true));
window.addEventListener("beforeunload", event => { if (reviewDirty) { event.preventDefault(); event.returnValue = ""; } });
