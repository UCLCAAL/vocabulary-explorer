const {test}=require('node:test'),assert=require('node:assert/strict');const {appFixture,database}=require('./fixtures');const PREFIX='/api/vocabularies/site-types/alignments';
test('Migration, editorial workflow, audit, stale decisions and retirement on embedded PostgreSQL',async t=>{
 const f=await appFixture();t.after(f.close);
 let r=await f.request(PREFIX);assert.equal(r.status,200);assert.equal(r.data.total,4);assert.equal(r.data.counts.accepted,4);
 assert.equal((await f.request(PREFIX,null,{'x-test-level':'none'})).status,401);assert.equal((await f.request(PREFIX,null,{'x-test-level':'3'})).status,403);
 r=await f.request(PREFIX+'/aat/search?q=caravanserai');assert.equal(r.status,200);assert.equal(r.data.results[0].label,'caravanserais');
 r=await f.request(PREFIX+'/aat/300007148');assert.equal(r.status,200);assert.equal(r.data.candidate.definitions[0].text,'Fixture AAT definition.');
 const body={source_concept_id:'MT-2-0999',target_uri:'https://vocab.getty.edu/aat/300007148',relation:'broadMatch',evidence:'Fixture evidence',target_label:'Untrusted replacement'};
 assert.equal((await f.request(PREFIX,{...body,relation:'sameAs'})).status,400);assert.equal((await f.request(PREFIX,{...body,target_uri:'http://example.com/300007148'})).status,400);
 r=await f.request(PREFIX,body);assert.equal(r.status,200);let a=r.data.alignment;assert.equal(a.status,'proposed');assert.equal(a.target_label,'caravanserais');assert.equal(a.source_snapshot.notes[0].note,'Fixture CAAL definition.');
 assert.equal((await f.request(PREFIX,body)).status,409);
 r=await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'accept',version:a.version,note:'Fixture review'});assert.equal(r.status,200);a=r.data.alignment;assert.equal(a.status,'accepted');assert.equal(a.version,2);
 assert.equal((await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'reject',version:1})).status,409);assert.equal((await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'reject',version:2})).status,409);
 r=await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'deprecate',version:2,note:'Fixture withdrawal'});assert.equal(r.status,200);assert.equal(r.data.alignment.status,'deprecated');
 r=await f.request(`${PREFIX}/${a.alignment_id}/history`);assert.deepEqual(r.data.events.map(e=>e.action),['deprecate','accept','propose']);assert.equal(r.data.events[1].old_data.status,'proposed');assert.equal(r.data.events[1].new_data.status,'accepted');
 r=await f.request(PREFIX,body);assert.equal(r.status,200);a=r.data.alignment;r=await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'reject',version:1});assert.equal(r.status,200);
 await assert.rejects(f.db.query(`INSERT INTO vocab_workbench.site_type_alignments(source_concept_id,target_uri,target_label,relation,status,proposed_by_username) VALUES ('MT-2-0999','http://vocab.getty.edu/aat/300000001','fixture','exactMatch','accepted','fixture')`));
 const legacy=(await f.db.query(`SELECT * FROM vocab_workbench.site_type_alignments WHERE source_concept_id='MT-2-0014'`)).rows[0];await f.request(`${PREFIX}/${legacy.alignment_id}/decision`,{action:'deprecate',version:1});await f.db.exec(f.migration);
 assert.equal((await f.db.query(`SELECT count(*)::int AS count FROM vocab_workbench.site_type_alignments WHERE source_concept_id='MT-2-0014' AND status='accepted'`)).rows[0].count,0);
 await f.db.query(`UPDATE public.concepts_curated SET lifecycle_status='retired',is_active='false' WHERE concept_id='MT-2-0999'`);assert.equal((await f.request(PREFIX,body)).status,409);
 await f.db.query(`UPDATE public.concepts_curated SET lifecycle_status='active',is_active='true' WHERE concept_id='MT-2-0999'`);r=await f.request(PREFIX,body);a=r.data.alignment;
 await f.db.query(`UPDATE public.concepts_curated SET lifecycle_status='retired' WHERE concept_id='MT-2-0999'`);assert.equal((await f.request(`${PREFIX}/${a.alignment_id}/decision`,{action:'accept',version:1})).status,409);
 assert(f.calls.length<=2,'Search and candidate results must be reused from cache');
});

test('Migration adds an identity key for a legacy imported concepts table without one',async t=>{
 const {db}=await database({identity:false});t.after(()=>db.close());
 const result=await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='concepts_curated' AND indexname='concepts_curated_alignment_identity'");
 assert.equal(result.rows.length,1);
});
