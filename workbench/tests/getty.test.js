const {test}=require('node:test'),assert=require('node:assert/strict');const {createGettyClient,aatUri,searchQuery,parseResults}=require('../services/getty');const {database,fixtureTransport}=require('./fixtures');
test('AAT URI validation and bounded literal searches',()=>{
 assert.equal(aatUri('https://vocab.getty.edu/page/aat/300007148'),'http://vocab.getty.edu/aat/300007148');
 for(const value of ['http://evil.example/aat/300007148','300007148> } UNION { ?s ?p ?o','../300007148'])assert.throws(()=>aatUri(value));assert.throws(()=>searchQuery('a'));assert.throws(()=>searchQuery('x'.repeat(121)));
 const query=searchQuery('castle" } UNION { ?a ?b ?c');assert(!query.includes('castle" }'));assert(query.includes('luc:term'));assert(query.includes('LIMIT 21'));assert(searchQuery('墓地').includes('墓地'));assert(searchQuery('考古学').includes('考古学'));
});
test('SPARQL JSON/XML parsing rejects unrelated markup and DTDs',async()=>{
 assert.deepEqual(await parseResults('{"results":{"bindings":[]}}'),[]);const response=await fixtureTransport()('detail');assert.equal((await parseResults(response.text))[0].value['xml:lang'],'en');
 await assert.rejects(parseResults('<html>blocked</html>'));await assert.rejects(parseResults('<!DOCTYPE sparql [<!ENTITY x "bad">]><sparql xmlns="http://www.w3.org/2005/sparql-results#"><results/></sparql>'));await assert.rejects(parseResults('{"results":{"bindings":[{"label":{}}]}}'));
});
test('Shared gate, cache, coalescing and upstream backoff',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());const calls=[],client=createGettyClient(pool,{transport:fixtureTransport(calls)});
 await Promise.all([client.search('caravanserai'),client.search('caravanserai')]);assert.equal(calls.length,1);await client.search('caravanserai');assert.equal(calls.length,1);
 const first=createGettyClient(pool,{transport:fixtureTransport(calls)}),second=createGettyClient(pool,{transport:fixtureTransport(calls)});const start=Date.now();await Promise.all([first.search('castle'),second.search('mausoleum')]);assert.equal(calls.length,3);assert(Date.now()-start>=400);
 const blocked=createGettyClient(pool,{transport:async()=>({status:429,headers:{'retry-after':'120'},text:''})});await assert.rejects(blocked.search('fortification'),/limiting requests/);
 const other=createGettyClient(pool,{transport:async()=>{throw new Error('Must not send while cooling down')}});await assert.rejects(other.search('settlement'),/pause requests/);
 assert((await db.query(`SELECT blocked_until>clock_timestamp()+interval '100 seconds' AS blocked FROM vocab_workbench.getty_request_gate`)).rows[0].blocked);
 await db.query(`UPDATE vocab_workbench.getty_request_gate SET blocked_until='-infinity',next_request_at='-infinity'`);
 const forbidden=createGettyClient(pool,{transport:async()=>({status:403,text:'Forbidden'})});await assert.rejects(forbidden.search('building'),/403/);
 const retry=createGettyClient(pool,{transport:async()=>({status:200,text:'<html>WAF response</html>'})});await assert.rejects(retry.search('temple'),/SPARQL XML/);
});
