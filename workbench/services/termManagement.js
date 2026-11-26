'use strict';
const E=require('./vocabularyEditor');
const {quote:q,fail,clean}=E;
const table=v=>`${q(v.schema)}.${q(v.table)}`;
const cp=v=>v.slug==='cultural-periods';
function managed(v){if(!v.management)throw fail('Term management is not enabled for this controlled list.',403);}
async function lock(db,v){
 managed(v);
 await db.query("SELECT pg_advisory_xact_lock(hashtext('caal-generic-vocabulary-edit'))");
 await db.query(`LOCK TABLE ${cp(v)?'public.concepts_curated_cultural_periods':table(v)} IN SHARE ROW EXCLUSIVE MODE`);
}
async function all(db,v){return E.list(db,v);}
async function get(db,v,id,expected){
 const row=(await all(db,v)).find(c=>c.concept_id===id);
 if(!row)throw fail('Concept not found.',404);
 if(!expected||expected!==row.version)throw fail('This term changed. Refresh before managing it.',409);
 return row;
}
async function audit(db,v,id,action,before,after,user){
 await db.query(`INSERT INTO vocab_workbench.editor_revisions(vocabulary_code,concept_id,field,lang,old_values,new_values,changed_by_user_id,changed_by_username)
  VALUES($1,$2,$3,'und',$4::jsonb,$5::jsonb,$6,$7)`,[v.slug,id,action,JSON.stringify(before?[JSON.stringify(before)]:[]),JSON.stringify(after?[JSON.stringify(after)]:[]),user.user_id==null?null:String(user.user_id),String(user.username)]);
}
function labels(body){
 const input=body.labels;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(l=>!E.LANGS.includes(l)))throw fail('Enter labels using the supported languages.');
 const result={};
 for(const [lang,value] of Object.entries(input)){
  if(typeof value!=='string'||value.length>500||/[\r\n]/.test(value))throw fail('Labels must be single-line text within 500 characters.');
  if(clean(value))result[lang]=clean(value);
 }
 if(!result.en)throw fail('An English preferred label is required.');
 return result;
}
function chronology(body){
 const number=value=>{
  if(value===null||value==='')return null;
  if(!/^-?[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Math.abs(Number(value))>2147483647)throw fail('Use signed whole years: negative for BCE, positive for CE, and no year zero. Leave unknown years blank.');
  return Number(value);
 };
 if(!Object.hasOwn(body,'date_from')||!Object.hasOwn(body,'date_to'))throw fail('Supply both date fields, using null for an unknown year.');
 const from=number(body.date_from),to=number(body.date_to);
 if(from!==null&&to!==null&&from>to)throw fail('The start date must not be after the end date.');
 if(typeof body.date_range!=='string'||body.date_range.length>500||/[\r\n]/.test(body.date_range))throw fail('Enter a date-range label within 500 characters.');
 return {date_from:from,date_to:to,date_range:clean(body.date_range)||null};
}
async function writeDates(db,id,dates){
 await db.query(`INSERT INTO vocab_workbench.managed_dates(concept_id,date_from,date_to,date_range) VALUES($1,$2,$3,$4)
  ON CONFLICT(concept_id) DO UPDATE SET date_from=EXCLUDED.date_from,date_to=EXCLUDED.date_to,date_range=EXCLUDED.date_range`,[id,dates.date_from,dates.date_to,dates.date_range]);
}
async function create(db,v,body,user){
 await lock(db,v);const ls=labels(body),existing=await all(db,v);
 if(existing.some(r=>(!cp(v)||(r.parent_id||null)===(clean(body.parent_id)||null))&&r.labels.some(l=>l.lang==='en'&&l.status==='preferred'&&l.label.toLowerCase()===ls.en.toLowerCase())))throw fail('An English preferred label with this spelling already exists.',409);
 if(!cp(v)&&existing.some(r=>String(r.canonical_value??'').toLowerCase()===ls.en.toLowerCase()))throw fail('This spelling is already a stored record key, possibly under a renamed term.',409);
 let id,parent=null,level=1;
 const reserved=(await db.query('SELECT concept_id FROM vocab_workbench.managed_terms WHERE vocabulary_code=$1',[v.slug])).rows.map(r=>r.concept_id);
 if(cp(v)){
  parent=clean(body.parent_id)||null;
  if(parent){const p=existing.find(c=>c.concept_id===parent&&c.lifecycle_status!=='retired');if(!p)throw fail('Choose an active parent.');level=Number(String(p.level).replace(/^L/,''))+1;}
  if(level<1||level>4)throw fail('Cultural Periods support levels 1 to 4.');
  const sourceIds=(await db.query('SELECT concept_id FROM public.concepts_curated_cultural_periods')).rows.map(c=>c.concept_id);
  const ids=[...sourceIds,...reserved];
  const n=Math.max(0,...ids.map(s=>Number(new RegExp('^CP-'+level+'-(\\d+)$').exec(s)?.[1]||0)))+1;
  id=`CP-${level}-${String(n).padStart(4,'0')}`;
  await db.query(`INSERT INTO public.concepts_curated_cultural_periods(concept_id,en_label,id_key,is_active,level,parent_id)
   VALUES($1,$2,$1,'true',$3,$4)`,[id,ls.en,String(level),parent]);
  for(const [lang,label] of Object.entries(ls))await db.query(`INSERT INTO public.labels_curated_cultural_periods(concept_id,lang,label,status,en_label) VALUES($1,$2,$3,'preferred',$4)`,[id,lang,label,ls.en]);
  await writeDates(db,id,chronology(body));
 }else{
  const scoped=v.reference?' WHERE vocabulary_code=$1':'';
  const sourceIds=(await db.query(`SELECT ${q(v.key)}::text AS id FROM ${table(v)}${scoped}`,v.reference?[v.slug]:[])).rows.map(r=>r.id);
  if(sourceIds.some(s=>!/^\d+$/.test(s)))throw fail('This list needs a reviewed ID allocator before terms can be created.',409);
  const n=Math.max(0,...sourceIds.map(Number),...reserved.filter(s=>/^\d+$/.test(s)).map(Number))+1;
  if(!Number.isSafeInteger(n)||n>2147483647)throw fail('No numeric ID is available.',409);
  id=v.reference?String(n).padStart(3,'0'):String(n);
  const columns=[v.key,...Object.keys(ls).map(lang=>v.columns[lang])],values=[v.reference?id:n,...Object.values(ls)];
  if(v.slug==='external-xref-types'){columns.push('level','sort_order','canonical_value','path_key','source_file','source_rows');values.push(1,n,ls.en,'workbench:'+id,'workbench',id);}
  if(v.reference){columns.push('vocabulary_code','canonical_value','sort_order');values.push(v.slug,ls.en,n);}
  await db.query(`INSERT INTO ${table(v)} (${columns.map(q).join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
  // Keep any existing serial allocator ahead of the explicit, reserved ID.
  if(!v.reference){
   const seq=(await db.query('SELECT pg_get_serial_sequence($1,$2) AS seq',[table(v),v.key])).rows[0]?.seq;
   if(seq)await db.query('SELECT setval($1::regclass, GREATEST($2::bigint, pg_sequence_last_value($1::regclass)), true)',[seq,n]);
  }
 }
 await db.query(`INSERT INTO vocab_workbench.canonical_keys(vocabulary_code,concept_id,value) VALUES($1,$2,$3)`,[v.slug,id,cp(v)?id:ls.en]);
 const result=(await all(db,v)).find(c=>c.concept_id===id);
 if(!result||result.display_en!==ls.en)throw fail('The lookup did not expose the new term. Nothing was saved.',409);
 await db.query(`INSERT INTO vocab_workbench.managed_terms(vocabulary_code,concept_id,canonical_value,lifecycle_status) VALUES($1,$2,$3,'active')`,[v.slug,id,String(result.canonical_value??id)]);
 await audit(db,v,id,'create',null,result,user);
 return {concept:(await E.detail(db,v,id)).concept};
}
async function dates(db,v,id,body,user){
 await lock(db,v);if(!cp(v))throw fail('Only Cultural Periods have chronology controls.');
 const before=await get(db,v,id,body.expected),next=chronology(body);
 if(before.lifecycle_status==='retired')throw fail('This term is retired.',409);
 await writeDates(db,id,next);
 await audit(db,v,id,'chronology',{date_from:before.date_from,date_to:before.date_to,date_range:before.date_range},next,user);
 return E.detail(db,v,id);
}
async function parent(db,v,id,body,user){
 await lock(db,v);if(!cp(v))throw fail('This descriptive list has no hierarchy.');
 const before=await get(db,v,id,body.expected),rows=await all(db,v),parent=clean(body.parent_id)||null;
 if(before.lifecycle_status==='retired')throw fail('This term is retired.',409);
 const subtree=new Set([id]);let old=0;
 while(old!==subtree.size){old=subtree.size;for(const r of rows)if(subtree.has(r.parent_id))subtree.add(r.concept_id);}
 if(subtree.has(parent))throw fail('A term cannot be placed beneath itself or a descendant.');
 const p=parent?rows.find(c=>c.concept_id===parent&&c.lifecycle_status!=='retired'):null;
 if(parent&&!p)throw fail('Choose an active parent.');
 const level=p?Number(String(p.level).replace(/^L/,''))+1:1;
 // Existing CP identifiers encode level. Do not silently make them misleading.
 if(level!==Number(String(before.level).replace(/^L/,''))){
  if(subtree.size>1||(await db.query('SELECT 1 FROM public.concepts_curated_cultural_periods WHERE parent_id=$1 LIMIT 1',[id])).rows.length)throw fail('A move between levels requires a leaf term. Move its children first.',409);
  await checkUsage(db,v,before);
  const content=Object.fromEntries(before.labels.filter(l=>l.status==='preferred').map(l=>[l.lang,l.label]));
  // The old term is excluded from the duplicate check because the new parent differs.
  const made=await create(db,v,{labels:content,parent_id:parent,date_from:before.date_from??null,date_to:before.date_to??null,date_range:before.date_range||''},user);
  await db.query(`INSERT INTO vocab_workbench.editor_texts(vocabulary_code,concept_id,field,lang,texts)
   SELECT vocabulary_code,$3,field,lang,texts FROM vocab_workbench.editor_texts WHERE vocabulary_code=$1 AND concept_id=$2`,[v.slug,id,made.concept.concept_id]);
  await db.query(`UPDATE vocab_workbench.managed_terms SET lifecycle_status='retired',replacement_concept_id=$3 WHERE vocabulary_code=$1 AND concept_id=$2`,[v.slug,id,made.concept.concept_id]);
  await audit(db,v,id,'successor',before,{replacement_concept_id:made.concept.concept_id},user);
  return E.detail(db,v,made.concept.concept_id);
 }
 await db.query('UPDATE public.concepts_curated_cultural_periods SET parent_id=$2 WHERE concept_id=$1',[id,parent]);
 await audit(db,v,id,'parent',{parent_id:before.parent_id},{parent_id:parent},user);
 return E.detail(db,v,id);
}
// Deletion deliberately fails closed. Text values, aliases and historical labels
// are inspected in every CAAL record table in public/kg/kz, in addition to FKs.
async function checkUsage(db,v,row){
 const history=(await db.query(`SELECT old_values,new_values FROM vocab_workbench.editor_revisions WHERE vocabulary_code=$1 AND concept_id=$2 AND field IN ('preferred','alternative')`,[v.slug,row.concept_id])).rows;
 const aliases=[row.canonical_value,...row.labels.map(l=>l.label),...history.flatMap(h=>[...h.old_values,...h.new_values])].filter(x=>typeof x==='string'&&clean(x));
 if(cp(v))aliases.push(row.concept_id);
 const terms=[...new Set(aliases.map(s=>s.toLowerCase()))];
 const reason=(await db.query('SELECT vocab_workbench.managed_term_usage($1,$2,$3::text[]) AS reason',[v.slug,row.concept_id,terms])).rows[0].reason;
 if(reason)throw fail(reason,409);
 const ref=(await db.query(`SELECT 1 FROM vocab_workbench.editor_alignments WHERE vocabulary_code=$1 AND source_concept_id=$2 LIMIT 1`,[v.slug,row.concept_id])).rows;
 if(ref.length)throw fail('This term has alignment references. Retire it instead.',409);
 const replacement=(await db.query(`SELECT 1 FROM vocab_workbench.managed_terms WHERE vocabulary_code=$1 AND replacement_concept_id=$2 LIMIT 1`,[v.slug,row.concept_id])).rows;
 if(replacement.length)throw fail('Another retired term refers to this replacement.',409);

}
async function remove(db,v,id,body,user){
 await lock(db,v);const row=await get(db,v,id,body.expected);
 if(body.confirm_id!==id)throw fail('Enter the exact concept ID.');
 const rows=await all(db,v);
 if(rows.some(c=>c.parent_id===id)||(cp(v)&&(await db.query('SELECT 1 FROM public.concepts_curated_cultural_periods WHERE parent_id=$1 LIMIT 1',[id])).rows.length))throw fail('This term has narrower concepts. Move them first.',409);
 await checkUsage(db,v,row);
 if(cp(v)){
  await db.query('DELETE FROM public.labels_curated_cultural_periods WHERE concept_id=$1',[id]);
  await db.query('DELETE FROM public.concepts_curated_cultural_periods WHERE concept_id=$1',[id]);
 }else await db.query(`DELETE FROM ${table(v)} WHERE ${q(v.key)}::text=$1${v.reference?' AND vocabulary_code=$2':''}`,v.reference?[id,v.slug]:[id]);
 await db.query(`INSERT INTO vocab_workbench.managed_terms(vocabulary_code,concept_id,canonical_value,lifecycle_status) VALUES($1,$2,$3,'deleted')
  ON CONFLICT(vocabulary_code,concept_id) DO UPDATE SET lifecycle_status='deleted',replacement_concept_id=NULL`,[v.slug,id,String(row.canonical_value??id)]);
 // Text and canonical history stay reserved, but deleted concepts are not exported.
 await audit(db,v,id,'delete',row,null,user);return {};
}
async function retire(db,v,id,body,user){
 await lock(db,v);const row=await get(db,v,id,body.expected),rows=await all(db,v);
 if(body.confirm_id!==id)throw fail('Enter the exact concept ID.');
 if(row.lifecycle_status==='retired')throw fail('This term is already retired.',409);
 if(rows.some(c=>c.concept_id!==id&&c.lifecycle_status!=='retired'&&c.canonical_value===row.canonical_value))throw fail('Another term shares this stored record key. Review the ambiguity before retirement.',409);
 if(rows.some(c=>c.parent_id===id&&c.lifecycle_status!=='retired'))throw fail('Move or retire narrower concepts first.',409);
 const replacement=clean(body.replacement_concept_id)||null;
 if(replacement&&(!rows.some(c=>c.concept_id===replacement&&c.lifecycle_status!=='retired')||replacement===id))throw fail('Choose another active replacement.');
 await db.query(`INSERT INTO vocab_workbench.managed_terms(vocabulary_code,concept_id,canonical_value,lifecycle_status,replacement_concept_id)
  VALUES($1,$2,$3,'retired',$4) ON CONFLICT(vocabulary_code,concept_id) DO UPDATE SET lifecycle_status='retired',replacement_concept_id=EXCLUDED.replacement_concept_id`,[v.slug,id,String(row.canonical_value??id),replacement]);
 await audit(db,v,id,'retire',row,{lifecycle_status:'retired',replacement_concept_id:replacement},user);
 return E.detail(db,v,id);
}
module.exports={create,dates,parent,remove,retire,chronology,labels};
