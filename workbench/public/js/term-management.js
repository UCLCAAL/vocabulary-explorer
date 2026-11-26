/* Generic descriptive-list controls. Site Types retain their existing editor. */
function managedVocabulary(){return vocabularyCatalog.find(v=>v.vocabulary_code===selectedVocabularyCode)?.management;}
function managementDateFields(c={}){
 return `<fieldset><legend>Chronology (optional)</legend><p class="muted">Signed years: negative for BCE, positive for CE. Leave unknown dates blank. No year zero.</p>
 <label>Start year<input name="date_from" type="number" step="1" value="${escapeHtml(c.date_from??'')}" data-management-draft></label>
 <label>End year<input name="date_to" type="number" step="1" value="${escapeHtml(c.date_to??'')}" data-management-draft></label>
 <label>Date range label<input name="date_range" maxlength="500" value="${escapeHtml(c.date_range??'')}" data-management-draft placeholder="For example: c. 500 BCE to 200 CE"></label></fieldset>`;
}
function managementDates(form){return Object.fromEntries(['date_from','date_to','date_range'].map(k=>[k,form.elements[k].value]));}
function markManagementSaved(form){for(const el of form.querySelectorAll('[data-management-draft]'))el.dataset.original=el.value;markEditorDirty();}
function bindManagementDrafts(container){for(const el of container.querySelectorAll('[data-management-draft]')){el.dataset.original=el.value;el.addEventListener('input',markEditorDirty);el.addEventListener('change',markEditorDirty);}}
function openManagedNewTerm(){
 if(!managedVocabulary()||!allowEditorNavigation())return;
 creatingConcept=true;document.getElementById('conceptEmpty').hidden=true;document.getElementById('conceptDetail').hidden=false;
 document.getElementById('conceptTitle').textContent='New term';document.getElementById('conceptId').textContent='ID allocated when saved';document.getElementById('conceptLevel').textContent='';document.querySelector('.detail-tabs').hidden=true;
 const box=document.getElementById('detailContent');
 box.innerHTML=`<form id="managedNewTerm" class="new-concept-form"><p>Saving adds this term to the database lookup. Publish ${escapeHtml(vocabularyTitle())} to update the Vocabulary Explorer.</p>
 ${LANGUAGES.map(([lang,name])=>`<label>${escapeHtml(name)} preferred label${lang==='en'?' (required)':''}<input name="label_${lang}" maxlength="500" ${lang==='en'?'required':''} data-management-draft></label>`).join('')}
 ${managedVocabulary()==='hierarchical'?`<label>Parent<select name="parent_id" data-management-draft><option value="">No parent - top concept</option>${activeHierarchyConcepts.filter(c=>Number(String(c.level).replace(/^L/,''))<4).map(c=>`<option value="${escapeHtml(c.concept_id)}">${escapeHtml(c.en_label)} (${escapeHtml(c.concept_id)})</option>`).join('')}</select></label>${managementDateFields()}`:''}
 <button>Create term</button><button type="button" data-cancel>Cancel</button><span class="save-status" role="status"></span></form>`;
 bindManagementDrafts(box);box.querySelector('[data-cancel]').onclick=()=>{if(!allowEditorNavigation())return;creatingConcept=false;if(selectedConcept)loadConcept(selectedConcept.concept.concept_id,true);else{document.getElementById('conceptDetail').hidden=true;document.getElementById('conceptEmpty').hidden=false;}};
 const form=box.querySelector('form');form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('.save-status');button.disabled=true;
  const body={labels:Object.fromEntries(LANGUAGES.map(([lang])=>[lang,form.elements['label_'+lang].value]))};
  if(managedVocabulary()==='hierarchical')Object.assign(body,managementDates(form),{parent_id:form.elements.parent_id.value||null});
  try{const result=await api(`/api/vocabularies/${selectedVocabularyCode}/concepts`,{method:'POST',body:JSON.stringify(body)});markManagementSaved(form);creatingConcept=false;await Promise.all([loadHierarchyTree(),loadVocabularySummary()]);await loadConcept(result.concept.concept_id,true);}
  catch(e){status.textContent=e.message;}finally{button.disabled=false;}
 };
}
function openManagedTerm(){
 if(!managedVocabulary()||!selectedConcept||!allowEditorNavigation())return;
 const c=selectedConcept.concept,retired=c.lifecycle_status==='retired',box=document.getElementById('conceptManagementContent');
 document.getElementById('conceptManagementTitle').textContent='Manage '+c.concept_id;
 box.innerHTML=`${!retired&&managedVocabulary()==='hierarchical'?`<form data-action="dates" class="concept-management-section">${managementDateFields(c)}<button>Save chronology</button><span class="save-status"></span></form>
 <form data-action="parent" class="concept-management-section"><h3>Change parent</h3><p class="muted">Same-level moves retain the ID. A move to another level creates a successor for an unused leaf term.</p><select name="parent_id" data-management-draft><option value="">No parent</option>${managementOptions(c.parent_id,true)}</select><button>Save parent</button><span class="save-status"></span></form>`:''}
 ${!retired?`<form data-action="retire" class="concept-management-section"><h3>Retire term</h3><p class="muted">Keeps existing record values and labels. A replacement is advisory; records are not rewritten.</p><label>Replacement (optional)<select name="replacement_concept_id" data-management-draft><option value="">No replacement</option>${managementOptions()}</select></label><button>Retire term</button><span class="save-status"></span></form>`:''}
 <form data-action="delete" class="concept-management-section"><h3>Delete unused term</h3><p class="muted">Record use, narrower terms and references block deletion. The ID stays reserved.</p><label>Enter ${escapeHtml(c.concept_id)}<input name="confirm_id" required autocomplete="off" data-management-draft></label><button class="danger-button">Delete term</button><span class="save-status"></span></form>`;
 bindManagementDrafts(box);
 for(const form of box.querySelectorAll('form'))form.onsubmit=async event=>{
  event.preventDefault();const action=form.dataset.action,status=form.querySelector('.save-status'),buttons=[...box.querySelectorAll('button')];
  if(action!=='dates'&&[...box.querySelectorAll('[data-management-draft]')].some(el=>!form.contains(el)&&el.value!==el.dataset.original)){status.textContent='Save or discard the changes in the other sections first.';return;}
  if(action==='retire'&&!confirm('Retire this term for new records while preserving existing record labels?'))return;
  const body={expected:selectedConcept.version,confirm_id:c.concept_id};
  if(action==='dates')Object.assign(body,managementDates(form));
  if(action==='parent')body.parent_id=form.elements.parent_id.value||null;
  if(action==='retire')body.replacement_concept_id=form.elements.replacement_concept_id.value||null;
  if(action==='delete')body.confirm_id=form.elements.confirm_id.value;
  buttons.forEach(b=>b.disabled=true);managementDialog.dataset.saving='true';document.getElementById('closeConceptManagement').disabled=true;status.textContent='Checking and saving...';
  try{
   const result=await api(`/api/vocabularies/${selectedVocabularyCode}/concepts/${encodeURIComponent(c.concept_id)}${action==='delete'?'':'/'+action}`,{method:action==='delete'?'DELETE':action==='retire'?'POST':'PUT',body:JSON.stringify(body)});
   markManagementSaved(form);selectedConcept.version=result.version||selectedConcept.version;
   if(hasWorkbenchEditorChanges()){status.textContent='Saved. Other unsaved changes remain in this dialog.';return;}
   managementDialog.close();document.getElementById('showRetiredConcepts').checked=action==='retire';
   await Promise.all([loadHierarchyTree(),loadVocabularySummary()]);
   if(action==='delete'){selectedConcept=null;document.getElementById('conceptDetail').hidden=true;document.getElementById('conceptEmpty').hidden=false;}
   else await loadConcept(result.concept.concept_id,true);
  }catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);delete managementDialog.dataset.saving;document.getElementById('closeConceptManagement').disabled=false;}
 };
 managementDialog.showModal();
}
