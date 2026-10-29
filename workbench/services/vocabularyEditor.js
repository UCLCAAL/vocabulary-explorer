const crypto=require('crypto');
const registry=require('./vocabularyRegistry.json');
const LANGS=['en','ru','zh','kk','ky','tg','tk','uz'];
const ROOT='https://vocab.uclcaal.org/';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=v=>String(v??'').trim();
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function vocabulary(slug){const v=registry.find(v=>v.slug===slug);if(!v)throw fail('Vocabulary not found.',404);return v;}
async function rows(db,v){
 const result=await db.query(`SELECT to_jsonb(v) AS data FROM ui.${quote(v.view)} v`);
 return result.rows.map(r=>r.data).sort((a,b)=>Number(a.sort_order??0)-Number(b.sort_order??0)||String(a.id).localeCompare(String(b.id)));
}
async function texts(db,v){return (await db.query('SELECT * FROM vocab_workbench.editor_texts WHERE vocabulary_code=$1',[v.slug])).rows;}
function values(row,stored,field,lang){
 const override=stored.find(r=>r.concept_id===String(row.id)&&r.field===field&&r.lang===lang);
 if(override)return override.texts;
 if(field==='preferred')return clean(row['display_'+lang])?[clean(row['display_'+lang])]:[];
 if(field==='alternative')return (row['alt_labels_'+lang]||[]).filter(x=>clean(x)&&x!==row['display_'+lang]);
 if(field==='scopeNote'&&lang==='en'&&clean(row.description))return [clean(row.description)];
 return [];
}
async function list(db,v){
 const [rs,ts]=await Promise.all([rows(db,v),texts(db,v)]);
 return rs.map(row=>({...row,concept_id:String(row.id),parent_id:row.parent_id==null?null:String(row.parent_id),level:String(row.level||'L1'),
  en_label:clean(row.display_en),label_en:clean(row.display_en),label_ru:clean(row.display_ru),label_zh:clean(row.display_zh),is_active:'true',lifecycle_status:'active',
  labels:LANGS.flatMap(lang=>values(row,ts,'preferred',lang).map(label=>({label_id:'preferred:'+lang,lang,label,status:'preferred'})).concat(values(row,ts,'alternative',lang).map((label,i)=>({label_id:'alternative:'+lang+':'+i,lang,label,status:'alt'})))),
  definitions:LANGS.flatMap(lang=>values(row,ts,'definition',lang).map(note=>({lang,note,note_type:'definition'}))),
  scope_notes:LANGS.flatMap(lang=>values(row,ts,'scopeNote',lang).map(note=>({lang,note,note_type:'scopeNote'}))),
  version:hash([row,ts.filter(t=>t.concept_id===String(row.id)).sort((a,b)=>(a.field+a.lang).localeCompare(b.field+b.lang))])}));
}
async function detail(db,v,id){
 const all=await list(db,v),row=all.find(r=>r.concept_id===id);if(!row)throw fail('Concept not found.',404);
 const ancestors=[],seen=new Set([id]);let parent=row.parent_id;
 while(parent&&!seen.has(parent)){seen.add(parent);const p=all.find(r=>r.concept_id===parent);if(!p)break;ancestors.unshift(p);parent=p.parent_id;}
 const history=(await db.query(`SELECT revision_id,field AS entity_type,lang,old_values AS old_data,new_values AS new_data,changed_by_username,changed_at,'update' AS action FROM vocab_workbench.editor_revisions WHERE vocabulary_code=$1 AND concept_id=$2 ORDER BY revision_id DESC LIMIT 100`,[v.slug,id])).rows;
 return {concept:row,labels:row.labels,definitions:row.definitions,scope_notes:row.scope_notes,bibliography:[],history,version:row.version,
  hierarchy:{ancestors,parent:all.find(r=>r.concept_id===row.parent_id)||null,children:all.filter(r=>r.parent_id===id),siblings:all.filter(r=>r.parent_id===row.parent_id&&r.concept_id!==id)}};
}
async function descriptions(db,slug){
 if(slug!=='site-types')vocabulary(slug);
 const stored=(await db.query("SELECT * FROM vocab_workbench.editor_texts WHERE vocabulary_code=$1 AND concept_id=''",[slug])).rows;
 let baseline=[];
 if(slug==='site-types')baseline=(await db.query("SELECT lang,note FROM public.vocabulary_scheme_notes WHERE vocabulary_code='site-types' AND lower(note_type)='scopenote' ORDER BY lang")).rows;
 const result=LANGS.map(lang=>{const descriptions=stored.find(r=>r.field==='description'&&r.lang===lang)?.texts??baseline.filter(r=>r.lang===lang).map(r=>r.note),editorial=stored.find(r=>r.field==='editorial'&&r.lang===lang)?.texts??[];return {lang,description:descriptions.join('\n\n'),description_values:descriptions,editorial:editorial.join('\n\n'),editorial_values:editorial};});
 return {rows:result,version:hash(result)};
}
async function save(db,v,id,field,lang,newValues,expected,user){
 if(!LANGS.includes(lang))throw fail('Unsupported language.');
 if(!['preferred','alternative','definition','scopeNote','description','editorial'].includes(field))throw fail('Unsupported field.');
 if(!Array.isArray(newValues)||newValues.some(x=>typeof x!=='string'||x.length>20000))throw fail('Enter plain text within 20,000 characters.');
 newValues=[...new Set(newValues.map(clean).filter(Boolean))];
 if(field!=='alternative'&&newValues.length>1)throw fail('Only one value is allowed.');
 // All generic writes and publications use the same advisory lock, including scheme edits.
 await db.query("SELECT pg_advisory_xact_lock(hashtext('caal-generic-vocabulary-edit'))");
 let oldValues,row;
 if(id===''){
  if(!['description','editorial'].includes(field))throw fail('Choose a concept.');
  const d=await descriptions(db,v.slug);oldValues=d.rows.find(r=>r.lang===lang)[field+'_values'];
 }else{
  const all=await rows(db,v);row=all.find(r=>String(r.id)===id);if(!row)throw fail('Concept not found.',404);
  const stored=await texts(db,v);oldValues=values(row,stored,field,lang);
  if(field==='alternative'&&newValues.some(x=>values(row,stored,'preferred',lang).includes(x)))throw fail('An alternative label must differ from the preferred label.');
  if(field==='preferred'&&newValues.some(x=>values(row,stored,'alternative',lang).includes(x)))throw fail('Remove this text from the alternatives before making it preferred.');
 }
 if(!Array.isArray(expected)||JSON.stringify(expected)!==JSON.stringify(oldValues))throw fail('Another administrator changed this text. Refresh before saving.',409);
 if(JSON.stringify(oldValues)===JSON.stringify(newValues))return;
 if(field==='preferred'){
  if(!newValues.length)throw fail('A preferred label cannot be empty.');
  if(v.mode==='display')await db.query(`INSERT INTO vocab_workbench.display_labels VALUES($1,$2,$3,$4) ON CONFLICT(vocabulary_code,concept_id,lang) DO UPDATE SET label=EXCLUDED.label`,[v.slug,id,lang,newValues[0]]);
  else if(v.mode==='curated'){
   const before=await db.query("SELECT label_id FROM public.labels_curated_cultural_periods WHERE concept_id=$1 AND lang=$2 AND lower(status)='preferred' FOR UPDATE",[id,lang]);
   if(before.rows.length>1)throw fail('Duplicate preferred labels need review.',409);
   if(before.rows.length)await db.query('UPDATE public.labels_curated_cultural_periods SET label=$2 WHERE label_id=$1',[before.rows[0].label_id,newValues[0]]);
   else await db.query("INSERT INTO public.labels_curated_cultural_periods(concept_id,lang,label,status,en_label) VALUES($1,$2,$3,'preferred',$4)",[id,lang,newValues[0],row.display_en]);
  }else{
   let column=v.columns[lang];if(v.mode==='actor'&&String(row.level).replace('L','')==='2')column=column.replace(/_1$/,'_2');
   const result=await db.query(`UPDATE ${quote(v.schema)}.${quote(v.table)} SET ${quote(column)}=$2 WHERE ${quote(v.key)}::text=$1 RETURNING ${quote(v.key)}`,[id,newValues[0]]);
   if(result.rows.length!==1)throw fail('The source row changed. Refresh before saving.',409);
  }
  const check=(await rows(db,v)).find(r=>String(r.id)===id);
  if(!check||clean(check['display_'+lang])!==newValues[0])throw fail('The source lookup did not expose this change. Nothing was saved.',409);
 }else{
  await db.query(`INSERT INTO vocab_workbench.editor_texts(vocabulary_code,concept_id,field,lang,texts) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(vocabulary_code,concept_id,field,lang) DO UPDATE SET texts=EXCLUDED.texts`,[v.slug,id,field,lang,JSON.stringify(newValues)]);
 }
 await db.query(`INSERT INTO vocab_workbench.editor_revisions(vocabulary_code,concept_id,field,lang,old_values,new_values,changed_by_user_id,changed_by_username) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,[v.slug,id,field,lang,JSON.stringify(oldValues),JSON.stringify(newValues),user.user_id==null?null:String(user.user_id),String(user.username)]);
}
module.exports={registry,LANGS,ROOT,quote,fail,clean,hash,vocabulary,rows,texts,values,list,detail,descriptions,save};
