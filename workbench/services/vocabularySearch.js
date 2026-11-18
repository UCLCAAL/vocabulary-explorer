const E=require('./vocabularyEditor');

async function search(db,query){
 const q=E.clean(query).toLowerCase();
 if(!q)return {concepts:[],total:0};
 if(q.length>200)throw E.fail('Search text must be within 200 characters.');
 // Search the same registered views and saved text overrides as the editor.
 // A failed source fails the request rather than silently hiding a vocabulary.
 const sources=E.registry.map((v,i)=>`SELECT ${i} AS source, to_jsonb(v) AS data FROM ui.${E.quote(v.view)} v`);
 const generic=sources.length?(await db.query(sources.join(' UNION ALL '))).rows:[];
 const stored=(await db.query('SELECT * FROM vocab_workbench.editor_texts WHERE concept_id<>\'\'')).rows;
 const titles=new Map((await db.query("SELECT vocabulary_code,label FROM public.vocabulary_scheme_labels WHERE lang='en'")).rows.map(r=>[r.vocabulary_code,r.label]));
 const site=(await db.query(`SELECT c.concept_id,c.en_label,
   COALESCE(jsonb_agg(jsonb_build_object('label',l.label,'lang',l.lang,'status',l.status))
     FILTER (WHERE l.label IS NOT NULL),'[]'::jsonb) AS labels
   FROM public.concepts_curated c LEFT JOIN public.labels_curated l ON l.concept_id=c.concept_id
   WHERE COALESCE(c.lifecycle_status,'active')<>'retired'
   GROUP BY c.concept_id,c.en_label`)).rows;
 const byVocabulary=new Map();
 for(const t of stored){
  if(!byVocabulary.has(t.vocabulary_code))byVocabulary.set(t.vocabulary_code,[]);
  byVocabulary.get(t.vocabulary_code).push(t);
 }
 const matches=[];
 function add(slug,title,id,labels,fallback){
  if(fallback&&!labels.some(l=>l.lang==='en'&&l.status==='preferred'))labels=[...labels,{label:fallback,lang:'en',status:'preferred'}];
  const rank=value=>value===q?0:value.startsWith(q)?1:2;
  const matching=labels.filter(l=>String(l.label).toLowerCase().includes(q))
   .sort((a,b)=>rank(a.label.toLowerCase())-rank(b.label.toLowerCase())||(a.status==='preferred'?0:1)-(b.status==='preferred'?0:1));
  const idMatch=id.toLowerCase().includes(q);
  if(!idMatch&&!matching.length)return;
  const match=matching[0];
  matches.push({vocabulary_code:slug,vocabulary_title:titles.get(slug)||title,concept_id:id,
   en_label:labels.find(l=>l.lang==='en'&&l.status==='preferred')?.label||fallback||id,
   match_label:match?.label||id,match_lang:match?.lang||'',match_status:match?.status||'concept_id',
   rank:Math.min(idMatch?rank(id.toLowerCase()):3,match?rank(match.label.toLowerCase()):3)});
 }
 for(const r of site)add('site-types','Site Types',String(r.concept_id),r.labels,r.en_label);
 for(const {source,data:row} of generic){
  const v=E.registry[source],ts=byVocabulary.get(v.slug)||[];
  const labels=E.LANGS.flatMap(lang=>['preferred','alternative'].flatMap(field=>
   E.values(row,ts,field,lang).map(label=>({label,lang,status:field==='preferred'?'preferred':'alt'}))));
  add(v.slug,v.title,String(row.id),labels);
 }
 matches.sort((a,b)=>a.rank-b.rank||a.en_label.localeCompare(b.en_label)||a.vocabulary_title.localeCompare(b.vocabulary_title)||a.concept_id.localeCompare(b.concept_id));
 return {concepts:matches.slice(0,100).map(({rank,...r})=>r),total:matches.length};
}
module.exports={search};
