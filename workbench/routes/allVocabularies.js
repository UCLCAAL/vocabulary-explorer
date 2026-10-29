const express=require('express');
const pool=require('../db');
const E=require('../services/vocabularyEditor');
const requireLevel9=require('../middleware/requireLevel9');
const router=express.Router();router.use(requireLevel9);router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
function error(res,e){if(!e.status)console.error('Vocabulary editor request failed:',e.code||e.name);return res.status(e.status||503).json({ok:false,error:e.status?e.message:'Could not load or save this vocabulary. Check migration 006 and database permissions.'});}
const get=work=>async(req,res)=>{try{return res.json({ok:true,...await work(req)});}catch(e){return error(res,e);}};
const transaction=work=>async(req,res)=>{let client;try{client=await pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='20s'");const data=await work(req,client);await client.query('COMMIT');return res.json({ok:true,...data});}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{client?.release();}};
router.get('/catalog',get(async()=>({vocabularies:[{vocabulary_code:'site-types',title:'Site Types'},...E.registry.map(v=>({vocabulary_code:v.slug,title:v.title,category:v.category}))]})));
router.get('/:vocabulary/descriptions',get(req=>E.descriptions(pool,req.params.vocabulary)));
router.put('/:vocabulary/descriptions/:language',transaction(async(req,client)=>{
 const slug=req.params.vocabulary,v=slug==='site-types'?{slug}:E.vocabulary(slug),lang=req.params.language;
 if(!['description','editorial'].includes(req.body.field))throw E.fail('Unsupported vocabulary text.');
 await E.save(client,v,'',req.body.field,lang,req.body.text?[req.body.text]:[],req.body.expected,req.session.workbenchSession.user);return {};
}));
router.use('/:vocabulary/alignments',(req,res,next)=>{
 if(req.params.vocabulary==='site-types')return next();
 try{req.editorVocabulary=E.vocabulary(req.params.vocabulary);return require('./vocabularyAlignments')(req,res,next);}catch(e){return error(res,e);}
});
router.use('/:vocabulary',(req,res,next)=>{
 if(req.params.vocabulary==='site-types')return next('router');
 try{req.editorVocabulary=E.vocabulary(req.params.vocabulary);return next();}catch(e){return error(res,e);}
});
router.get('/:vocabulary/summary',get(async req=>{
 const v=req.editorVocabulary,all=await E.list(pool,v);
 return {vocabularies:[{vocabulary_code:v.slug,title:v.title,scheme_uri:E.ROOT+'scheme/'+v.slug,concept_uri_base:v.uri_base,concept_count:all.length,
 labels_by_language:Object.fromEntries(E.LANGS.map(l=>[l,all.filter(r=>r.labels.some(x=>x.lang===l&&x.status==='preferred')).length])),definitions_by_language:Object.fromEntries(E.LANGS.map(l=>[l,all.filter(r=>r.definitions.some(x=>x.lang===l)).length]))}]};
}));
router.get('/:vocabulary/concepts',get(async req=>{
 let all=await E.list(pool,req.editorVocabulary);if(req.query.status==='retired')all=[];
 const q=E.clean(req.query.q).toLowerCase();if(q)all=all.filter(r=>[r.concept_id,...r.labels.map(l=>l.label)].some(s=>s.toLowerCase().includes(q)));
 return {concepts:all.map(({labels,definitions,scope_notes,...row})=>row)};
}));
router.get('/:vocabulary/review',get(async req=>{
 const language=req.query.language||'en',ref=req.query.reference_language||'en',filter=req.query.missing||'any';
 if(!E.LANGS.includes(language)||!E.LANGS.includes(ref))throw E.fail('Unsupported language.');
 if(!['any','label','definition','both','all','conflicts'].includes(filter))throw E.fail('Unsupported review filter.');
 const all=await E.list(pool,req.editorVocabulary);
 const rs=all.map(r=>{const pref=l=>r.labels.find(x=>x.lang===l&&x.status==='preferred')?.label;return {concept_id:r.concept_id,parent_id:r.parent_id,level:r.level,en_label:r.en_label,preferred_label:pref(language),reference_label:pref(ref),
 label_count:Number(Boolean(pref(language))),definition:r.definitions.find(x=>x.lang===language)?.note,reference_definition:r.definitions.find(x=>x.lang===ref)?.note,
 definition_count:r.definitions.filter(x=>x.lang===language).length,alternative_labels:r.labels.filter(x=>x.lang===language&&x.status==='alt'),
 missing_label:!pref(language),missing_definition:!r.definitions.some(x=>x.lang===language),conflict:r.definitions.filter(x=>x.lang===language).length>1,version:r.version};});
 let scoped=rs;const selected=E.clean(req.query.branch||req.query.concept_id);
 if(req.query.branch&&req.query.concept_id)throw E.fail('Choose a branch or a concept.');
 if(selected){if(!rs.some(r=>r.concept_id===selected))throw E.fail('Concept not found.',404);const ids=new Set([selected]);if(req.query.branch){let n=0;while(n!==ids.size){n=ids.size;for(const r of rs)if(ids.has(r.parent_id))ids.add(r.concept_id);}}scoped=rs.filter(r=>ids.has(r.concept_id));}
 const counts={total:scoped.length,missing_label:0,missing_definition:0,missing_both:0,missing_any:0,conflicts:0};
 for(const r of scoped){counts.missing_label+=+r.missing_label;counts.missing_definition+=+r.missing_definition;counts.missing_both+=+(r.missing_label&&r.missing_definition);counts.missing_any+=+(r.missing_label||r.missing_definition);counts.conflicts+=+r.conflict;}
 const matches=scoped.filter(r=>filter==='all'||filter==='any'&&(r.missing_label||r.missing_definition)||filter==='label'&&r.missing_label||filter==='definition'&&r.missing_definition||filter==='both'&&r.missing_label&&r.missing_definition||filter==='conflicts'&&r.conflict);
 const offset=Math.max(0,parseInt(req.query.offset)||0),limit=Math.min(50,Math.max(1,parseInt(req.query.limit)||25));
 return {counts,matched:matches.length,rows:matches.slice(offset,offset+limit),coverage:rs,offset,limit};
}));
router.get('/:vocabulary/concepts/:conceptId',get(req=>E.detail(pool,req.editorVocabulary,req.params.conceptId)));
router.put('/:vocabulary/concepts/:conceptId/text/:field/:language',transaction(async(req,client)=>{
 await E.save(client,req.editorVocabulary,req.params.conceptId,req.params.field,req.params.language,req.body.values,req.body.expected,req.session.workbenchSession.user);return {};
}));
// Review uses the same per-field save controls as the Site Types review.
router.put('/:vocabulary/concepts/:conceptId/:field/:language',(req,res,next)=>{if(!['labels','definitions','scope-notes'].includes(req.params.field))return next('route');next();},transaction(async(req,client)=>{
 const field={labels:'preferred',definitions:'definition','scope-notes':'scopeNote'}[req.params.field];if(!field)throw E.fail('Unsupported text field.');
 const value=req.body.label??req.body.note??'';
 await E.save(client,req.editorVocabulary,req.params.conceptId,field,req.params.language,value?[value]:[],req.body.expected,req.session.workbenchSession.user);return {};
}));
router.post('/:vocabulary/concepts/:conceptId/alternative-labels',transaction(async(req,client)=>{
 const {lang,label,expected}=req.body;if(!E.LANGS.includes(lang)||typeof label!=='string'||!label.trim())throw E.fail('Enter an alternative label.');
 if((expected||[]).includes(label.trim()))throw E.fail('This alternative label already exists.',409);
 await E.save(client,req.editorVocabulary,req.params.conceptId,'alternative',lang,[...(expected||[]),label],expected,req.session.workbenchSession.user);
 return {label:{label_id:'alternative:'+lang+':'+(expected||[]).length,lang,label:label.trim(),status:'alt'}};
}));
for(const method of ['put','delete'])router[method]('/:vocabulary/concepts/:conceptId/alternative-labels/:labelId',transaction(async(req,client)=>{
 const m=/^alternative:(en|ru|zh|kk|ky|tg|tk|uz):(\d+)$/.exec(req.params.labelId);if(!m)throw E.fail('Refresh these alternative labels.',409);
 const expected=req.body.expected;if(!Array.isArray(expected))throw E.fail('Refresh these alternative labels.',409);
 const changed=[...expected],i=Number(m[2]);if(i>=changed.length)throw E.fail('Refresh these alternative labels.',409);
 if(method==='delete')changed.splice(i,1);else {if(req.body.lang&&req.body.lang!==m[1])throw E.fail('Remove and re-add the alternative to change its language.');changed[i]=req.body.label;}
 await E.save(client,req.editorVocabulary,req.params.conceptId,'alternative',m[1],changed,expected,req.session.workbenchSession.user);return {};
}));
module.exports=router;
