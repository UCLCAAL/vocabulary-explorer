const router=require('express').Router(),pool=require('../db');
const {query,summarize}=require('../services/reviewOverview');
router.use(require('../middleware/requireLevel9'));
router.get('/',async(req,res)=>{
 let client;res.set('Cache-Control','no-store');
 try{client=await pool.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='20s'");const result=await client.query(query());await client.query('COMMIT');res.json({ok:true,...summarize(result.rows),checked_at:new Date().toISOString()});}
 catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Review overview failed:',e.code||e.name);res.status(503).json({ok:false,error:'Translation overview could not be loaded. Refresh to try again.'});}
 finally{client?.release();}
});
module.exports=router;
