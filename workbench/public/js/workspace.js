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
  document.getElementById("workspaceVocabulary").addEventListener("change",event=>changeVocabulary(event.target.value));
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
    const row=reviewCoverage.get(id);if(!row)return "";
    const title=row.conflict?"Duplicate entries":row.missing_label&&row.missing_definition?"Label and definition missing":row.missing_label?"Label missing":row.missing_definition?"Definition missing":"Complete";
    return `<span class="tree-coverage${row.missing_label||row.missing_definition||row.conflict?'':' tree-coverage-mapped'}">${title}</span>`;
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
