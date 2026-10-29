let selectedVocabularyCode='site-types';
let vocabularyCatalog=[];
let editorDirty=false;
let vocabularySwitchRequest=0;
const isGenericVocabulary=()=>selectedVocabularyCode!=='site-types';
function vocabularyTitle(){return vocabularyCatalog.find(v=>v.vocabulary_code===selectedVocabularyCode)?.title||'Site Types';}
function allowEditorNavigation(){if(!editorDirty)return true;if(!confirm('Leave the unsaved text changes?'))return false;editorDirty=false;return true;}
async function loadVocabularyCatalog(){
 const data=await api('/api/vocabularies/catalog');vocabularyCatalog=data.vocabularies;
 const select=document.getElementById('workspaceVocabulary');
 select.innerHTML=vocabularyCatalog.map(v=>`<option value="${escapeHtml(v.vocabulary_code)}">${escapeHtml(v.title)}</option>`).join('');select.value=selectedVocabularyCode;
 updateVocabularyControls();
}
function updateVocabularyControls(){
 const generic=isGenericVocabulary(),title=vocabularyTitle();
 newConceptButton.hidden=generic||workbenchTab!=='vocabularies';
 document.querySelector('.retired-toggle').hidden=generic||workbenchTab!=='vocabularies';
 document.getElementById('manageConceptButton').hidden=generic;
 conceptSearch.placeholder='Search labels or concept ID';conceptTree.setAttribute('aria-label',title+' hierarchy');
 for(const id of ['reviewView','publishingView'])document.querySelector('#'+id+' .eyebrow').textContent=title;
 document.querySelector('#alignmentsView .eyebrow').textContent=title+' · Getty AAT';
 document.querySelector('#publishingView p.muted').textContent='Saving updates PostgreSQL immediately. Publishing updates this vocabulary in Skosmos, including accepted alignments.';
 document.getElementById('publishSiteTypesButton').textContent='Publish '+title;
 document.querySelector('[data-detail-tab="bibliography"]').hidden=generic;
}
async function changeVocabulary(code){
 if(code===selectedVocabularyCode)return;
 const select=document.getElementById('workspaceVocabulary');
 if(!allowEditorNavigation()||!allowReviewNavigation()||!allowAlignmentNavigation()){select.value=selectedVocabularyCode;return;}
 const request=++vocabularySwitchRequest;
 selectedVocabularyCode=code;currentVocabulary=null;selectedConcept=null;workspaceSelectedId='';creatingConcept=false;
 conceptDetailRequestId++;hierarchyRequestId++;conceptSearchRequestId++;reviewRequestId++;reviewUsageRequestId++;reviewUsageController?.abort();
 document.getElementById('reviewUsageDialog').close();document.getElementById('conceptManagementDialog').close();
 resetAlignments();reviewOffset=0;reviewCoverage.clear();editorDirty=false;
 document.getElementById('showRetiredConcepts').checked=false;document.getElementById('reviewScope').value='all';
 document.getElementById('conceptDetail').hidden=true;document.getElementById('conceptEmpty').hidden=false;
 document.getElementById('conceptSearchResults').hidden=true;conceptSearch.value='';
 document.getElementById('reviewTable').innerHTML='';document.getElementById('reviewCounts').innerHTML='';
 hierarchyConcepts=[];activeHierarchyConcepts=[];hierarchyById.clear();hierarchyChildren.clear();expandedTreeIds.clear();renderHierarchyTree();updateVocabularyControls();
 try{
  await Promise.all([loadVocabularySummary(),loadHierarchyTree()]);if(request!==vocabularySwitchRequest)return;
  if(workbenchTab==='review')await loadReview();if(workbenchTab==='alignments')await loadAlignmentsView();if(workbenchTab==='publishing')await loadPublishingStatus();
 }catch(e){document.getElementById('vocabularySummary').textContent=e.message;}
}
function markEditorDirty(){editorDirty=Array.from(document.querySelectorAll('[data-generic-text],[data-vocabulary-text]')).some(i=>i.value!==i.dataset.original);}
function genericValues(field,lang){const rows=field==='definition'?selectedConcept.definitions:field==='scopeNote'?selectedConcept.scope_notes:selectedConcept.labels;return rows.filter(r=>r.lang===lang&&(field==='preferred'?r.status==='preferred':field==='alternative'?r.status==='alt':true)).map(r=>r.label??r.note);}
function renderGenericTextEditor(field){
 return '<div class="editor-list">'+LANGUAGES.map(([lang,name])=>{
 const vals=genericValues(field,lang),multiple=field!=='alternative'&&vals.length>1,value=vals.join('\n'),input=field==='preferred'?`<input data-generic-text data-original="${escapeHtml(value)}" value="${escapeHtml(value)}" aria-label="${name} preferred label">`:`<textarea data-generic-text data-original="${escapeHtml(value)}" rows="${field==='alternative'?2:4}" aria-label="${name} ${escapeHtml(field)}">${escapeHtml(value)}</textarea>`;
 return `<form class="editor-row" data-generic-form data-field="${field}" data-lang="${lang}" data-expected="${escapeHtml(JSON.stringify(vals))}"><div class="editor-language"><strong>${name}</strong><span>${lang}</span></div><div class="editor-field">${input}<span class="save-status" role="status"></span></div><button type="submit" ${multiple?"disabled title=\"Multiple stored notes need review\"":""}>Save</button></form>`;
 }).join('')+'</div>';
}
function renderGenericDetail(){
 const container=document.getElementById('detailContent'),tab=selectedDetailTab;
 if(tab==='labels')container.innerHTML='<h3>Preferred labels</h3>'+renderGenericTextEditor('preferred')+'<h3>Alternative labels <span class="muted">(optional, one per line)</span></h3>'+renderGenericTextEditor('alternative');
 else if(tab==='definitions'||tab==='scope-notes')container.innerHTML=renderGenericTextEditor(tab==='definitions'?'definition':'scopeNote');
 else if(tab==='history'){
  container.innerHTML='<table class="data-table"><thead><tr><th>When / who</th><th>Field / language</th><th>Previous</th><th>Saved</th></tr></thead><tbody>'+selectedConcept.history.map(r=>`<tr><td>${escapeHtml(formatDate(r.changed_at))}<br>${escapeHtml(r.changed_by_username)}</td><td>${escapeHtml(r.entity_type)} (${escapeHtml(r.lang)})</td><td>${escapeHtml(r.old_data.join('; '))}</td><td>${escapeHtml(r.new_data.join('; '))}</td></tr>`).join('')+'</tbody></table>';
 }else if(tab==='hierarchy'){
  const relatives=[...selectedConcept.hierarchy.ancestors,selectedConcept.concept,...selectedConcept.hierarchy.children];
  container.innerHTML=relatives.map(r=>`<p><button type="button" class="tree-text-action" data-generic-open="${escapeHtml(r.concept_id)}">${escapeHtml(r.en_label||r.concept_id)}</button> <span class="muted">${escapeHtml(r.concept_id)}</span></p>`).join('');
 }else container.innerHTML=renderOverview(selectedConcept);
 bindCopyButtons();
 container.querySelectorAll('[data-generic-open]').forEach(b=>b.addEventListener('click',()=>{if(allowEditorNavigation())loadConcept(b.dataset.genericOpen);}));
 container.querySelectorAll('[data-generic-text]').forEach(i=>i.addEventListener('input',markEditorDirty));
 container.querySelectorAll('[data-generic-form]').forEach(f=>f.addEventListener('submit',async event=>{
  event.preventDefault();const field=f.dataset.field,lang=f.dataset.lang,i=f.querySelector('[data-generic-text]'),b=f.querySelector('button'),status=f.querySelector('.save-status');
  const vals=field==='alternative'?i.value.split('\n').map(s=>s.trim()).filter(Boolean):i.value.trim()?[i.value.trim()]:[];
  const code=selectedVocabularyCode,id=selectedConcept.concept.concept_id; b.disabled=true;status.textContent='Saving...';
  try{
   await api(`/api/vocabularies/${code}/concepts/${encodeURIComponent(id)}/text/${field}/${lang}`,{method:'PUT',body:JSON.stringify({values:vals,expected:JSON.parse(f.dataset.expected)})});
   if(code!==selectedVocabularyCode||!f.isConnected)return;
   f.dataset.expected=JSON.stringify(vals);i.value=vals.join('\n');i.dataset.original=i.value;status.textContent='Saved';markEditorDirty();
   const prop=field==='definition'?'definitions':field==='scopeNote'?'scope_notes':'labels';
   selectedConcept[prop]=selectedConcept[prop].filter(r=>!(r.lang===lang&&(field==='preferred'?r.status==='preferred':field==='alternative'?r.status==='alt':true)));
   selectedConcept[prop].push(...vals.map((value,n)=>prop==='labels'?{lang,label:value,status:field==='preferred'?'preferred':'alt',label_id:field+':'+lang+':'+n}:{lang,note:value,note_type:field}));
   if(field==='preferred'&&lang==='en'){selectedConcept.concept.en_label=vals[0];document.getElementById('conceptTitle').textContent=vals[0];}
   await Promise.all([loadVocabularySummary(),loadHierarchyTree()]);
  }catch(e){status.textContent=e.message;}finally{b.disabled=false;}
 }));
}
async function loadVocabularyDescriptions(){
 const code=selectedVocabularyCode,panel=document.getElementById('vocabularyDescriptions');if(!panel)return;
 try{
  const data=await api(`/api/vocabularies/${code}/descriptions`);if(code!==selectedVocabularyCode||!panel.isConnected)return;
  panel.innerHTML='<details><summary>About this vocabulary</summary><label>Language<select id="descriptionLanguage">'+LANGUAGES.map(([l,n])=>`<option value="${l}">${n}</option>`).join('')+'</select></label><div id="descriptionEditor"></div></details>';
  const select=panel.querySelector('select');select.value=document.getElementById('reviewLanguage').value||'en';let prev=select.value;
  const render=()=>{const row=data.rows.find(r=>r.lang===select.value);panel.querySelector('#descriptionEditor').innerHTML=['description','editorial'].map(field=>`<form data-description-form data-field="${field}"><label>${field==='description'?'Public vocabulary description':'Editorial note (workbench only)'}<textarea data-vocabulary-text data-original="${escapeHtml(row[field])}" rows="4">${escapeHtml(row[field])}</textarea></label><button type="submit" ${(row[field+"_values"]||[]).length>1?"disabled title=\"Multiple stored notes need review\"":""}>Save</button> <span class="save-status" role="status"></span></form>`).join('');
   panel.querySelectorAll('textarea').forEach(i=>i.addEventListener('input',markEditorDirty));
   panel.querySelectorAll('form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();const field=f.dataset.field,i=f.querySelector('textarea'),b=f.querySelector('button'),status=f.querySelector('.save-status');b.disabled=true;
    try{await api(`/api/vocabularies/${code}/descriptions/${row.lang}`,{method:'PUT',body:JSON.stringify({field,text:i.value.trim(),expected:row[field]?[row[field]]:[]})});row[field]=i.value.trim();i.value=row[field];i.dataset.original=i.value;markEditorDirty();status.textContent='Saved';}catch(e){status.textContent=e.message;}finally{b.disabled=false;}
   }));
  };render();select.addEventListener('change',()=>{if(!allowEditorNavigation()){select.value=prev;return;}prev=select.value;render();});
 }catch(e){panel.textContent=e.message;}
}
async function loadGenericPublishingStatus(){
 const code=selectedVocabularyCode,container=document.getElementById('publishingStatus');
 container.textContent='Loading publishing status...';
 try{const d=await api(`/api/publishing/${code}/status`);if(code!==selectedVocabularyCode)return;container.innerHTML=`<p><strong>${d.unpublished_changes}</strong> recorded text or mapping changes awaiting publication.</p><p>${d.running?'Publication in progress.':d.latest_success?'Last published: '+escapeHtml(formatDate(d.latest_success.finished_at)):'No workbench publication recorded yet.'}</p>`;
  document.getElementById('publishSiteTypesButton').disabled=!!d.running;
  document.getElementById('publicationHistory').innerHTML=d.latest_runs.map(r=>`<p>${escapeHtml(formatDate(r.started_at))}: ${escapeHtml(r.status)}${r.error?' · '+escapeHtml(r.error):''}</p>`).join('');
 }catch(e){container.textContent=e.message;}
}
async function publishGenericVocabulary(){
 const code=selectedVocabularyCode,title=vocabularyTitle(),button=document.getElementById('publishSiteTypesButton'),status=document.getElementById('publishActionStatus');
 if(!confirm('Publish the current '+title+' changes?'))return;button.disabled=true;status.textContent='Publishing...';
 try{const r=await api(`/api/publishing/${code}/publish`,{method:'POST',body:'{}'});
  let data=r;while(data.publication.status==='running'){
   await new Promise(resolve=>setTimeout(resolve,1800));data=await api(`/api/publishing/${code}/runs/${r.publication.publication_id}`);
  }
  if(code!==selectedVocabularyCode)return;
  status.textContent=data.publication.status==='success'?'Published successfully.':data.publication.error||'Publication failed. Check the server log.';
 }catch(e){if(code===selectedVocabularyCode)status.textContent=e.message;}finally{if(code===selectedVocabularyCode){button.disabled=false;await loadGenericPublishingStatus();}}
}
window.addEventListener('beforeunload',e=>{if(editorDirty){e.preventDefault();e.returnValue='';}});
