const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../routes/publishing.js'),'utf8');
function harness(failure){
 const handlers={},requests=[],writes=[],exports=[],updates=[];
 const pool={connect:async()=>({release(){},query:async(sql,params)=>{
   if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
   if(sql.includes('INSERT INTO vocab_workbench.publication_runs'))return {rows:[{publication_run_id:1}]};
   if(sql.includes('UPDATE vocab_workbench.publication_runs'))updates.push(sql.includes("'succeeded'")?'succeeded':'failed');
   return {rows:[]};
 }})};
 let referencePut=0;
 const context={require:name=>{
  if(name==='express')return {Router:()=>({use(){},get:(p,h)=>handlers['GET '+p]=h,post:(p,h)=>handlers['POST '+p]=h})};
  if(name==='../db')return pool;if(name==='../middleware/requireLevel9')return ()=>{};
  if(name==='fs/promises')return {access:async()=>{},mkdir:async()=>{},writeFile:async(p,b)=>writes.push([p,b]),readFile:async p=>p.includes('summary')?JSON.stringify({triples:10,accepted_alignments:4}):Buffer.from(p.includes('reference')?'new reference':'new main')};
  if(name==='child_process')return {execFile:()=>{}};
  if(name==='util')return {promisify:()=>async(...args)=>{exports.push(args);return {stdout:'fixture',stderr:''}}};
  return require(name);
 },module:{exports:{}},__dirname:path.join(__dirname,'../routes'),process:{platform:'linux',env:{PUBLISH_RESTART_SERVICES:'false'}},Buffer,URL,Date,console:{error(){}},fetch:async(url,options)=>{
   const graph=new URL(url).searchParams.get('graph');const reference=graph.endsWith('aat-reference');const item={graph,method:options.method,body:options.body?.toString()};requests.push(item);
   if(options.method==='GET'){
     if(failure==='backup'&&reference)return {ok:false,status:403,text:async()=> 'fixture refused'};
     const text=reference?'old reference':'old main';return {ok:true,status:200,arrayBuffer:async()=>Buffer.from(text)};
   }
   if(reference&&options.method==='PUT'&&++referencePut===1&&failure==='reference')return {ok:false,status:500,text:async()=> 'fixture write failure'};
   return {ok:true,status:200};
 }};
 vm.runInNewContext(code,context);
 return {handlers,requests,writes,exports,updates};
}
async function publish(h){const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await h.handlers['POST /site-types/publish']({body:{confirm:'PUBLISH_SITE_TYPES'},session:{workbenchSession:{user:{user_id:'1',username:'fixture'}}}},res);return res;}
test('Publishing replaces both generated graphs without re-posting static mappings',async()=>{
 const h=harness(),res=await publish(h);assert.equal(res.code,200);assert.deepEqual(h.requests.map(r=>r.method),['GET','GET','PUT','PUT']);assert.equal(h.exports[0][1].includes('--alignment-reference-output'),true);assert.deepEqual(h.updates,['succeeded']);assert.equal(h.writes.length,2);
});
test('A failed AAT graph write restores both graph backups',async()=>{
 const h=harness('reference'),res=await publish(h);assert.equal(res.code,500);assert.deepEqual(h.requests.slice(-2).map(r=>r.body),['old reference','old main']);assert.deepEqual(h.updates,['failed']);
});
test('A failed reference backup never changes either published graph',async()=>{
 const h=harness('backup'),res=await publish(h);assert.equal(res.code,500);assert.equal(h.requests.filter(r=>r.method==='PUT').length,0);assert.deepEqual(h.updates,['failed']);
});
