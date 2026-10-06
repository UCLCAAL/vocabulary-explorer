const express = require("express");
const pool = require("../db");
const router = express.Router();
// Mounted after requireLevel9 in vocabularies.js.
const LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"];
const validLanguage = value => LANGS.includes(value);
const normalise = value => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const SOURCES = ["public", "kz"].flatMap(schema => [
  { schema, table: "CAAL_RS3_Poly", columns: [1,2,3,4].map(n => `Monument type${n}`) },
  { schema, table: "CAAL_RS3_Line", columns: [1,2,3,4].map(n => `Monument type${n}`) },
  { schema, table: "CAAL_RS3_Group", columns: [1,2,3,4].map(n => `Monument type ${n}`) },
  { schema, table: "CAAL_Monuments", columns: [1,2,3,4,5,6].map(n => `Monument Type${n}`) }
]);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function buildSourceSql(identityColumns) {
  return SOURCES.map(source => {
    const identityColumn = identityColumns.get(`${source.schema}.${source.table}`);
    const identitySql = identityColumn ? `NULLIF(btrim(t.${quote(identityColumn)}::text), '')` : 'NULL::text';
    return `
      SELECT '${source.schema}'::text AS source_schema, '${source.table}'::text AS source_table,
             t.id::text AS row_id, ${identitySql} AS caal_id,
             cells.field, btrim(cells.value) AS value
      FROM ${quote(source.schema)}.${quote(source.table)} t
      CROSS JOIN LATERAL (VALUES ${source.columns.map(column => `('${column}', t.${quote(column)}::text)`).join(", ")}) cells(field, value)
      WHERE NULLIF(btrim(cells.value), '') IS NOT NULL
    `;
  }).join("\nUNION ALL\n");
}


router.get("/review/preference", async (req, res) => {
  try {
    const user = req.session.workbenchSession;
    const result = await pool.query("SELECT default_language FROM vocab_workbench.review_preferences WHERE user_id = $1", [String(user.user.user_id)]);
    const profileLanguage = String(user.profile?.preferred_language || "").toLowerCase();
    return res.json({ ok: true, language: result.rows[0]?.default_language || (validLanguage(profileLanguage) ? profileLanguage : "en"), saved_default: result.rows[0]?.default_language || null });
  } catch (error) {
    console.error("Review preference failed:", error);
    return res.status(500).json({ ok: false, error: "Review preferences are unavailable. Check the Review migration and database permissions." });
  }
});

router.put("/review/preference", async (req, res) => {
  const language = String(req.body?.language || "").toLowerCase();
  if (!validLanguage(language)) return res.status(400).json({ ok: false, error: "Unsupported language" });
  try {
    await pool.query(`INSERT INTO vocab_workbench.review_preferences (user_id, default_language)
      VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET default_language = EXCLUDED.default_language, updated_at = now()`,
      [String(req.session.workbenchSession.user.user_id), language]);
    return res.json({ ok: true, language });
  } catch (error) {
    console.error("Save Review preference failed:", error);
    return res.status(500).json({ ok: false, error: "Could not save your default Review language" });
  }
});

router.get("/review", async (req, res) => {
  const language = String(req.query.language || "en").toLowerCase();
  const referenceLanguage = String(req.query.reference_language || "en").toLowerCase();
  const filter = String(req.query.missing || "any");
  if (!validLanguage(language) || !validLanguage(referenceLanguage)) return res.status(400).json({ ok: false, error: "Unsupported language" });
  if (!["any", "label", "definition", "both", "all", "conflicts"].includes(filter)) return res.status(400).json({ ok: false, error: "Unsupported Review filter" });
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const search = normalise(req.query.q);
  try {
    const result = await pool.query(`
      WITH labels AS (
        SELECT concept_id,
          min(NULLIF(btrim(label), '')) FILTER (WHERE lang = $1 AND lower(COALESCE(status, '')) = 'preferred') AS preferred_label,
          count(*) FILTER (WHERE lang = $1 AND lower(COALESCE(status, '')) = 'preferred')::int AS label_count,
          min(NULLIF(btrim(label), '')) FILTER (WHERE lang = $2 AND lower(COALESCE(status, '')) = 'preferred') AS reference_label,
          jsonb_agg(jsonb_build_object('label_id', label_id, 'label', label) ORDER BY label_id)
            FILTER (WHERE lang = $1 AND lower(COALESCE(status, '')) = 'alt' AND NULLIF(btrim(label), '') IS NOT NULL) AS alternative_labels
        FROM public.labels_curated
        WHERE lower(COALESCE(status, '')) IN ('preferred', 'alt') AND lang IN ($1, $2)
        GROUP BY concept_id
      ), definitions AS (
        SELECT concept_id,
          min(NULLIF(btrim(note), '')) FILTER (WHERE lang = $1) AS definition,
          count(*) FILTER (WHERE lang = $1)::int AS definition_count,
          min(NULLIF(btrim(note), '')) FILTER (WHERE lang = $2) AS reference_definition
        FROM public.concept_notes_curated
        WHERE lower(COALESCE(note_type, '')) = 'definition' AND lang IN ($1, $2)
        GROUP BY concept_id
      )
      SELECT c.concept_id, c.level, c.en_label,
             l.preferred_label, COALESCE(l.label_count, 0) AS label_count,
             l.reference_label, COALESCE(l.alternative_labels, '[]'::jsonb) AS alternative_labels, d.definition, d.reference_definition,
             COALESCE(d.definition_count, 0) AS definition_count
      FROM public.concepts_curated c
      LEFT JOIN labels l ON l.concept_id = c.concept_id
      LEFT JOIN definitions d ON d.concept_id = c.concept_id
      WHERE c.sort_order IS NOT NULL
        AND lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true')) NOT IN ('false','0','no','inactive')
      ORDER BY c.sort_order, c.concept_id
    `, [language, referenceLanguage]);
    const rows = result.rows.map(row => ({ ...row, missing_label: !row.preferred_label, missing_definition: !row.definition,
      conflict: row.label_count > 1 || row.definition_count > 1 }));
    const counts = { total: rows.length, missing_label: 0, missing_definition: 0, missing_both: 0, missing_any: 0, conflicts: 0 };
    for (const row of rows) {
      counts.missing_label += Number(row.missing_label);
      counts.missing_definition += Number(row.missing_definition);
      counts.missing_both += Number(row.missing_label && row.missing_definition);
      counts.missing_any += Number(row.missing_label || row.missing_definition);
      counts.conflicts += Number(row.conflict);
    }
    const matches = rows.filter(row => {
      const missingMatches = filter === "all" || (filter === "any" && (row.missing_label || row.missing_definition)) ||
        (filter === "label" && row.missing_label) || (filter === "definition" && row.missing_definition) ||
        (filter === "both" && row.missing_label && row.missing_definition) || (filter === "conflicts" && row.conflict);
      return missingMatches && (!search || [row.concept_id, row.reference_label, row.en_label, row.preferred_label].some(value => normalise(value).includes(search)));
    });
    return res.json({ ok: true, language, reference_language: referenceLanguage, counts, matched: matches.length, offset, limit, rows: matches.slice(offset, offset + limit) });
  } catch (error) {
    console.error("Site Types Review failed:", error);
    return res.status(500).json({ ok: false, error: "Could not audit Site Types translations" });
  }
});

router.get("/concepts/:conceptId/usage", async (req, res) => {
  const conceptId = String(req.params.conceptId || "").trim();
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '25s'");
    const identityResult = await client.query(`
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema IN ('public', 'kz')
        AND table_name IN ('CAAL_RS3_Poly', 'CAAL_RS3_Line', 'CAAL_RS3_Group', 'CAAL_Monuments')
        AND column_name IN ('CAAL_ID', 'CAAL ID', 'caal_id')
      ORDER BY table_schema, table_name,
        CASE column_name WHEN 'CAAL_ID' THEN 0 WHEN 'CAAL ID' THEN 1 ELSE 2 END
    `);
    const identityColumns = new Map();
    for (const row of identityResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!identityColumns.has(key)) identityColumns.set(key, row.column_name);
    }
    const sourcesSql = buildSourceSql(identityColumns);
    // One statement provides a consistent snapshot across every authoritative source.
    // Match whole field values only: no substring or speculative delimiter splitting.
    const result = await client.query(`
      WITH concepts AS (
        SELECT c.concept_id, c.en_label,
          COALESCE((SELECT min(NULLIF(btrim(l.label), '')) FROM public.labels_curated l
                    WHERE l.concept_id = c.concept_id AND l.lang = 'en' AND lower(COALESCE(l.status, '')) = 'preferred'),
                   NULLIF(btrim(c.en_label), ''), c.concept_id) AS english_label
        FROM public.concepts_curated c
      ), vocabulary AS (
        SELECT concept_id, label AS value FROM public.labels_curated
        UNION SELECT concept_id, en_label FROM concepts
        UNION SELECT concept_id, concept_id FROM concepts
        UNION SELECT c.concept_id, s.concept_uri_base || c.concept_id
          FROM concepts c CROSS JOIN public.vocabulary_schemes s WHERE s.vocabulary_code = 'site-types'
      ), aliases AS (
        SELECT lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')) AS key,
               array_agg(DISTINCT concept_id ORDER BY concept_id) AS candidates
        FROM vocabulary WHERE NULLIF(btrim(value), '') IS NOT NULL GROUP BY 1
      ), target_aliases AS (
        SELECT * FROM aliases WHERE $1 = ANY(candidates)
      ), cells AS (${sourcesSql}), matches AS (
        SELECT cells.*, a.candidates,
          CASE WHEN lower(cells.value) = lower($1) THEN 'concept_id'
               WHEN cells.value ~* '^https?://' THEN 'concept_uri'
               WHEN cardinality(a.candidates) > 1 THEN 'ambiguous_label'
               ELSE 'legacy_label' END AS match_kind
        FROM cells JOIN target_aliases a ON a.key = lower(regexp_replace(btrim(cells.value), '[[:space:]]+', ' ', 'g'))
        WHERE $1 = ANY(a.candidates)
      )
      SELECT EXISTS(SELECT 1 FROM concepts WHERE concept_id = $1) AS concept_exists,
        (SELECT count(*)::int FROM matches) AS field_count,
        (SELECT count(*)::int FROM (SELECT DISTINCT source_schema, source_table, row_id FROM matches) records) AS record_count,
        (SELECT count(*)::int FROM matches WHERE match_kind = 'ambiguous_label') AS ambiguous_field_count,
        COALESCE((SELECT jsonb_agg(summary ORDER BY source_schema, source_table) FROM (
          SELECT source_schema, source_table, count(*)::int AS field_count, count(DISTINCT row_id)::int AS record_count
          FROM matches GROUP BY source_schema, source_table
        ) summary), '[]'::jsonb) AS sources,
        COALESCE((SELECT jsonb_agg(sample) FROM (
          SELECT limited.*,
            (SELECT string_agg(DISTINCT ref.english_label, '; ' ORDER BY ref.english_label)
             FROM concepts ref WHERE ref.concept_id = ANY(limited.candidates)) AS english_label
          FROM (SELECT * FROM matches ORDER BY source_schema, source_table, row_id, field LIMIT 100) limited
        ) sample), '[]'::jsonb) AS examples
    `, [conceptId]);
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row.concept_exists) return res.status(404).json({ ok: false, error: "Concept not found" });
    return res.json({ ok: true, checked_at: new Date().toISOString(), coverage: "all_eight_source_tables", ...row,
      limitation: "Whole-field matches against current labels, IDs and registered URIs. Historical labels no longer retained in the vocabulary and compound values may remain unresolved. This report does not authorise permanent deletion." });
  } catch (error) {
    if (client) { try { await client.query("ROLLBACK"); } catch {} }
    console.error("Site Types usage check failed:", error);
    return res.status(error.code === "57014" ? 504 : 503).json({
      ok: false, usage_status: "unknown",
      error: error.code === "57014" ? "The record check timed out. Try again or ask an administrator to check the server log." : "Records could not be checked across all eight source tables."
    });
  } finally {
    client?.release();
  }
});

module.exports = router;
