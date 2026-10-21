const express = require("express");
const defaultPool = require("../db");
const requireLevel9 = require("../middleware/requireLevel9");
const { createGettyClient, aatUri } = require("../services/getty");
const RELATIONS = new Set(["exactMatch","closeMatch","broadMatch","narrowMatch","relatedMatch"]);
const STATUSES = new Set(["proposed","accepted","rejected","deprecated"]);
const clean = value => String(value ?? "").trim();
const failure = (message,status=400) => Object.assign(new Error(message),{status});
const active = c => c && c.lifecycle_status !== "retired" && !["false","0","no","inactive"].includes(clean(c.is_active).toLowerCase());
function sourceId(value) {
  const id=clean(value);
  if (!/^MT-[1-4]-[0-9]+$/.test(id)) throw failure("Choose a Site Types concept.");
  return id;
}
function numericId(value) {
  const id=clean(value);
  if (!/^[1-9][0-9]{0,17}$/.test(id)) throw failure("Invalid alignment ID.");
  return id;
}
function limitedText(value,max=4000) {
  if (value!=null && typeof value!=="string") throw failure("Enter plain text for the note.");
  const text=clean(value);
  if (text.length>max) throw failure(`Keep notes within ${max} characters.`);
  return text;
}
function decisionStatus(current,action) {
  if (current==="proposed" && action==="accept") return "accepted";
  if (current==="proposed" && action==="reject") return "rejected";
  if (current==="accepted" && action==="deprecate") return "deprecated";
  throw failure("This decision is no longer available. Refresh the alignments.",409);
}

function makeRouter({pool=defaultPool,getty=createGettyClient(pool)}={}) {
  const router=express.Router();
  router.use(requireLevel9);
  router.use((req,res,next)=>{res.set("Cache-Control","no-store");next();});
  function sendError(res,e) {
    if (!e.status && e.code!=="23505") console.error("Alignment request failed:",e);
    const migration=["42P01","42703"].includes(e.code);
    const busy=["57014","55P03","40P01"].includes(e.code);
    const status=e.status || (e.code==="23505"?409:(migration || busy?503:500));
    return res.status(status).json({ok:false,error:e.status?e.message:
      e.code==="23505"?"A proposed or accepted alignment already exists for this pair of terms.":
      migration?"The Alignment database migration is not installed. Run sql/005_aat_alignments.sql.":
      busy?"The database was busy. No decision was saved; please try again.":"Could not load or save the alignment. Check the server log."});
  }
  async function transaction(req,res,work) {
    let client;
    try {
      client=await pool.connect();
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const result=await work(client);
      await client.query("COMMIT");
      return res.json({ok:true,...result});
    } catch(e) { if(client){try{await client.query("ROLLBACK");}catch{}} return sendError(res,e); }
    finally {client?.release();}
  }
  async function event(client,row,before,action,req) {
    const user=req.session.workbenchSession.user;
    await client.query(`INSERT INTO vocab_workbench.site_type_alignment_events
      (alignment_id,action,old_data,new_data,changed_by_user_id,changed_by_username)
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [row.alignment_id,action,before?JSON.stringify(before):null,JSON.stringify(row),user.user_id==null?null:String(user.user_id),String(user.username)]);
  }
  router.get("/aat/search",async(req,res)=>{
    try {return res.json({ok:true,...await getty.search(limitedText(req.query.q,120))});}
    catch(e){return sendError(res,e);}
  });
  router.get("/aat/:aatId",async(req,res)=>{
    try {return res.json({ok:true,candidate:await getty.detail(aatUri(req.params.aatId))});}
    catch(e){return sendError(res,e);}
  });
  router.get("/",async(req,res)=>{
    try {
      const id=clean(req.query.source_concept_id)?sourceId(req.query.source_concept_id):null;
      const status=clean(req.query.status) || null;
      if(status && !STATUSES.has(status)) throw failure("Unknown alignment status.");
      const offset=Math.max(0,Math.min(1000000,Number.parseInt(req.query.offset,10)||0));
      const limit=30;
      const result=await pool.query(`SELECT a.*, COALESCE(en.label,c.en_label,c.concept_id) AS source_label,
          c.lifecycle_status AS source_lifecycle_status,
          count(*) OVER()::int AS total_count
        FROM vocab_workbench.site_type_alignments a JOIN public.concepts_curated c ON c.concept_id=a.source_concept_id
        LEFT JOIN LATERAL (SELECT label FROM public.labels_curated WHERE concept_id=c.concept_id
          AND lang='en' AND lower(status)='preferred' ORDER BY label_id LIMIT 1) en ON true
        WHERE ($1::text IS NULL OR a.source_concept_id=$1) AND ($2::text IS NULL OR a.status=$2)
        ORDER BY CASE a.status WHEN 'proposed' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,a.updated_at DESC,a.alignment_id DESC
        LIMIT $3 OFFSET $4`,[id,status,limit,offset]);
      const counts=await pool.query(`SELECT status,count(*)::int AS count FROM vocab_workbench.site_type_alignments
        WHERE ($1::text IS NULL OR source_concept_id=$1) GROUP BY status`,[id]);
      let total=result.rows[0]?.total_count || 0;
      // A stale page can become empty after the last item changes status.
      if(offset && !result.rows.length) {
        const count=await pool.query(`SELECT count(*)::int AS count FROM vocab_workbench.site_type_alignments
          WHERE ($1::text IS NULL OR source_concept_id=$1) AND ($2::text IS NULL OR status=$2)`,[id,status]);
        total=count.rows[0].count;
      }
      return res.json({ok:true,rows:result.rows,total,offset,limit,
        counts:Object.fromEntries([...STATUSES].map(status=>[status,counts.rows.find(r=>r.status===status)?.count||0]))});
    }catch(e){return sendError(res,e);}
  });
  router.get("/:alignmentId/history",async(req,res)=>{
    try {
      const id=numericId(req.params.alignmentId);
      const result=await pool.query(`SELECT event_id,action,old_data,new_data,changed_by_username,changed_at
        FROM vocab_workbench.site_type_alignment_events WHERE alignment_id=$1 ORDER BY event_id DESC`,[id]);
      return res.json({ok:true,events:result.rows});
    }catch(e){return sendError(res,e);}
  });
  router.post("/",async(req,res)=>{
    let id,uri,relation,evidence,searchText,candidate;
    try {
      id=sourceId(req.body?.source_concept_id);
      uri=aatUri(req.body?.target_uri);
      relation=clean(req.body?.relation);
      if(!RELATIONS.has(relation)) throw failure("Choose the relationship between the CAAL term and the AAT term.");
      evidence=limitedText(req.body?.evidence);
      searchText=limitedText(req.body?.search_text,120);
      // Validate a real AAT candidate server-side. Never trust client-supplied labels.
      candidate=await getty.detail(uri);
      if(candidate.deprecated) throw failure("This AAT concept is deprecated. Choose a current AAT concept.",409);
    }catch(e){return sendError(res,e);}
    return transaction(req,res,async client=>{
      const source=await client.query("SELECT * FROM public.concepts_curated WHERE concept_id=$1 FOR SHARE",[id]);
      if(!active(source.rows[0])) throw failure("Choose an active CAAL concept. Retired concepts cannot receive new proposals.",409);
      const labels=await client.query("SELECT lang,label,status FROM public.labels_curated WHERE concept_id=$1 ORDER BY lang,label_id",[id]);
      const notes=await client.query("SELECT lang,note_type,note FROM public.concept_notes_curated WHERE concept_id=$1 ORDER BY note_id",[id]);
      const user=req.session.workbenchSession.user;
      const result=await client.query(`INSERT INTO vocab_workbench.site_type_alignments
        (source_concept_id,target_uri,target_label,target_label_language,relation,evidence,
         candidate_snapshot,source_snapshot,search_text,proposed_by_user_id,proposed_by_username)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11) RETURNING *`,
        [id,uri,candidate.label,candidate.language||"",relation,evidence,JSON.stringify(candidate),
          JSON.stringify({concept:source.rows[0],labels:labels.rows,notes:notes.rows}),searchText,user.user_id==null?null:String(user.user_id),String(user.username)]);
      await event(client,result.rows[0],null,"propose",req);
      return {alignment:result.rows[0]};
    });
  });
  router.post("/:alignmentId/decision",async(req,res)=>{
    let id,action,version,note;
    try {
      id=numericId(req.params.alignmentId);
      action=clean(req.body?.action);
      if(!["accept","reject","deprecate"].includes(action)) throw failure("Unknown alignment decision.");
      version=Number(req.body?.version);
      if(!Number.isSafeInteger(version)||version<1) throw failure("Refresh this alignment before saving a decision.",409);
      note=limitedText(req.body?.note);
    }catch(e){return sendError(res,e);}
    return transaction(req,res,async client=>{
      const existing=await client.query("SELECT * FROM vocab_workbench.site_type_alignments WHERE alignment_id=$1 FOR UPDATE",[id]);
      const old=existing.rows[0];
      if(!old) throw failure("Alignment not found.",404);
      if(old.version!==version) throw failure("Another administrator changed this alignment. Refresh before deciding.",409);
      const status=decisionStatus(old.status,action);
      if(action==="accept") {
        const source=await client.query("SELECT * FROM public.concepts_curated WHERE concept_id=$1 FOR SHARE",[old.source_concept_id]);
        if(!active(source.rows[0])) throw failure("The CAAL concept has retired. Reject this proposal or choose its replacement.",409);
      }
      const user=req.session.workbenchSession.user;
      const result=await client.query(`UPDATE vocab_workbench.site_type_alignments
        SET status=$2,reviewed_by_user_id=$3,reviewed_by_username=$4,reviewed_at=now(),review_note=$5,
            version=version+1,updated_at=now() WHERE alignment_id=$1 RETURNING *`,
        [id,status,user.user_id==null?null:String(user.user_id),String(user.username),note]);
      await event(client,result.rows[0],old,action,req);
      return {alignment:result.rows[0]};
    });
  });
  return router;
}
module.exports=makeRouter();
module.exports.makeRouter=makeRouter;
module.exports.decisionStatus=decisionStatus;
