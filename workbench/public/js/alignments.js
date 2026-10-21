const ALIGNMENT_API = "/api/vocabularies/site-types/alignments";
const ALIGNMENT_RELATIONS = [
  ["exactMatch","Exact match","CAAL and AAT terms have the same meaning."],
  ["closeMatch","Close match","CAAL and AAT terms have similar, but not necessarily identical, meanings."],
  ["broadMatch","AAT term is broader","The AAT term has a broader scope than the CAAL term."],
  ["narrowMatch","AAT term is narrower","The AAT term has a narrower scope than the CAAL term."],
  ["relatedMatch","Related terms","CAAL and AAT terms are related without an equivalence or broader/narrower assertion."]
];
const alignmentState={source:null,target:null,rows:[],sourceRequest:0,targetRequest:0,searchRequest:0,listRequest:0,offset:0,total:0,limit:30,dirty:false,decision:null,user:null};
const alignmentEl=id=>document.getElementById(id);
const alignmentEscape=value=>escapeHtml(value);
function alignmentRelation(value){return ALIGNMENT_RELATIONS.find(row=>row[0]===value)?.[1]||value;}
function alignmentStatus(value){return value==="deprecated"?"Withdrawn":value.charAt(0).toUpperCase()+value.slice(1);}
function alignmentGettyLink(uri,label){
  const id=/^http:\/\/vocab\.getty\.edu\/aat\/([0-9]{9})$/.exec(String(uri))?.[1];
  return id?`<a href="https://vocab.getty.edu/aat/${id}" target="_blank" rel="noopener">${alignmentEscape(label||id)}</a>`:alignmentEscape(label||uri);
}
function resetAlignments(){
  alignmentState.sourceRequest++;alignmentState.targetRequest++;alignmentState.searchRequest++;alignmentState.listRequest++;
  Object.assign(alignmentState,{source:null,target:null,rows:[],offset:0,total:0,dirty:false,decision:null,user:null});
  alignmentEl("alignmentDecisionDialog").close();
  alignmentEl("alignmentSource").innerHTML='<option value="">Choose a concept</option>';
  alignmentEl("alignmentSourceDetail").innerHTML='<p class="muted">Choose a CAAL concept to compare with AAT.</p>';
  for(const id of ["alignmentCandidates","alignmentTargetDetail","alignmentSaved","alignmentCounts"]) alignmentEl(id).innerHTML="";
  for(const id of ["alignmentSearch","alignmentSearchStatus","alignmentListStatus","alignmentPage"]) {
    if(id==="alignmentSearch") alignmentEl(id).value="";else alignmentEl(id).textContent="";
  }
  alignmentEl("alignmentAllTerms").checked=false;
  alignmentEl("alignmentSearchButton").disabled=false;
  alignmentEl("alignmentStatusFilter").value="";
}
function allowAlignmentNavigation(){
  if(!alignmentState.dirty)return true;
  if(!window.confirm("Leave the unsaved alignment proposal?"))return false;
  alignmentState.dirty=false;
  alignmentEl("alignmentProposalForm")?.reset();
  if(alignmentEl("alignmentRelationHelp"))alignmentEl("alignmentRelationHelp").textContent="";
  return true;
}
async function loadAlignmentsView(){
  const select=alignmentEl("alignmentSource");
  const old=select.value;
  const concepts=activeHierarchyConcepts;
  select.innerHTML='<option value="">Choose a concept</option>'+concepts.map(c=>`<option value="${alignmentEscape(c.concept_id)}">${alignmentEscape(conceptNavigationLabel(c))} (${alignmentEscape(c.concept_id)})</option>`).join("");
  const selected=old || (selectedConcept?.concept?.lifecycle_status!=="retired"?selectedConcept?.concept?.concept_id:"");
  if(concepts.some(c=>c.concept_id===selected))select.value=selected;
  if(!select.value)alignmentEl("alignmentAllTerms").checked=true;
  if(select.value && alignmentState.source?.concept?.concept_id!==select.value) await selectAlignmentSource(select.value);
  else await loadSavedAlignments();
}
async function selectAlignmentSource(id){
  const request=++alignmentState.sourceRequest;
  alignmentState.targetRequest++;alignmentState.searchRequest++;
  alignmentState.source=null;alignmentState.target=null;alignmentState.dirty=false;alignmentState.offset=0;
  alignmentState.listRequest++;
  alignmentEl("alignmentAllTerms").checked=!id;
  alignmentEl("alignmentSaved").innerHTML="";
  alignmentEl("alignmentSearchButton").disabled=false;
  alignmentEl("alignmentCandidates").innerHTML="";alignmentEl("alignmentTargetDetail").innerHTML="";alignmentEl("alignmentSearchStatus").textContent="";
  alignmentEl("alignmentSourceDetail").textContent=id?"Loading concept...":"Choose a CAAL concept to compare with AAT.";
  alignmentEl("alignmentSearch").value="";
  if(!id){await loadSavedAlignments();return;}
  try{
    const source=await api(`/api/vocabularies/site-types/concepts/${encodeURIComponent(id)}`);
    if(request!==alignmentState.sourceRequest)return;
    alignmentState.source=source;
    const preferred=source.labels.filter(row=>String(row.status).toLowerCase()==="preferred");
    const english=preferred.find(row=>row.lang==="en")?.label||source.concept.en_label||id;
    alignmentEl("alignmentSearch").value=english;
    alignmentEl("alignmentSourceDetail").innerHTML=`
      <h4>${alignmentEscape(english)}</h4><p class="muted alignment-id">${alignmentEscape(id)} · ${alignmentEscape(source.concept.level||"")}</p>
      ${source.hierarchy.parent?`<p class="alignment-parent">Parent: ${alignmentEscape(source.hierarchy.parent.label_en||source.hierarchy.parent.concept_id)}</p>`:""}
      <div class="alignment-labels">${preferred.map(l=>`<span><strong>${alignmentEscape(l.lang)}</strong> ${alignmentEscape(l.label)}</span>`).join("")}</div>
      <h5>Definitions</h5>${source.definitions.length?source.definitions.map(d=>`<div class="alignment-definition"><span class="muted">${alignmentEscape(d.lang)}</span><p>${alignmentEscape(d.note)}</p></div>`).join(""):'<p class="muted">No definitions recorded.</p>'}
      ${source.scope_notes?.length?`<details><summary>Scope notes</summary>${source.scope_notes.map(n=>`<p><strong>${alignmentEscape(n.lang)}</strong> ${alignmentEscape(n.note)}</p>`).join("")}</details>`:""}`;
    await loadSavedAlignments();
  }catch(error){if(request===alignmentState.sourceRequest)alignmentEl("alignmentSourceDetail").textContent=error.message;}
}
async function searchAlignmentCandidates(event){
  event?.preventDefault();
  if(!allowAlignmentNavigation())return;
  const text=alignmentEl("alignmentSearch").value.trim();
  if(!text){alignmentEl("alignmentSearchStatus").textContent="Enter a term or AAT ID.";return;}
  const request=++alignmentState.searchRequest;
  alignmentState.targetRequest++;alignmentState.target=null;
  alignmentEl("alignmentTargetDetail").innerHTML="";alignmentEl("alignmentCandidates").innerHTML="";
  const status=alignmentEl("alignmentSearchStatus");status.textContent="Searching Getty AAT...";
  alignmentEl("alignmentSearchButton").disabled=true;
  try{
    const data=await api(`${ALIGNMENT_API}/aat/search?${new URLSearchParams({q:text})}`);
    if(request!==alignmentState.searchRequest)return;
    status.textContent=data.results.length?(data.has_more?"Showing 20 candidates. Refine the search for more specific results.":`${data.results.length} candidate${data.results.length===1?"":"s"}.`):"No AAT candidates found. Try another term or an AAT ID.";
    alignmentEl("alignmentCandidates").innerHTML=data.results.length?`<ul class="alignment-candidates">${data.results.map(c=>`<li><div><strong>${alignmentEscape(c.label)}</strong><span class="muted"> ${alignmentEscape(c.id)}</span>${c.parent_string?`<p>${alignmentEscape(c.parent_string)}</p>`:""}</div><button type="button" class="secondary" data-alignment-compare="${alignmentEscape(c.id)}">Compare</button></li>`).join("")}</ul>`:"";
    alignmentEl("alignmentCandidates").querySelectorAll("[data-alignment-compare]").forEach(b=>b.addEventListener("click",()=>compareAlignmentCandidate(b.dataset.alignmentCompare,text)));
  }catch(error){if(request===alignmentState.searchRequest)status.textContent=error.message;}
  finally{if(request===alignmentState.searchRequest)alignmentEl("alignmentSearchButton").disabled=false;}
}
async function compareAlignmentCandidate(id,searchText=""){
  if(!allowAlignmentNavigation())return;
  const request=++alignmentState.targetRequest;
  alignmentState.target=null;
  const panel=alignmentEl("alignmentTargetDetail");panel.textContent="Loading AAT concept...";
  try{
    const data=await api(`${ALIGNMENT_API}/aat/${encodeURIComponent(id)}`);
    if(request!==alignmentState.targetRequest)return;
    const c=data.candidate;alignmentState.target=c;
    panel.innerHTML=`<section class="alignment-selected-target"><div class="alignment-section-heading"><h4>${alignmentEscape(c.label)}</h4>${alignmentGettyLink(c.uri,"Open in Getty")}</div>
      <p class="muted alignment-id">AAT ${alignmentEscape(c.id)}</p>${c.deprecated?'<p class="error">Getty marks this concept as deprecated.</p>':""}
      ${c.parent_string?`<p class="alignment-parent">${alignmentEscape(c.parent_string)}</p>`:""}
      <h5>Definition / scope note</h5>${c.definitions.length?c.definitions.map(d=>`<div class="alignment-definition"><span class="muted">${alignmentEscape(d.language||"Unspecified language")}</span><p>${alignmentEscape(d.text)}</p></div>`).join(""):'<p class="muted">No scope note returned by Getty.</p>'}
      ${c.labels.length?`<details><summary>Labels (${c.labels.length})</summary><div class="alignment-labels">${c.labels.map(l=>`<span><strong>${alignmentEscape(l.language)}</strong> ${alignmentEscape(l.label)}</span>`).join("")}</div></details>`:""}
      ${alignmentState.source && !c.deprecated?`<form id="alignmentProposalForm" class="alignment-proposal-form">
        <label for="alignmentRelation">Relationship</label><select id="alignmentRelation" required><option value="">Choose a relationship</option>${ALIGNMENT_RELATIONS.map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select>
        <p id="alignmentRelationHelp" class="muted"></p>
        <label for="alignmentEvidence">Reason / evidence (optional)</label><textarea id="alignmentEvidence" rows="3" maxlength="4000"></textarea>
        <button type="submit" id="alignmentProposeButton">Save proposal</button><p id="alignmentProposalStatus" class="save-status" role="status"></p>
      </form>`:!alignmentState.source?'<p class="muted">Choose a CAAL concept before proposing an alignment.</p>':""}
    </section>`;
    const relation=alignmentEl("alignmentRelation");
    relation?.addEventListener("change",()=>{alignmentEl("alignmentRelationHelp").textContent=ALIGNMENT_RELATIONS.find(row=>row[0]===relation.value)?.[2]||"";alignmentState.dirty=!!relation.value||!!alignmentEl("alignmentEvidence").value;});
    alignmentEl("alignmentEvidence")?.addEventListener("input",()=>{alignmentState.dirty=!!relation.value||!!alignmentEl("alignmentEvidence").value;});
    alignmentEl("alignmentProposalForm")?.addEventListener("submit",async event=>{
      event.preventDefault();
      const sourceId=alignmentState.source?.concept?.concept_id;
      const button=alignmentEl("alignmentProposeButton"),status=alignmentEl("alignmentProposalStatus");
      if(!sourceId||!relation.value)return;
      button.disabled=true;status.textContent="Saving proposal...";
      try{
        await api(ALIGNMENT_API,{method:"POST",body:JSON.stringify({source_concept_id:sourceId,target_uri:c.uri,relation:relation.value,evidence:alignmentEl("alignmentEvidence").value,search_text:searchText})});
        if(request!==alignmentState.targetRequest)return;
        alignmentState.dirty=false;status.textContent="Proposal saved for review.";
        alignmentEl("alignmentEvidence").value="";relation.value="";alignmentEl("alignmentRelationHelp").textContent="";
        alignmentState.offset=0;alignmentEl("alignmentStatusFilter").value="";
        await loadSavedAlignments();
      }catch(error){if(request===alignmentState.targetRequest)status.textContent=error.message;}
      finally{button.disabled=false;}
    });
  }catch(error){if(request===alignmentState.targetRequest)panel.textContent=error.message;}
}
async function loadSavedAlignments(){
  const request=++alignmentState.listRequest;
  const status=alignmentEl("alignmentListStatus");status.textContent="Loading alignments...";
  const params=new URLSearchParams({offset:alignmentState.offset});
  if(alignmentEl("alignmentSource").value&&!alignmentEl("alignmentAllTerms").checked)params.set("source_concept_id",alignmentEl("alignmentSource").value);
  if(alignmentEl("alignmentStatusFilter").value)params.set("status",alignmentEl("alignmentStatusFilter").value);
  try{
    let data=await api(`${ALIGNMENT_API}?${params}`);
    if(request!==alignmentState.listRequest)return;
    if(data.total && data.offset>=data.total){alignmentState.offset=0;return loadSavedAlignments();}
    alignmentState.rows=data.rows;alignmentState.total=data.total;alignmentState.limit=data.limit;
    alignmentEl("alignmentCounts").innerHTML=Object.entries(data.counts).map(([key,value])=>`<span>${alignmentStatus(key)} <strong>${value}</strong></span>`).join("");
    status.textContent="";
    alignmentEl("alignmentSaved").innerHTML=data.rows.length?data.rows.map(a=>`<article class="alignment-saved-row">
      <div class="alignment-saved-main"><div><strong>${alignmentEscape(a.source_label)}</strong> <span class="muted">${alignmentEscape(a.source_concept_id)}</span><span class="alignment-relation">${alignmentEscape(alignmentRelation(a.relation))}</span>${alignmentGettyLink(a.target_uri,a.target_label)} <span class="muted">${alignmentEscape(a.target_uri.split('/').pop())}</span></div>
        <span class="alignment-status alignment-status-${alignmentEscape(a.status)}">${alignmentStatus(a.status)}</span></div>
      <p class="muted alignment-attribution">${a.imported_from_publication?"Imported from published mapping file":`Proposed by ${alignmentEscape(a.proposed_by_username)}`} · ${alignmentEscape(formatDate(a.proposed_at))}${a.reviewed_by_username?` · ${a.status==="deprecated"?"Withdrawn":"Reviewed"} by ${alignmentEscape(a.reviewed_by_username)}`:""}</p>
      ${a.evidence?`<p class="alignment-evidence">${alignmentEscape(a.evidence)}</p>`:""}
      ${a.review_note?`<p><strong>Review note:</strong> ${alignmentEscape(a.review_note)}</p>`:""}
      ${a.candidate_snapshot?.definitions?.length?`<details class="alignment-saved-definition"><summary>Saved AAT definition</summary>${a.candidate_snapshot.definitions.map(d=>`<p><span class="muted">${alignmentEscape(d.language)}</span> ${alignmentEscape(d.text)}</p>`).join("")}${a.candidate_snapshot.fetched_at?`<p class="muted">Retrieved ${alignmentEscape(formatDate(a.candidate_snapshot.fetched_at))}</p>`:""}</details>`:""}
      <div class="alignment-row-actions">${a.status==="proposed"?`<button type="button" data-alignment-action="accept" data-alignment-id="${a.alignment_id}">Approve</button><button type="button" class="secondary" data-alignment-action="reject" data-alignment-id="${a.alignment_id}">Reject</button>`:a.status==="accepted"?`<button type="button" class="secondary" data-alignment-action="deprecate" data-alignment-id="${a.alignment_id}">Withdraw</button>`:""}
        <button type="button" class="secondary" data-alignment-inspect="${a.alignment_id}">Inspect</button>
        <button type="button" class="secondary" data-alignment-history="${a.alignment_id}">History</button>
      </div><div id="alignmentHistory${a.alignment_id}"></div>
    </article>`).join(""):'<p class="empty-state">No alignments match this selection.</p>';
    alignmentEl("alignmentPrevious").disabled=alignmentState.offset===0;
    alignmentEl("alignmentNext").disabled=alignmentState.offset+data.limit>=data.total;
    alignmentEl("alignmentPage").textContent=data.total?`${data.offset+1}-${Math.min(data.offset+data.rows.length,data.total)} of ${data.total}`:"";
    alignmentEl("alignmentSaved").querySelectorAll("[data-alignment-action]").forEach(b=>b.addEventListener("click",()=>openAlignmentDecision(b.dataset.alignmentId,b.dataset.alignmentAction)));
    alignmentEl("alignmentSaved").querySelectorAll("[data-alignment-inspect]").forEach(b=>b.addEventListener("click",async()=>{
      if(!allowAlignmentNavigation())return;
      const row=alignmentState.rows.find(a=>String(a.alignment_id)===b.dataset.alignmentInspect);
      if(!row)return;
      alignmentEl("alignmentSource").value=row.source_concept_id;
      if(alignmentEl("alignmentSource").value){await selectAlignmentSource(row.source_concept_id);await compareAlignmentCandidate(row.target_uri.split('/').pop(),row.search_text);}
      else {alignmentEl("alignmentListStatus").textContent="This CAAL concept is retired. Its saved evidence remains in History.";}
    }));
    alignmentEl("alignmentSaved").querySelectorAll("[data-alignment-history]").forEach(b=>b.addEventListener("click",async()=>{
      const panel=alignmentEl(`alignmentHistory${b.dataset.alignmentHistory}`);
      if(panel.textContent){panel.textContent="";return;}
      panel.textContent="Loading history...";
      try{const result=await api(`${ALIGNMENT_API}/${b.dataset.alignmentHistory}/history`);panel.innerHTML=`<ul class="alignment-history">${result.events.map(e=>`<li><strong>${alignmentEscape(e.action)}</strong> · ${alignmentEscape(e.changed_by_username)} · ${alignmentEscape(formatDate(e.changed_at))}${e.new_data.review_note?`<p>${alignmentEscape(e.new_data.review_note)}</p>`:""}</li>`).join("")}</ul>`;}
      catch(error){panel.textContent=error.message;}
    }));
  }catch(error){if(request===alignmentState.listRequest)status.textContent=error.message;}
}
function openAlignmentDecision(id,action){
  const row=alignmentState.rows.find(a=>String(a.alignment_id)===String(id));if(!row)return;
  alignmentState.decision={row,action};
  const word={accept:"Approve",reject:"Reject",deprecate:"Withdraw"}[action];
  alignmentEl("alignmentDecisionTitle").textContent=`${word} alignment`;
  alignmentEl("alignmentDecisionSummary").innerHTML=`<p><strong>${alignmentEscape(row.source_label)}</strong> → ${alignmentEscape(row.target_label)}</p><p>${alignmentEscape(alignmentRelation(row.relation))}</p>${action==="deprecate"?'<p class="muted">The mapping will be removed from the public vocabulary on the next publication.</p>':action==="accept"?'<p class="muted">The mapping will be included in the next publication.</p>':""}`;
  alignmentEl("alignmentDecisionNote").value="";alignmentEl("alignmentDecisionStatus").textContent="";alignmentEl("alignmentDecisionConfirm").textContent=word;
  alignmentEl("alignmentDecisionDialog").showModal();
}
alignmentEl("alignmentDecisionForm").addEventListener("submit",async event=>{
  event.preventDefault();const decision=alignmentState.decision;if(!decision)return;
  const dialog=alignmentEl("alignmentDecisionDialog");dialog.dataset.saving="true";
  alignmentEl("alignmentDecisionConfirm").disabled=true;alignmentEl("alignmentDecisionCancel").disabled=true;
  alignmentEl("alignmentDecisionStatus").textContent="Saving decision...";
  try{
    await api(`${ALIGNMENT_API}/${decision.row.alignment_id}/decision`,{method:"POST",body:JSON.stringify({action:decision.action,version:decision.row.version,note:alignmentEl("alignmentDecisionNote").value})});
    dialog.close();alignmentState.decision=null;await loadSavedAlignments();
  }catch(error){alignmentEl("alignmentDecisionStatus").textContent=error.message;}
  finally{delete dialog.dataset.saving;alignmentEl("alignmentDecisionConfirm").disabled=false;alignmentEl("alignmentDecisionCancel").disabled=false;}
});
alignmentEl("alignmentDecisionCancel").addEventListener("click",()=>alignmentEl("alignmentDecisionDialog").close());
alignmentEl("alignmentDecisionDialog").addEventListener("cancel",event=>{if(event.currentTarget.dataset.saving)event.preventDefault();});
alignmentEl("alignmentSearchForm").addEventListener("submit",searchAlignmentCandidates);
alignmentEl("alignmentSource").addEventListener("change",event=>{
  if(!allowAlignmentNavigation()){event.target.value=alignmentState.source?.concept?.concept_id||"";return;}
  selectAlignmentSource(event.target.value);
});
for(const id of ["alignmentAllTerms","alignmentStatusFilter"])alignmentEl(id).addEventListener("change",()=>{alignmentState.offset=0;loadSavedAlignments();});
alignmentEl("alignmentRefresh").addEventListener("click",()=>loadSavedAlignments());
alignmentEl("alignmentPrevious").addEventListener("click",()=>{alignmentState.offset=Math.max(0,alignmentState.offset-alignmentState.limit);loadSavedAlignments();});
alignmentEl("alignmentNext").addEventListener("click",()=>{alignmentState.offset+=alignmentState.limit;loadSavedAlignments();});
document.querySelectorAll("[data-main-tab]").forEach(button=>button.addEventListener("click",event=>{if(button.dataset.mainTab!=="alignments"&&!allowAlignmentNavigation()){event.preventDefault();event.stopImmediatePropagation();}},{capture:true}));
window.addEventListener("beforeunload",event=>{if(alignmentState.dirty){event.preventDefault();event.returnValue="";}});
