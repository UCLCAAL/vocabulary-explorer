let allLanguageReviewCoverage=new Map(),overviewRequest=0;
function initialiseReviewOverview(){
 const block=document.createElement('section');block.className='card review-overview';block.style.marginBottom='1rem';block.innerHTML='<details id="reviewOverviewDetails" open><summary><strong>All thesauri: translation coverage</strong></summary><p class="muted">Missing preferred labels and definitions across all eight languages. Counts are concept-language entries.</p><button type="button" class="secondary" id="reviewOverviewRefresh">Refresh overview</button><p id="reviewOverviewStatus" role="status"></p><div id="reviewOverviewTable" class="review-table-wrap"></div></details>';
 document.getElementById('reviewView').prepend(block);
 document.getElementById('reviewOverviewRefresh').addEventListener('click',refreshReviewOverview);
}
async function refreshReviewOverview(){
 const request=++overviewRequest,code=selectedVocabularyCode,user=String(session?.user?.user_id||'');
 const status=document.getElementById('reviewOverviewStatus');status.textContent='Checking all languages...';allLanguageReviewCoverage.clear();renderHierarchyTree();
 try{
  const data=await api('/api/review-overview');if(request!==overviewRequest||user!==String(session?.user?.user_id||''))return;
  if(code===selectedVocabularyCode)allLanguageReviewCoverage=new Map((data.coverage[code]||[]).map(r=>[r.concept_id,r]));
  const missing=data.vocabularies.filter(v=>v.missing_labels||v.missing_definitions);
  document.getElementById('reviewOverviewTable').innerHTML='<table class="data-table"><thead><tr><th>Thesaurus</th><th>Missing labels</th><th>Missing definitions</th></tr></thead><tbody>'+missing.map(v=>`<tr><td><details><summary>${escapeHtml(v.title)}</summary><table class="data-table"><thead><tr><th>Language</th><th>Labels</th><th>Definitions</th></tr></thead><tbody>${LANGUAGES.map(([lang,name])=>{const c=v.languages[lang];return `<tr><td>${escapeHtml(name)}</td><td>${overviewCount(v.code,lang,'label',c.missing_labels)}</td><td>${overviewCount(v.code,lang,'definition',c.missing_definitions)}</td></tr>`;}).join('')}</tbody></table></details></td><td>${v.missing_labels}</td><td>${v.missing_definitions}</td></tr>`).join('')+'</tbody></table>';
  status.textContent=`${missing.length} of ${data.vocabularies.length} thesauri have missing labels or definitions.`;
  document.querySelectorAll('[data-overview-code]').forEach(b=>b.addEventListener('click',async()=>{
   if(!allowReviewNavigation()||!allowAlignmentNavigation())return;
   document.getElementById('reviewLanguage').value=b.dataset.overviewLanguage;document.getElementById('reviewMissing').value=b.dataset.overviewFilter;document.getElementById('reviewScope').value='all';reviewOffset=0;
   if(selectedVocabularyCode!==b.dataset.overviewCode){document.getElementById('workspaceVocabulary').value=b.dataset.overviewCode;await changeVocabulary(b.dataset.overviewCode);}else await loadReview();
  }));renderHierarchyTree();
 }catch(e){if(request!==overviewRequest||user!==String(session?.user?.user_id||''))return;allLanguageReviewCoverage.clear();document.getElementById('reviewOverviewTable').innerHTML='';status.textContent=e.message;renderHierarchyTree();}
}
function overviewCount(code,lang,filter,count){return count?`<button type="button" class="tree-text-action" data-overview-code="${escapeHtml(code)}" data-overview-language="${lang}" data-overview-filter="${filter}">${count}</button>`:'0';}
function allLanguageReviewBadge(id){
 const row=allLanguageReviewCoverage.get(id);if(!row)return '<span class="tree-coverage">Coverage unavailable</span>';
 const parts=[];if(row.missing_labels.length)parts.push('Labels: '+row.missing_labels.join(', '));if(row.missing_definitions.length)parts.push('Definitions: '+row.missing_definitions.join(', '));
 return `<span class="tree-coverage${parts.length?'':' tree-coverage-mapped'}" title="Missing translations across all eight languages">${escapeHtml(parts.join(' · ')||'Complete in all languages')}</span>`;
}
