const express=require('express'),pool=require('../db'),E=require('../services/vocabularyEditor');
const {spawn}=require('child_process'),fs=require('fs'),path=require('path');
const router=express.Router();router.use(require('../middleware/requireLevel9'));
router.use('/:vocabulary',(req,res,next)=>{if(req.params.vocabulary==='site-types')return next('router');try{req.editorVocabulary=E.vocabulary(req.params.vocabulary);next();}catch(e){res.status(404).json({ok:false,error:e.message});}});
const error=(res,e)=>{console.error('Lookup publication failed:',e.code||e.name);return res.status(e.code==='23505'?409:503).json({ok:false,error:e.code==='23505'?'Another vocabulary publication is already running.':'Could not start or load publication. Check migration 006 and the server log.'});};
router.get('/:vocabulary/status',async(req,res)=>{try{
 const slug=req.editorVocabulary.slug,runs=(await pool.query('SELECT * FROM vocab_workbench.editor_publications WHERE vocabulary_code=$1 ORDER BY publication_id DESC LIMIT 10',[slug])).rows;
 const latest=(await pool.query("SELECT * FROM vocab_workbench.editor_publications WHERE vocabulary_code=$1 AND status='success' ORDER BY publication_id DESC LIMIT 1",[slug])).rows[0];
 const since=latest?.started_at||'1970-01-01',n=(await pool.query(`SELECT count(*)::int AS n FROM (SELECT changed_at FROM vocab_workbench.editor_revisions WHERE vocabulary_code=$1 UNION ALL SELECT e.changed_at FROM vocab_workbench.editor_alignment_events e JOIN vocab_workbench.editor_alignments a USING(alignment_id) WHERE a.vocabulary_code=$1 AND e.action IN ('accept','deprecate')) changes WHERE changed_at>$2`,[slug,since])).rows[0].n;
 res.json({ok:true,latest_runs:runs,latest_success:latest||null,unpublished_changes:n,running:runs.some(r=>r.status==='running')});
 }catch(e){error(res,e);}});
router.get('/:vocabulary/runs/:runId',async(req,res)=>{try{
 if(!/^\d+$/.test(req.params.runId))return res.status(400).json({ok:false,error:'Invalid publication ID.'});
 const row=(await pool.query('SELECT * FROM vocab_workbench.editor_publications WHERE publication_id=$1 AND vocabulary_code=$2',[req.params.runId,req.editorVocabulary.slug])).rows[0];
 if(!row)return res.status(404).json({ok:false,error:'Publication not found.'});res.json({ok:true,publication:row});
 }catch(e){error(res,e);}});
router.post('/:vocabulary/publish',async(req,res)=>{
 let publication,fd;try{
  publication=(await pool.query(`INSERT INTO vocab_workbench.editor_publications(vocabulary_code,status,started_by_username,through_revision) SELECT $1,'running',$2,COALESCE(max(revision_id),0) FROM vocab_workbench.editor_revisions WHERE vocabulary_code=$1 RETURNING *`,[req.editorVocabulary.slug,req.session.workbenchSession.user.username])).rows[0];
  const repo=path.resolve(__dirname,'../..'),folder=path.join(repo,'data/generated/workbench-publications');fs.mkdirSync(folder,{recursive:true});
  const log=path.join(folder,'publication-'+publication.publication_id+'.log');fd=fs.openSync(log,'a',0o600);
  const child=spawn(process.env.PYTHON_BIN||'python3',[path.join(repo,'scripts/publish_workbench_vocabulary.py'),'--repo',repo,'--slug',req.editorVocabulary.slug,'--run-id',String(publication.publication_id)],{cwd:repo,env:process.env,detached:true,stdio:['ignore',fd,fd]});
  child.on('error',()=>pool.query("UPDATE vocab_workbench.editor_publications SET status='failed',finished_at=now(),error='The publication worker could not start. Check PYTHON_BIN.' WHERE publication_id=$1 AND status='running'",[publication.publication_id]).catch(()=>{}));
  child.unref();fs.closeSync(fd);fd=null;
  res.status(202).json({ok:true,publication});
 }catch(e){if(fd!=null)fs.closeSync(fd);if(publication)await pool.query("UPDATE vocab_workbench.editor_publications SET status='failed',finished_at=now(),error='The publication worker could not start.' WHERE publication_id=$1",[publication.publication_id]).catch(()=>{});error(res,e);}
});
module.exports=router;
