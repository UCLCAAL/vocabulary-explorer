const express=require('express'),pool=require('../db'),E=require('../services/vocabularyEditor');
const {createGettyClient,aatUri}=require('../services/getty');
const {decisionStatus}=require('./alignments');
const getty=createGettyClient(pool),router=express.Router();
const relations=['exactMatch','closeMatch','broadMatch','narrowMatch','relatedMatch'],statuses=['proposed','accepted','rejected','deprecated'];
const text=(value,max=4000)=>{if(value!=null&&typeof value!=='string')throw E.fail('Enter plain text.');const s=E.clean(value);if(s.length>max)throw E.fail('Text is too long.');return s;};
const aid=s=>{if(!/^[1-9]\d{0,17}$/.test(s))throw E.fail('Invalid alignment ID.');return s;};
function error(res,e){if(!e.status)console.error('Vocabulary alignment failed:',e.code||e.name);return res.status(e.status||(e.code==='23505'?409:503)).json({ok:false,error:e.status?e.message:e.code==='23505'?'A live mapping already exists for this pair.':'Could not load or save the alignment.'});}
const get=fn=>async(req,res)=>{try{return res.json({ok:true,...await fn(req)});}catch(e){return error(res,e);}};
async function transaction(req,res,fn){let db;try{db=await pool.connect();await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");await db.query("SELECT pg_advisory_xact_lock(hashtext('caal-generic-vocabulary-edit'))");const result=await fn(db);await db.query('COMMIT');res.json({ok:true,...result});}catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});error(res,e);}finally{db?.release();}}
async function event(db,row,old,action,req){await db.query('INSERT INTO vocab_workbench.editor_alignment_events(alignment_id,action,old_data,new_data,changed_by_username) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',[row.alignment_id,action,old?JSON.stringify(old):null,JSON.stringify(row),req.session.workbenchSession.user.username]);}
router.get('/aat/search',get(async req=>getty.search(text(req.query.q,120))));
router.get('/aat/:aatId',get(async req=>({candidate:await getty.detail(aatUri(req.params.aatId))})));
router.get('/coverage',get(async req=>{
 const all=await E.list(pool,req.editorVocabulary),as=(await pool.query('SELECT source_concept_id,status FROM vocab_workbench.editor_alignments WHERE vocabulary_code=$1',[req.editorVocabulary.slug])).rows;
 const rows=all.map(c=>{const own=as.filter(a=>a.source_concept_id===c.concept_id);return {concept_id:c.concept_id,parent_id:c.parent_id,label:c.en_label,accepted:own.filter(a=>a.status==='accepted').length,proposed:own.filter(a=>a.status==='proposed').length,state:own.some(a=>a.status==='accepted')?'mapped':own.some(a=>a.status==='proposed')?'awaiting':'unmapped'};});
 return {rows,counts:{total:rows.length,...Object.fromEntries(['mapped','awaiting','unmapped'].map(s=>[s,rows.filter(r=>r.state===s).length]))}};
}));
router.get('/source/:conceptId',get(async req=>({rows:(await pool.query(`SELECT * FROM vocab_workbench.editor_alignments WHERE vocabulary_code=$1 AND source_concept_id=$2 AND status IN ('accepted','proposed') ORDER BY CASE relation WHEN 'exactMatch' THEN 0 WHEN 'closeMatch' THEN 1 ELSE 2 END,alignment_id`,[req.editorVocabulary.slug,req.params.conceptId])).rows})));
router.get('/',get(async req=>{
 const source=text(req.query.source_concept_id)||null,status=text(req.query.status)||null;if(status&&!statuses.includes(status))throw E.fail('Unknown alignment status.');
 const all=await E.list(pool,req.editorVocabulary),data=(await pool.query(`SELECT * FROM vocab_workbench.editor_alignments WHERE vocabulary_code=$1 AND ($2::text IS NULL OR source_concept_id=$2) ORDER BY CASE relation WHEN 'exactMatch' THEN 0 WHEN 'closeMatch' THEN 1 WHEN 'broadMatch' THEN 2 WHEN 'narrowMatch' THEN 3 ELSE 4 END,updated_at DESC,alignment_id DESC`,[req.editorVocabulary.slug,source])).rows;
 const counts=Object.fromEntries(statuses.map(s=>[s,data.filter(r=>r.status===s).length]));
 const filtered=data.filter(r=>!status||r.status===status),offset=Math.max(0,parseInt(req.query.offset)||0),limit=30;
 return {rows:filtered.slice(offset,offset+limit).map(r=>({...r,source_label:all.find(c=>c.concept_id===r.source_concept_id)?.en_label||r.source_concept_id,source_lifecycle_status:'active'})),total:filtered.length,offset,limit,counts};
}));
router.get('/:alignmentId/history',get(async req=>({events:(await pool.query('SELECT e.* FROM vocab_workbench.editor_alignment_events e JOIN vocab_workbench.editor_alignments a USING(alignment_id) WHERE e.alignment_id=$1 AND a.vocabulary_code=$2 ORDER BY event_id DESC',[aid(req.params.alignmentId),req.editorVocabulary.slug])).rows})));
router.post('/',async(req,res)=>{
 let uri,candidate,relation,evidence,search;
 try{uri=aatUri(req.body.target_uri);relation=text(req.body.relation);if(!relations.includes(relation))throw E.fail('Choose a relationship.');evidence=text(req.body.evidence);search=text(req.body.search_text,120);candidate=await getty.detail(uri);if(candidate.deprecated)throw E.fail('Choose a current AAT concept.',409);}catch(e){return error(res,e);}
 return transaction(req,res,async db=>{
  const id=text(req.body.source_concept_id),snapshot=await E.detail(db,req.editorVocabulary,id),user=req.session.workbenchSession.user;
  const result=await db.query(`INSERT INTO vocab_workbench.editor_alignments(vocabulary_code,source_concept_id,target_uri,target_label,target_label_language,relation,evidence,candidate_snapshot,source_snapshot,search_text,proposed_by_user_id,proposed_by_username) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`,[req.editorVocabulary.slug,id,uri,candidate.label,candidate.language||'',relation,evidence,JSON.stringify(candidate),JSON.stringify(snapshot),search,String(user.user_id),user.username]);
  await event(db,result.rows[0],null,'propose',req);return {alignment:result.rows[0]};
 });
});
router.post('/:alignmentId/decision',async(req,res)=>transaction(req,res,async db=>{
 const result=await db.query('SELECT * FROM vocab_workbench.editor_alignments WHERE alignment_id=$1 AND vocabulary_code=$2 FOR UPDATE',[aid(req.params.alignmentId),req.editorVocabulary.slug]),old=result.rows[0];
 if(!old)throw E.fail('Alignment not found.',404);if(old.version!==Number(req.body.version))throw E.fail('This alignment changed. Refresh before deciding.',409);
 const status=decisionStatus(old.status,text(req.body.action));if(status==='accepted')await E.detail(db,req.editorVocabulary,old.source_concept_id);
 const user=req.session.workbenchSession.user,row=(await db.query('UPDATE vocab_workbench.editor_alignments SET status=$2,version=version+1,review_note=$3,reviewed_by_user_id=$4,reviewed_by_username=$5,reviewed_at=now(),updated_at=now() WHERE alignment_id=$1 RETURNING *',[old.alignment_id,status,text(req.body.note),String(user.user_id),user.username])).rows[0];
 await event(db,row,old,req.body.action,req);return {alignment:row};
}));
module.exports=router;
