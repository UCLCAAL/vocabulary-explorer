const express = require("express");
const pool = require("../db");
const router = express.Router();
// Mounted behind requireLevel9, before other Site Types routes.
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const clean = value => String(value ?? "").trim();
const SOURCES = ["public", "kz"].flatMap(schema => [
  { schema, table: "CAAL_RS3_Poly", columns: [1,2,3,4].map(n => `Monument type${n}`) },
  { schema, table: "CAAL_RS3_Line", columns: [1,2,3,4].map(n => `Monument type${n}`) },
  { schema, table: "CAAL_RS3_Group", columns: [1,2,3,4].map(n => `Monument type ${n}`) },
  { schema, table: "CAAL_Monuments", columns: [1,2,3,4,5,6].map(n => `Monument Type${n}`) }
]);
const fail = (message, status = 409) => { const error = new Error(message); error.status = status; throw error; };
const active = c => c?.lifecycle_status !== "retired" && !["false","0","no","inactive"].includes(clean(c?.is_active).toLowerCase());
const level = c => Number(/^L([1-4])$/i.exec(clean(c?.level))?.[1] || 0);

async function audit(client, id, action, before, after, req) {
  const user = req.session?.workbenchSession?.user;
  await client.query(`INSERT INTO vocab_workbench.concept_revisions
    (vocabulary_code, concept_id, entity_type, entity_id, action, lang,
     old_data, new_data, changed_by_user_id, changed_by_username)
    VALUES ('site-types', $1, 'concept', $1, $2, 'und', $3::jsonb, $4::jsonb, $5, $6)`,
    [id, action, before ? JSON.stringify(before) : null, JSON.stringify(after),
     user?.user_id == null ? null : String(user.user_id), String(user?.username || "")]);
}

async function snapshot(client, id) {
  const result = await client.query(`SELECT
    (SELECT to_jsonb(c) FROM public.concepts_curated c WHERE concept_id=$1) AS concept,
    COALESCE((SELECT jsonb_agg(l ORDER BY label_id) FROM public.labels_curated l WHERE concept_id=$1), '[]'::jsonb) AS labels,
    COALESCE((SELECT jsonb_agg(n ORDER BY note_id) FROM public.concept_notes_curated n WHERE concept_id=$1), '[]'::jsonb) AS notes,
    COALESCE((SELECT jsonb_agg(b ORDER BY link_id) FROM public.concept_bibliographic_links b
              WHERE vocabulary_code='site-types' AND concept_id=$1), '[]'::jsonb) AS bibliography`, [id]);
  return result.rows[0];
}

async function checkRecords(client, id) {
  // Hold source write locks until commit. A usage check outside the transaction
  // could otherwise allow a record to acquire this ID just before deletion.
  await client.query(`LOCK TABLE ${SOURCES.map(s => `${quote(s.schema)}.${quote(s.table)}`).join(', ')} IN SHARE MODE`);
  const cells = SOURCES.map(s => `SELECT '${s.schema}.${s.table}'::text AS source, t.id::text AS row_id,
    btrim(v.value) AS value FROM ${quote(s.schema)}.${quote(s.table)} t
    CROSS JOIN LATERAL (VALUES ${s.columns.map(c => `(t.${quote(c)}::text)`).join(', ')}) v(value)
    WHERE NULLIF(btrim(v.value), '') IS NOT NULL`).join('\nUNION ALL\n');
  const result = await client.query(`WITH values_to_check AS (
    SELECT label AS value FROM public.labels_curated WHERE concept_id=$1
    UNION SELECT en_label FROM public.concepts_curated WHERE concept_id=$1
    UNION SELECT $1::text
    UNION SELECT concept_uri_base || $1 FROM public.vocabulary_schemes WHERE vocabulary_code='site-types'
    UNION SELECT old_data->>'label' FROM vocab_workbench.concept_revisions WHERE vocabulary_code='site-types' AND concept_id=$1
    UNION SELECT new_data->>'label' FROM vocab_workbench.concept_revisions WHERE vocabulary_code='site-types' AND concept_id=$1
    UNION SELECT old_data->>'en_label' FROM vocab_workbench.concept_revisions WHERE vocabulary_code='site-types' AND concept_id=$1
  ), aliases AS (
    SELECT DISTINCT lower(regexp_replace(btrim(value),'[[:space:]]+',' ','g')) AS key
    FROM values_to_check WHERE NULLIF(btrim(value),'') IS NOT NULL
  ), cells AS (${cells}), matches AS (
    SELECT cells.* FROM cells WHERE
      EXISTS(SELECT 1 FROM aliases WHERE key=lower(regexp_replace(cells.value,'[[:space:]]+',' ','g')))
      OR cells.value ~* ('(^|[^A-Za-z0-9-])' || $1 || '([^A-Za-z0-9-]|$)')
      OR EXISTS (SELECT 1 FROM regexp_split_to_table(cells.value, '[;,|\n\r]+') part
                 JOIN aliases a ON a.key=lower(regexp_replace(btrim(part),'[[:space:]]+',' ','g')))
  ) SELECT count(*)::int AS field_count,
      count(DISTINCT (source,row_id))::int AS record_count FROM matches`, [id]);
  return result.rows[0];
}

// Check declared foreign keys and conventionally named concept references in
// ordinary tables, including alignments whose IDs are stored without an FK.
async function externalReferences(client, id) {
  const columns = await client.query(`WITH candidates AS (
    SELECT n.nspname AS schema_name, t.relname AS table_name, a.attname AS column_name
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_type ty ON ty.oid=a.atttypid
    WHERE t.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND a.attname ~ '(concept_id|conceptId)$' AND (ty.typname IN ('text','varchar','bpchar','json','jsonb') OR ty.typcategory='A')
    UNION
    SELECT n.nspname,t.relname,a.attname FROM pg_constraint fk
    JOIN pg_class t ON t.oid=fk.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(fk.conkey)
    WHERE fk.contype='f' AND fk.confrelid='public.concepts_curated'::regclass
  ) SELECT DISTINCT * FROM candidates
    WHERE NOT (schema_name='public' AND table_name IN ('concepts_curated','labels_curated','concept_notes_curated','concept_bibliographic_links'))
      AND NOT (schema_name='vocab_workbench' AND table_name IN ('concept_revisions','concept_id_registry'))
    ORDER BY schema_name,table_name,column_name`);
  const blockers = [];
  for (const c of columns.rows) {
    const table = `${quote(c.schema_name)}.${quote(c.table_name)}`;
    await client.query(`LOCK TABLE ${table} IN SHARE MODE`);
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${quote(c.column_name)}::text=$1 OR ${quote(c.column_name)}::text ~ ('(^|[^A-Za-z0-9-])' || $1 || '([^A-Za-z0-9-]|$)')`, [id]);
    if (result.rows[0].count) blockers.push(`${c.schema_name}.${c.table_name} (${result.rows[0].count})`);
  }
  // A retained replacement link must never point at a deleted target.
  const replacements = await client.query(`SELECT count(*)::int AS count FROM public.concepts_curated WHERE replaced_by_concept_id=$1`, [id]);
  if (replacements.rows[0].count) blockers.push('retired concepts with this replacement');
  return blockers;
}

async function requireUnused(client, id) {
  const usage = await checkRecords(client, id);
  if (usage.field_count) fail(`${usage.record_count} records (${usage.field_count} fields) match this concept or one of its labels. Resolve those records before retiring or deleting it.`);
  return usage;
}
async function requireLeaf(client, id) {
  const children = await client.query('SELECT concept_id FROM public.concepts_curated WHERE parent_id=$1', [id]);
  if (children.rows.length) fail('Move the narrower concepts to another parent first.');
}
async function allocateId(client, number) {
  const result = await client.query(`SELECT COALESCE(MAX(split_part(concept_id,'-',3)::integer),0)+1 AS next_number
    FROM vocab_workbench.concept_id_registry WHERE concept_id ~ ('^MT-' || $1::text || '-[0-9]+$')`, [number]);
  return `MT-${number}-${String(result.rows[0].next_number).padStart(4,'0')}`;
}

async function cloneContent(client, before, id, newLevel, parentId, parentLabel) {
  const c = before.concept;
  await client.query(`INSERT INTO public.concepts_curated
    (concept_id,level,parent_id,en_label,id_key,is_active,sort_order)
    VALUES ($1,$2,$3,$4,$5,'true',$6)`,
    [id,newLevel,parentId,c.en_label,`${newLevel}|${c.en_label}|${parentLabel || 'NA'}`,c.sort_order]);
  const labelCounter = await client.query(`SELECT COALESCE(MAX(label_id::bigint) FILTER (WHERE label_id ~ '^[0-9]+$'),0)+1 AS next_id FROM public.labels_curated`);
  let nextLabel = BigInt(labelCounter.rows[0].next_id);
  for (const l of before.labels) {
    await client.query(`INSERT INTO public.labels_curated
      (label_id,concept_id,lang,label,status,source,norm_key,level,en_label,disambiguation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [String(nextLabel++),id,l.lang,l.label,l.status,l.source,l.norm_key,newLevel,l.en_label,l.disambiguation]);
  }
  for (const n of before.notes) {
    await client.query(`INSERT INTO public.concept_notes_curated
      (concept_id,lang,note_type,note,source,source_record,source_column,review_status,import_run_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,n.lang,n.note_type,n.note,n.source,n.source_record,n.source_column,n.review_status,n.import_run_id]);
  }
  for (const b of before.bibliography) {
    await client.query(`INSERT INTO public.concept_bibliographic_links
      (vocabulary_code,concept_id,reference_id,relation_type,note,sort_order,created_by_username,updated_by_username)
      VALUES ('site-types',$1,$2,$3,$4,$5,$6,$7)`,
      [id,b.reference_id,b.relation_type,b.note,b.sort_order,b.created_by_username,b.updated_by_username]);
  }
}

async function retire(client, id, replacement) {
  await client.query(`UPDATE public.concepts_curated SET is_active='false',lifecycle_status='retired',
    replaced_by_concept_id=$2,retired_at=now() WHERE concept_id=$1`, [id,replacement]);
}
async function transaction(req, res, work) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL caal.manage_concepts='on'");
    await client.query("SET LOCAL statement_timeout='25s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('LOCK TABLE public.concepts_curated, public.labels_curated, public.concept_notes_curated, public.concept_bibliographic_links IN SHARE ROW EXCLUSIVE MODE');
    const id = clean(req.params.conceptId);
    if (!/^MT-[1-4]-[0-9]+$/.test(id)) fail('Invalid Site Types concept ID.',400);
    const before = await snapshot(client,id);
    if (!before.concept) fail('Concept not found.',404);
    const result = await work(client,id,before);
    await client.query('COMMIT');
    return res.json({ok:true,...result});
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    console.error('Site Types management failed:',error);
    const busy = ['57014','55P03','40P01'].includes(error.code);
    return res.status(error.status || (busy ? 503 : 500)).json({ok:false,
      error: error.status ? error.message : busy ? 'The check could not finish while the database was busy. No change was made. Try again.' : 'Could not change this concept. No change was made. Check the server log.'});
  } finally { client?.release(); }
}

router.put('/concepts/:conceptId/parent', async (req,res) => transaction(req,res,async (client,id,before) => {
  const c=before.concept;
  if (!active(c)) fail('Retired or inactive concepts cannot be moved.');
  if (!Object.hasOwn(req.body || {},'parent_id')) fail('Choose a parent or the top level.',400);
  const parentId=clean(req.body.parent_id) || null;
  if (parentId && !/^MT-[1-4]-[0-9]+$/.test(parentId)) fail('Invalid parent ID.',400);
  if (parentId === id) fail('A concept cannot be its own parent.');
  let parent = null;
  if (parentId) {
    const result=await client.query('SELECT * FROM public.concepts_curated WHERE concept_id=$1',[parentId]);
    parent=result.rows[0];
    if (!parent || !active(parent) || !level(parent) || level(parent)>=4) fail('Choose an active parent at levels L1-L3.');
    const ancestors=await client.query(`WITH RECURSIVE path AS (
      SELECT concept_id,parent_id FROM public.concepts_curated WHERE concept_id=$1
      UNION SELECT c.concept_id,c.parent_id FROM public.concepts_curated c JOIN path p ON c.concept_id=p.parent_id
    ) SELECT concept_id FROM path`,[parentId]);
    if (ancestors.rows.some(row=>row.concept_id===id)) fail('A concept cannot be moved beneath one of its descendants.');
  }
  const newNumber=parent ? level(parent)+1 : 1;
  const newLevel=`L${newNumber}`;
  if (!level(c)) fail('The existing hierarchy level is invalid. Correct it before moving this concept.');
  if ((c.parent_id || null)===parentId && c.level===newLevel) return {concept:c,unchanged:true};
  const english=before.labels.find(l=>l.lang==='en' && clean(l.status).toLowerCase()==='preferred')?.label || c.en_label;
  const duplicate=await client.query(`SELECT c.concept_id FROM public.concepts_curated c
    LEFT JOIN public.labels_curated l ON l.concept_id=c.concept_id AND l.lang='en' AND lower(l.status)='preferred'
    WHERE c.parent_id IS NOT DISTINCT FROM $1 AND c.concept_id<>$2 AND c.lifecycle_status='active'
      AND lower(COALESCE(NULLIF(btrim(c.is_active),''),'true')) NOT IN ('false','0','no','inactive')
      AND lower(btrim(COALESCE(l.label,c.en_label)))=lower(btrim($3)) LIMIT 1`,[parentId,id,english]);
  if (duplicate.rows.length) fail(`That parent already contains this English label (${duplicate.rows[0].concept_id}).`);
  if (c.level===newLevel) {
    await client.query(`UPDATE public.concepts_curated SET parent_id=$2,id_key=$3 WHERE concept_id=$1`,
      [id,parentId,`${newLevel}|${english}|${parent?.en_label || 'NA'}`]);
    const after=await snapshot(client,id);
    await audit(client,id,'update',before,after,req);
    return {concept:after.concept};
  }
  await requireLeaf(client,id);
  await requireUnused(client,id);
  const refs=await externalReferences(client,id);
  if (refs.length) fail(`This concept has other references: ${refs.join('; ')}. Review those before replacing its ID.`);
  const replacement=await allocateId(client,newNumber);
  await cloneContent(client,before,replacement,newLevel,parentId,parent?.en_label);
  await retire(client,id,replacement);
  const after=await snapshot(client,replacement);
  await audit(client,replacement,'insert',null,{...after,replaces_concept_id:id},req);
  await audit(client,id,'update',before,await snapshot(client,id),req);
  return {concept:after.concept,retired_concept_id:id,replacement_concept_id:replacement};
}));

router.post('/concepts/:conceptId/retire', async (req,res) => transaction(req,res,async (client,id,before) => {
  if (!active(before.concept)) fail('This concept is already retired or inactive.');
  if (clean(req.body?.confirm_id)!==id) fail('Enter the concept ID to confirm retirement.',400);
  await requireLeaf(client,id);
  await requireUnused(client,id);
  const replacement=clean(req.body?.replacement_concept_id) || null;
  if (replacement===id) fail('Choose a different replacement concept.');
  if (replacement) {
    const result=await client.query('SELECT * FROM public.concepts_curated WHERE concept_id=$1',[replacement]);
    if (!result.rows.length || !active(result.rows[0])) fail('Choose an active replacement concept.');
  }
  await retire(client,id,replacement);
  const after=await snapshot(client,id);
  await audit(client,id,'update',before,after,req);
  return {concept:after.concept};
}));

router.delete('/concepts/:conceptId', async (req,res) => transaction(req,res,async (client,id,before) => {
  if (clean(req.body?.confirm_id)!==id) fail('Enter the concept ID to confirm deletion.',400);
  await requireLeaf(client,id);
  await requireUnused(client,id);
  const refs=await externalReferences(client,id);
  if (refs.length) fail(`This concept is referenced by ${refs.join('; ')}. Remove those references first or retire the concept.`);
  await audit(client,id,'delete',before,{deleted:true,concept_id:id},req);
  await client.query(`UPDATE vocab_workbench.concept_id_registry SET deleted_at=now(),deleted_snapshot=$2::jsonb WHERE concept_id=$1`,[id,JSON.stringify(before)]);
  await client.query("DELETE FROM public.concept_bibliographic_links WHERE vocabulary_code='site-types' AND concept_id=$1",[id]);
  await client.query('DELETE FROM public.concept_notes_curated WHERE concept_id=$1',[id]);
  await client.query('DELETE FROM public.labels_curated WHERE concept_id=$1',[id]);
  await client.query('DELETE FROM public.concepts_curated WHERE concept_id=$1',[id]);
  return {deleted:true,concept_id:id};
}));

module.exports=router;
