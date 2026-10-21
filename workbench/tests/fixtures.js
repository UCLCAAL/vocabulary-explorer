const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createGettyClient}=require('../services/getty');
async function database({identity=true}={}){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA vocab_workbench;
 CREATE TABLE public.concepts_curated(concept_id text ${identity?'PRIMARY KEY':''},level text,parent_id text,en_label text,id_key text,is_active text DEFAULT 'true',sort_order int,lifecycle_status text DEFAULT 'active',replaced_by_concept_id text,retired_at timestamptz);
 INSERT INTO public.concepts_curated(concept_id,level,en_label,sort_order) VALUES ('MT-2-0014','L2','Caravanserai',1),('MT-2-0076','L2','Mausoleum',2),('MT-3-0038','L3','Mazar',3),('MT-2-0999','L2','Fixture source',4);
 CREATE TABLE public.labels_curated(label_id text PRIMARY KEY,concept_id text,lang text,label text,status text,source text,norm_key text,disambiguation text);
 INSERT INTO public.labels_curated SELECT row_number() OVER()::text,concept_id,'en',en_label,'preferred','fixture',lower(en_label),NULL FROM public.concepts_curated;
 CREATE TABLE public.concept_notes_curated(note_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,concept_id text,lang text,note_type text,note text,source text,source_record text,source_column text,review_status text,import_run_id int,created_at timestamptz,updated_at timestamptz);
 INSERT INTO public.concept_notes_curated(concept_id,lang,note_type,note) VALUES ('MT-2-0999','en','definition','Fixture CAAL definition.');
 CREATE TABLE public.concept_bibliographic_links(link_id int,reference_id int,relation_type text,note text,sort_order int,vocabulary_code text,concept_id text);
 CREATE TABLE public.vocabulary_bibliographic_resources(reference_id int,citation text,caal_permalink text,doi text,zotero_uri text,external_uri text,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE public.vocabulary_schemes(vocabulary_code text,scheme_uri text,concept_uri_base text,is_active boolean);
 INSERT INTO public.vocabulary_schemes VALUES ('site-types','https://vocab.uclcaal.org/scheme/site-types','https://vocab.uclcaal.org/concept/',true);
 CREATE TABLE vocab_workbench.concept_revisions(revision_id int,concept_id text,vocabulary_code text,entity_type text,entity_id text,action text,lang text,old_data jsonb,new_data jsonb,changed_by_username text,changed_at timestamptz);`);
 const migration=fs.readFileSync(path.join(__dirname,'../../sql/005_aat_alignments.sql'),'utf8');await db.exec(migration);
 const pool={query:(sql,params)=>db.query(sql,params),connect:async()=>({query:(sql,params)=>db.query(sql,params),release(){}})};
 return {db,pool,migration};
}
function fixtureTransport(calls=[]){return async query=>{
 calls.push(query);
 if(query.includes('SELECT DISTINCT ?uri'))return {status:200,headers:{},text:JSON.stringify({results:{bindings:[{uri:{type:'uri',value:'http://vocab.getty.edu/aat/300007148'},label:{type:'literal',value:'caravanserais','xml:lang':'en'},parents:{type:'literal',value:'Fixture parent path'}}]}})};
 return {status:200,headers:{},text:`<?xml version="1.0"?><sparql xmlns="http://www.w3.org/2005/sparql-results#"><head></head><results><result><binding name="kind"><literal>preferred</literal></binding><binding name="value"><literal xml:lang="en">caravanserais</literal></binding></result><result><binding name="kind"><literal>definition</literal></binding><binding name="value"><literal xml:lang="en">Fixture AAT definition.</literal></binding></result></results></sparql>`};
};}
async function appFixture(){
 const {db,pool,migration}=await database();const express=require('express');
 require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:pool};
 const {makeRouter}=require('../routes/alignments');const calls=[],getty=createGettyClient(pool,{transport:fixtureTransport(calls)});
 const app=express();app.use(express.json());app.use((req,res,next)=>{const level=req.headers['x-test-level'];req.session=level==='none'?{}:{workbenchSession:{user:{user_id:'1',username:'Fixture admin',access_level:Number(level||9)},profile:{preferred_language:'en'}}};next();});
 app.get('/api/auth/session',(req,res)=>res.json({session:req.session.workbenchSession}));
 app.use('/api/vocabularies/site-types/alignments',makeRouter({pool,getty}));app.use('/api/vocabularies',require('../routes/vocabularies'));app.use(express.static(path.join(__dirname,'../public')));
 const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))});const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(url,body,headers={})=>{const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 return {db,pool,migration,getty,calls,app,base,request,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close()}};
}
module.exports={database,fixtureTransport,appFixture};
