const {registry,LANGS,quote}=require('./vocabularyEditor');
const present=value=>typeof value==='string'&&value.trim().length>0;
function summarize(rows){
 const vocabularies=[{code:'site-types',title:'Site Types'},...registry.map(v=>({code:v.slug,title:v.title}))].map(v=>({...v,concepts:0,missing_labels:0,missing_definitions:0,affected_concepts:0,languages:Object.fromEntries(LANGS.map(l=>[l,{missing_labels:0,missing_definitions:0}]))}));
 const byCode=new Map(vocabularies.map(v=>[v.code,v])),coverage={};
 for(const row of rows){const v=byCode.get(row.vocabulary_code);if(!v)continue;
  v.concepts++;const missing_labels=LANGS.filter(l=>!present(row.labels?.[l])),missing_definitions=LANGS.filter(l=>!(row.definitions?.[l]||[]).some(present));
  v.missing_labels+=missing_labels.length;v.missing_definitions+=missing_definitions.length;v.affected_concepts+=Number(!!(missing_labels.length||missing_definitions.length));
  for(const l of missing_labels)v.languages[l].missing_labels++;for(const l of missing_definitions)v.languages[l].missing_definitions++;
  (coverage[v.code]??=[]).push({concept_id:row.concept_id,missing_labels,missing_definitions});
 }
 return {vocabularies,coverage,languages:LANGS};
}
function query(){
 const generic=registry.map(v=>`SELECT '${v.slug}'::text AS vocabulary_code,v.id::text AS concept_id,jsonb_build_object(${LANGS.map(l=>`'${l}',v.display_${l}`).join(',')}) AS labels,
 COALESCE((SELECT jsonb_object_agg(t.lang,t.texts) FROM vocab_workbench.editor_texts t WHERE t.vocabulary_code='${v.slug}' AND t.concept_id=v.id::text AND t.field='definition'),'{}'::jsonb) AS definitions FROM ui.${quote(v.view)} v`);
 const site=`SELECT 'site-types'::text AS vocabulary_code,c.concept_id::text,
 COALESCE((SELECT jsonb_object_agg(l.lang,l.label) FROM (SELECT lang,min(NULLIF(btrim(label),'')) AS label FROM public.labels_curated WHERE concept_id=c.concept_id AND lower(COALESCE(status,''))='preferred' AND lang IN ('en','ru','zh','kk','ky','tg','tk','uz') GROUP BY lang) l),'{}'::jsonb) AS labels,
 COALESCE((SELECT jsonb_object_agg(n.lang,n.notes) FROM (SELECT lang,jsonb_agg(note) AS notes FROM public.concept_notes_curated WHERE concept_id=c.concept_id AND lower(COALESCE(note_type,''))='definition' AND lang IN ('en','ru','zh','kk','ky','tg','tk','uz') GROUP BY lang) n),'{}'::jsonb) AS definitions
 FROM public.concepts_curated c WHERE c.sort_order IS NOT NULL AND COALESCE(c.lifecycle_status,'active')<>'retired' AND lower(COALESCE(NULLIF(btrim(c.is_active),''),'true')) NOT IN ('false','0','no','inactive')`;
 return [site,...generic].join('\nUNION ALL\n');
}
module.exports={query,summarize};
