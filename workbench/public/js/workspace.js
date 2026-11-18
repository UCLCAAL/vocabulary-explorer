// One navigation tree shared by the concept editor, language review and alignments.
let workbenchTab="vocabularies";
let workspaceSelectedId="";
let reviewCoverage=new Map();

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
      <input id="workspaceVocabularySearch" type="search" placeholder="Search vocabularies"
        aria-label="Search vocabularies" aria-controls="workspaceVocabulary" autocomplete="off">
      <small id="workspaceVocabularySearchStatus" class="muted" role="status"></small>
    </div>
  `);
  document.getElementById("workspaceVocabularySearch").addEventListener("input",renderWorkspaceVocabularyOptions);
  document.getElementById("workspaceVocabulary").addEventListener("change",event=>changeVocabulary(event.target.value));
  initialiseReviewOverview();
}

function renderWorkspaceVocabularyOptions(){
  const select=document.getElementById("workspaceVocabulary");
  const query=document.getElementById("workspaceVocabularySearch").value.trim().toLowerCase();
  const matches=vocabularyCatalog.filter(v=>v.title.toLowerCase().includes(query)||v.vocabulary_code.includes(query));
  const options=matches.map(v=>new Option(v.title,v.vocabulary_code));
  const current=vocabularyCatalog.find(v=>v.vocabulary_code===selectedVocabularyCode);
  if(current&&!matches.includes(current))options.unshift(new Option(current.title+" (current)",current.vocabulary_code));
  select.replaceChildren(...options);
  select.value=selectedVocabularyCode;
  document.getElementById("workspaceVocabularySearchStatus").textContent=
    query&&!matches.length?"No matching vocabularies.":"";
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
