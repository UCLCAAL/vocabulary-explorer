// One navigation tree shared by the concept editor, language review and alignments.
let workbenchTab="vocabularies";
let workspaceSelectedId="";
let reviewCoverage=new Map();
let workspaceSearchRequest=0;
let workspaceSearchTimer=null;
let workspaceSearchOpening=false;

function initialiseWorkspace(){
  const view=document.getElementById("vocabulariesView"),aside=view.querySelector("aside");
  const workspace=document.createElement("div");workspace.id="vocabularyWorkspace";workspace.className="vocabulary-workspace";
  const content=document.createElement("div");content.className="vocabulary-workspace-content";
  view.before(workspace);workspace.append(aside,content);
  for(const id of ["vocabulariesView","reviewView","alignmentsView","publishingView"])content.append(document.getElementById(id));
  const heading=aside.querySelector("h2");
  heading.insertAdjacentHTML("beforebegin",'<label class="workspace-vocabulary-label" for="workspaceVocabulary">Vocabulary</label><select id="workspaceVocabulary" aria-label="Vocabulary"><option value="site-types">Site Types</option></select>');
  heading.hidden=true;
  aside.querySelector(".muted").remove();
  const picker=aside.querySelector(".panel-heading");
  picker.insertAdjacentHTML("beforebegin",`
    <div class="search">
      <input id="workspaceVocabularySearch" type="search" placeholder="Search terms in all vocabularies"
        aria-label="Search terms in all vocabularies" aria-controls="workspaceVocabularySearchResults" autocomplete="off">
      <small id="workspaceVocabularySearchStatus" class="muted" role="status"></small>
      <div id="workspaceVocabularySearchResults" aria-label="Terms across all vocabularies" hidden></div>
    </div>
  `);
  const search=document.getElementById("workspaceVocabularySearch");
  search.addEventListener("input",()=>{
    clearTimeout(workspaceSearchTimer);
    const request=++workspaceSearchRequest;
    const results=document.getElementById("workspaceVocabularySearchResults");
    results.hidden=true;results.replaceChildren();
    document.getElementById("workspaceVocabularySearchStatus").textContent=search.value.trim()?"Searching...":"";
    if(search.value.trim())workspaceSearchTimer=setTimeout(()=>searchWorkspaceTerms(search.value,request),250);
  });
  search.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      search.value="";search.dispatchEvent(new Event("input"));event.preventDefault();
    }
  });
  document.getElementById("workspaceVocabulary").addEventListener("change",event=>changeVocabulary(event.target.value));
  initialiseReviewOverview();
}

function renderWorkspaceVocabularyOptions(){
  const select=document.getElementById("workspaceVocabulary");
  const options=vocabularyCatalog.map(v=>new Option(v.title,v.vocabulary_code));
  select.replaceChildren(...options);
  select.value=selectedVocabularyCode;
}

async function searchWorkspaceTerms(query,request){
  const results=document.getElementById("workspaceVocabularySearchResults");
  const status=document.getElementById("workspaceVocabularySearchStatus");
  try{
    const data=await api("/api/vocabularies/search?q="+encodeURIComponent(query.trim()));
    if(request!==workspaceSearchRequest)return;
    status.textContent=data.total>data.concepts.length?
      "Showing "+data.concepts.length+" of "+data.total+" terms. Refine your search.":
      data.total?data.total+" matching terms.":"No matching terms.";
    results.innerHTML=data.concepts.map((r,i)=>`<button type="button" class="concept-search-result" data-workspace-result="${i}">
      <span class="concept-search-result-main"><strong>${escapeHtml(r.en_label)}</strong>
        <span class="concept-row-id">${escapeHtml(r.concept_id)}</span></span>
      <span>${escapeHtml(r.vocabulary_title)}</span>
      <span class="concept-row-match">${escapeHtml(r.match_label)}${r.match_lang?" ("+escapeHtml(r.match_lang)+")":""}</span>
    </button>`).join("");
    results.hidden=!data.concepts.length;
    results.querySelectorAll("[data-workspace-result]").forEach(button=>button.addEventListener("click",async()=>{
      if(workspaceSearchOpening)return;
      if(!allowEditorNavigation()||!allowReviewNavigation()||!allowAlignmentNavigation())return;
      workspaceSearchOpening=true;
      const r=data.concepts[Number(button.dataset.workspaceResult)];
      try{
        if(r.vocabulary_code!==selectedVocabularyCode)await changeVocabulary(r.vocabulary_code);
        if(selectedVocabularyCode!==r.vocabulary_code)return;
        await setWorkspaceTab("vocabularies");
        document.querySelectorAll("[data-main-tab]").forEach(b=>b.classList.toggle("active",b.dataset.mainTab==="vocabularies"));
        document.querySelectorAll("[data-main-view]").forEach(v=>{v.hidden=v.dataset.mainView!=="vocabularies";});
        await workspaceSelectConcept(r.concept_id);
      }catch(e){status.textContent=e.message;}finally{workspaceSearchOpening=false;}
    }));
  }catch(e){
    if(request!==workspaceSearchRequest)return;
    results.hidden=true;status.textContent=e.message;
  }
}

function workspaceTreeFilterIds(){
  if(workbenchTab!=="alignments" || !alignmentState.coverageReady)return null;
  const filter=document.getElementById("alignmentCoverageFilter").value;
  if(!filter)return null;
  const ids=new Set(alignmentState.coverage.filter(r=>r.state===filter).map(r=>r.concept_id));
  if(alignmentState.coverage.some(r=>r.concept_id===workspaceSelectedId))ids.add(workspaceSelectedId);
  for(const id of [...ids]){
    let node=hierarchyById.get(id);const seen=new Set();
    while(node?.parent_id&&!seen.has(node.parent_id)){seen.add(node.parent_id);ids.add(node.parent_id);node=hierarchyById.get(node.parent_id);}
  }
  return ids;
}

function workspaceConceptBadge(id){
  if(workbenchTab==="alignments"){
    const row=alignmentState.coverage.find(r=>r.concept_id===id);
    if(!row)return "";
    const title={unmapped:"No mapping",awaiting:"Awaiting approval",mapped:"Mapped"}[row.state];
    const filter=document.getElementById("alignmentCoverageFilter").value;
    if(filter&&row.state!==filter)return `<span class="tree-coverage tree-coverage-context">${id===workspaceSelectedId?`Selected · ${escapeHtml(title)}`:'Parent branch'}</span>`;
    return `<span class="tree-coverage tree-coverage-${row.state}">${escapeHtml(title)}</span>`;
  }
  if(workbenchTab==="review"){
    return allLanguageReviewBadge(id);
  }
  return "";
}

function workspaceMarkConcept(id){
  workspaceSelectedId=id||"";
  if(id)expandPathToConcept(id);
  updateVocabularyControls();
  renderHierarchyTree();
}

async function workspaceSelectConcept(id){
  if(!allowEditorNavigation()||!allowReviewNavigation()||!allowAlignmentNavigation())return;
  if(workbenchTab==="alignments"){
    document.getElementById("alignmentSource").value=id;
    await selectAlignmentSource(id);
  }else if(workbenchTab==="review"){
    workspaceMarkConcept(id);
    document.getElementById("reviewScope").value="branch";
    reviewOffset=0;await loadReview();
  }else await loadConcept(id);
}

async function setWorkspaceTab(tab){
  workbenchTab=tab;
  document.getElementById("vocabularyWorkspace").hidden=false;
  newConceptButton.hidden=tab!=="vocabularies";
  document.querySelector(".retired-toggle").hidden=tab!=="vocabularies";
  if(tab!=="vocabularies"&&document.getElementById("showRetiredConcepts").checked){
    document.getElementById("showRetiredConcepts").checked=false;await loadHierarchyTree();
    if(!activeHierarchyConcepts.some(c=>c.concept_id===workspaceSelectedId))workspaceSelectedId="";
  }
  if(tab==="vocabularies"&&workspaceSelectedId&&selectedConcept?.concept?.concept_id!==workspaceSelectedId)await loadConcept(workspaceSelectedId);
  updateVocabularyControls();
  renderHierarchyTree();
}
