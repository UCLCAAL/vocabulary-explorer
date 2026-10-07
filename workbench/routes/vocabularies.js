const express = require("express");
const pool = require("../db");
const requireLevel9 = require("../middleware/requireLevel9");

const router = express.Router();

const LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"];
const VOCABULARY_CODE = "site-types";

router.use(requireLevel9);
router.use("/site-types", require("./siteTypeManagement"));
router.use("/site-types", require("./siteTypeReview"));

router.use("/site-types/concepts/:conceptId", async (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  try {
    const result = await pool.query("SELECT lifecycle_status FROM public.concepts_curated WHERE concept_id=$1", [req.params.conceptId]);
    if (result.rows[0]?.lifecycle_status === "retired") return res.status(409).json({ok:false,error:"Retired concepts are read-only. Open their replacement to edit it."});
    return next();
  } catch (error) { return res.status(503).json({ok:false,error:"Could not check concept status."}); }
});

function clean(value) {
  return String(value ?? "").trim();
}

function normaliseKey(value) {
  return clean(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function validLanguage(lang) {
  return LANGS.includes(String(lang || "").toLowerCase());
}

const BIB_RELATION_TYPES = new Set([
  "source",
  "reference"
]);

function validBibliographyRelation(value) {
  return BIB_RELATION_TYPES.has(String(value || "").trim());
}

function normaliseDoi(value) {
  let doi = clean(value);

  doi = doi.replace(/^doi:\s*/i, "");
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");

  return doi.trim();
}

function doiUrl(doi) {
  const value = normaliseDoi(doi);
  return value ? `https://doi.org/${value}` : "";
}


async function writeRevision(client, {
  conceptId,
  entityType,
  entityId,
  action,
  lang,
  oldData,
  newData,
  session
}) {
  await client.query(
    `
    INSERT INTO vocab_workbench.concept_revisions
      (
        vocabulary_code,
        concept_id,
        entity_type,
        entity_id,
        action,
        lang,
        old_data,
        new_data,
        changed_by_user_id,
        changed_by_username
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
    `,
    [
      VOCABULARY_CODE,
      conceptId,
      entityType,
      entityId ? String(entityId) : null,
      action,
      lang,
      oldData ? JSON.stringify(oldData) : null,
      JSON.stringify(newData),
      session?.user?.user_id == null
        ? null
        : String(session.user.user_id),
      String(session?.user?.username || "")
    ]
  );
}

async function syncEnglishCompatibilityFields(client, conceptId, labelOrNull) {
  await client.query(
    `
    UPDATE public.concepts_curated
    SET en_label = $2
    WHERE concept_id = $1
    `,
    [conceptId, labelOrNull]
  );

  await client.query(
    `
    UPDATE public.labels_curated
    SET en_label = $2
    WHERE concept_id = $1
    `,
    [conceptId, labelOrNull]
  );
}

async function nextNumericLabelId(client) {
  await client.query(
    "LOCK TABLE public.labels_curated IN SHARE ROW EXCLUSIVE MODE"
  );

  const result = await client.query(
    `
    SELECT COALESCE(
      max(label_id::bigint) FILTER (WHERE label_id ~ '^[0-9]+$'),
      0
    ) + 1 AS next_id
    FROM public.labels_curated
    `
  );

  return String(result.rows[0].next_id);
}

router.get("/", async (req, res) => {
  try {
    const scheme = await pool.query(
      `
      SELECT
        vocabulary_code,
        scheme_uri,
        concept_uri_base,
        is_active
      FROM public.vocabulary_schemes
      WHERE vocabulary_code = $1
        AND is_active = true
      `,
      [VOCABULARY_CODE]
    );

    if (scheme.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Site Types vocabulary metadata was not found"
      });
    }

    const conceptCount = await pool.query(
      `
      SELECT count(*)::int AS concept_count
      FROM public.concepts_curated
      WHERE sort_order IS NOT NULL
        AND lower(COALESCE(NULLIF(btrim(is_active), ''), 'true'))
            NOT IN ('false', '0', 'no', 'inactive')
      `
    );

    const labelCoverage = await pool.query(
      `
      SELECT
        l.lang,
        count(DISTINCT l.concept_id)::int AS preferred_count
      FROM public.labels_curated l
      JOIN public.concepts_curated c
        ON c.concept_id = l.concept_id
      WHERE lower(COALESCE(l.status, '')) = 'preferred'
        AND NULLIF(btrim(l.label), '') IS NOT NULL
        AND c.sort_order IS NOT NULL
        AND lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true'))
            NOT IN ('false', '0', 'no', 'inactive')
      GROUP BY l.lang
      `
    );

    const noteCoverage = await pool.query(
      `
      SELECT
        n.lang,
        count(DISTINCT n.concept_id)::int AS note_count
      FROM public.concept_notes_curated n
      JOIN public.concepts_curated c
        ON c.concept_id = n.concept_id
      WHERE lower(COALESCE(n.note_type, '')) = 'definition'
        AND NULLIF(btrim(n.note), '') IS NOT NULL
        AND c.sort_order IS NOT NULL
        AND lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true'))
            NOT IN ('false', '0', 'no', 'inactive')
      GROUP BY n.lang
      `
    );

    const labels = Object.fromEntries(LANGS.map((lang) => [lang, 0]));
    for (const row of labelCoverage.rows) {
      if (row.lang in labels) labels[row.lang] = row.preferred_count;
    }

    const notes = Object.fromEntries(LANGS.map((lang) => [lang, 0]));
    for (const row of noteCoverage.rows) {
      if (row.lang in notes) notes[row.lang] = row.note_count;
    }

    return res.json({
      ok: true,
      vocabularies: [
        {
          ...scheme.rows[0],
          concept_count: conceptCount.rows[0].concept_count,
          labels_by_language: labels,
          definitions_by_language: notes
        }
      ]
    });
  } catch (error) {
    console.error("Failed to load vocabulary summary:", error);
    return res.status(500).json({
      ok: false,
      error: "Failed to load vocabulary summary"
    });
  }
});

router.get("/site-types/concepts", async (req, res) => {
  const q = clean(req.query.q);
  const includeRetired = req.query.include_retired === "true";

  try {
    const result = await pool.query(
      `
      SELECT
        c.concept_id,
        c.level,
        c.parent_id,
        c.sort_order,
        c.lifecycle_status,
        c.replaced_by_concept_id,
        en.label AS label_en,
        ru.label AS label_ru,
        zh.label AS label_zh,
        best_match.match_kind,
        best_match.match_lang,
        best_match.match_label,
        best_match.match_status,
        best_match.match_rank,
        CASE
          WHEN best_match.match_kind = 'label'
           AND (
             lower(COALESCE(best_match.match_status, '')) <> 'preferred'
             OR COALESCE(best_match.match_lang, '') NOT IN ('en', 'ru', 'zh')
           )
          THEN true
          ELSE false
        END AS show_match_context
      FROM public.concepts_curated c

      LEFT JOIN LATERAL (
        SELECT label
        FROM public.labels_curated
        WHERE concept_id = c.concept_id
          AND lang = 'en'
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        LIMIT 1
      ) en ON true

      LEFT JOIN LATERAL (
        SELECT label
        FROM public.labels_curated
        WHERE concept_id = c.concept_id
          AND lang = 'ru'
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        LIMIT 1
      ) ru ON true

      LEFT JOIN LATERAL (
        SELECT label
        FROM public.labels_curated
        WHERE concept_id = c.concept_id
          AND lang = 'zh'
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        LIMIT 1
      ) zh ON true

      LEFT JOIN LATERAL (
        SELECT
          ranked.match_kind,
          ranked.match_lang,
          ranked.match_label,
          ranked.match_status,
          ranked.match_rank
        FROM (
          SELECT
            'label'::text AS match_kind,
            ls.lang AS match_lang,
            ls.label AS match_label,
            ls.status AS match_status,
            CASE
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'en'
               AND lower(ls.label) = lower($1)
                THEN 10
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'ru'
               AND lower(ls.label) = lower($1)
                THEN 20
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'zh'
               AND lower(ls.label) = lower($1)
                THEN 30

              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'en'
               AND ls.label ILIKE $1 || '%'
                THEN 40
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'ru'
               AND ls.label ILIKE $1 || '%'
                THEN 50
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'zh'
               AND ls.label ILIKE $1 || '%'
                THEN 60

              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'en'
                THEN 70
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'ru'
                THEN 80
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.lang = 'zh'
                THEN 90

              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND lower(ls.label) = lower($1)
                THEN 100
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
               AND ls.label ILIKE $1 || '%'
                THEN 110
              WHEN lower(COALESCE(ls.status, '')) = 'preferred'
                THEN 120

              WHEN lower(ls.label) = lower($1)
                THEN 130
              WHEN ls.label ILIKE $1 || '%'
                THEN 140
              ELSE 150
            END AS match_rank
          FROM public.labels_curated ls
          WHERE $1 <> ''
            AND ls.concept_id = c.concept_id
            AND ls.label ILIKE '%' || $1 || '%'

          UNION ALL

          SELECT
            'concept_id'::text AS match_kind,
            NULL::text AS match_lang,
            c.concept_id::text AS match_label,
            NULL::text AS match_status,
            CASE
              WHEN lower(c.concept_id) = lower($1)
                THEN 160
              WHEN c.concept_id ILIKE $1 || '%'
                THEN 170
              ELSE 180
            END AS match_rank
          WHERE $1 <> ''
            AND c.concept_id ILIKE '%' || $1 || '%'
        ) ranked
        ORDER BY
          ranked.match_rank,
          lower(COALESCE(ranked.match_label, '')),
          COALESCE(ranked.match_lang, '')
        LIMIT 1
      ) best_match ON true

      WHERE c.sort_order IS NOT NULL
        AND ((lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true'))
            NOT IN ('false', '0', 'no', 'inactive')) OR ($2::boolean AND c.lifecycle_status='retired'))
        AND (
          $1 = ''
          OR best_match.match_rank IS NOT NULL
        )

      ORDER BY
        CASE WHEN $1 = '' THEN 0 ELSE best_match.match_rank END,
        c.sort_order,
        c.concept_id
      `,
      [q, includeRetired]
    );

    return res.json({
      ok: true,
      concepts: result.rows
    });
  } catch (error) {
    console.error("Failed to load concepts:", error);
    return res.status(500).json({
      ok: false,
      error: "Failed to load concepts"
    });
  }
});

router.post("/site-types/concepts", async (req, res) => {
  const parentId = clean(req.body?.parent_id) || null;
  const suppliedLabels =
    req.body?.labels && typeof req.body.labels === "object"
      ? req.body.labels
      : {};

  const labels = Object.fromEntries(
    LANGS
      .map((lang) => [lang, clean(suppliedLabels[lang])])
      .filter(([, label]) => label)
  );

  const englishLabel = labels.en;

  if (!englishLabel) {
    return res.status(400).json({
      ok: false,
      error: "English preferred label is required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Concept IDs and sort order are allocated centrally here. Locking the
    // curated concept table prevents two administrators from receiving the
    // same next MT identifier during concurrent creation.
    await client.query(
      "LOCK TABLE public.concepts_curated IN SHARE ROW EXCLUSIVE MODE"
    );

    let parent = null;
    let levelNumber = 1;
    let parentEnglish = "NA";

    if (parentId) {
      const parentResult = await client.query(
        `
        SELECT
          c.concept_id,
          c.level,
          COALESCE(en.label, NULLIF(c.en_label, ''), c.concept_id) AS label_en
        FROM public.concepts_curated c
        LEFT JOIN LATERAL (
          SELECT label
          FROM public.labels_curated
          WHERE concept_id = c.concept_id
            AND lang = 'en'
            AND lower(COALESCE(status, '')) = 'preferred'
          ORDER BY label_id
          LIMIT 1
        ) en ON true
        WHERE c.concept_id = $1
          AND lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true'))
              NOT IN ('false', '0', 'no', 'inactive')
        `,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "Parent concept was not found"
        });
      }

      parent = parentResult.rows[0];

      const levelMatch = String(parent.level || "").match(/^L(\d+)$/i);
      const parentLevel = levelMatch ? Number(levelMatch[1]) : NaN;

      if (!Number.isInteger(parentLevel) || parentLevel < 1 || parentLevel >= 4) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "New Site Types can only be created within hierarchy levels L1-L4"
        });
      }

      levelNumber = parentLevel + 1;
      parentEnglish = clean(parent.label_en) || parent.concept_id;
    }

    const duplicate = await client.query(
      `
      SELECT c.concept_id
      FROM public.concepts_curated c
      JOIN public.labels_curated l
        ON l.concept_id = c.concept_id
       AND l.lang = 'en'
       AND lower(COALESCE(l.status, '')) = 'preferred'
      WHERE c.parent_id IS NOT DISTINCT FROM $1
        AND lower(btrim(l.label)) = lower(btrim($2))
        AND lower(COALESCE(NULLIF(btrim(c.is_active), ''), 'true'))
            NOT IN ('false', '0', 'no', 'inactive')
      LIMIT 1
      `,
      [parentId, englishLabel]
    );

    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error:
          `A concept with that English preferred label already exists under this parent (${duplicate.rows[0].concept_id})`
      });
    }

    const nextIdResult = await client.query(
      `
      SELECT COALESCE(
        MAX(split_part(concept_id, '-', 3)::integer),
        0
      ) + 1 AS next_number
      FROM vocab_workbench.concept_id_registry
      WHERE concept_id ~ ('^MT-' || $1::text || '-[0-9]+$')
      `,
      [levelNumber]
    );

    const nextNumber = Number(nextIdResult.rows[0].next_number);

    if (!Number.isInteger(nextNumber) || nextNumber < 1) {
      throw new Error("Could not allocate the next Site Types concept ID");
    }

    const conceptId =
      `MT-${levelNumber}-${String(nextNumber).padStart(4, "0")}`;
    const level = `L${levelNumber}`;
    const idKey = `${level}|${englishLabel}|${parentEnglish}`;

    const sortResult = await client.query(
      `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
      FROM public.concepts_curated
      `
    );

    const sortOrder = Number(sortResult.rows[0].next_sort_order);

    const conceptResult = await client.query(
      `
      INSERT INTO public.concepts_curated
        (
          concept_id,
          level,
          parent_id,
          en_label,
          id_key,
          is_active,
          sort_order
        )
      VALUES
        ($1, $2, $3, $4, $5, 'true', $6)
      RETURNING
        concept_id,
        level,
        parent_id,
        en_label,
        id_key,
        is_active,
        sort_order
      `,
      [
        conceptId,
        level,
        parentId,
        englishLabel,
        idKey,
        sortOrder
      ]
    );

    const concept = conceptResult.rows[0];
    const insertedLabels = [];

    for (const lang of LANGS) {
      const label = labels[lang];
      if (!label) continue;

      const labelId = await nextNumericLabelId(client);

      const labelResult = await client.query(
        `
        INSERT INTO public.labels_curated
          (
            label_id,
            concept_id,
            lang,
            label,
            status,
            source,
            norm_key,
            level,
            en_label,
            disambiguation
          )
        VALUES
          ($1, $2, $3, $4, 'preferred', 'workbench', $5, $6, $7, NULL)
        RETURNING
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        `,
        [
          labelId,
          conceptId,
          lang,
          label,
          normaliseKey(label),
          level,
          englishLabel
        ]
      );

      const inserted = labelResult.rows[0];
      insertedLabels.push(inserted);

      await writeRevision(client, {
        conceptId,
        entityType: "preferred_label",
        entityId: inserted.label_id,
        action: "insert",
        lang,
        oldData: null,
        newData: inserted,
        session: req.session.workbenchSession
      });
    }

    await writeRevision(client, {
      conceptId,
      entityType: "concept",
      entityId: conceptId,
      action: "insert",
      lang: "und",
      oldData: null,
      newData: concept,
      session: req.session.workbenchSession
    });

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      concept,
      labels: insertedLabels
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to create Site Types concept:", error);

    return res.status(500).json({
      ok: false,
      error: "Failed to create Site Types concept",
      ...(process.env.NODE_ENV !== "production"
        ? { detail: error.message }
        : {})
    });
  } finally {
    client.release();
  }
});


router.get("/site-types/concepts/:conceptId", async (req, res) => {
  const conceptId = clean(req.params.conceptId);

  try {
    const concept = await pool.query(
      `
      SELECT
        concept_id,
        level,
        parent_id,
        en_label,
        id_key,
        is_active,
        lifecycle_status,
        replaced_by_concept_id,
        retired_at,
        sort_order
      FROM public.concepts_curated
      WHERE concept_id = $1
      `,
      [conceptId]
    );

    if (concept.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Concept not found"
      });
    }

    const labels = await pool.query(
      `
      SELECT
        label_id,
        lang,
        label,
        status,
        source,
        norm_key,
        disambiguation
      FROM public.labels_curated
      WHERE concept_id = $1
      ORDER BY
        CASE lang
          WHEN 'en' THEN 1
          WHEN 'ru' THEN 2
          WHEN 'zh' THEN 3
          WHEN 'kk' THEN 4
          WHEN 'ky' THEN 5
          WHEN 'tg' THEN 6
          WHEN 'tk' THEN 7
          WHEN 'uz' THEN 8
          ELSE 99
        END,
        CASE WHEN lower(COALESCE(status, '')) = 'preferred' THEN 0 ELSE 1 END,
        label_id
      `,
      [conceptId]
    );

    const notes = await pool.query(
      `
      SELECT
        note_id,
        lang,
        note_type,
        note,
        source,
        source_record,
        source_column,
        review_status,
        import_run_id,
        created_at,
        updated_at
      FROM public.concept_notes_curated
      WHERE concept_id = $1
        AND lower(COALESCE(note_type, '')) = 'definition'
      ORDER BY
        CASE lang
          WHEN 'en' THEN 1
          WHEN 'ru' THEN 2
          WHEN 'zh' THEN 3
          WHEN 'kk' THEN 4
          WHEN 'ky' THEN 5
          WHEN 'tg' THEN 6
          WHEN 'tk' THEN 7
          WHEN 'uz' THEN 8
          ELSE 99
        END,
        note_id
      `,
      [conceptId]
    );

    const scopeNotes = await pool.query(
      `
      SELECT
        note_id,
        lang,
        note_type,
        note,
        source,
        source_record,
        source_column,
        review_status,
        import_run_id,
        created_at,
        updated_at
      FROM public.concept_notes_curated
      WHERE concept_id = $1
        AND lower(COALESCE(note_type, '')) = 'scopenote'
      ORDER BY
        CASE lang
          WHEN 'en' THEN 1
          WHEN 'ru' THEN 2
          WHEN 'zh' THEN 3
          WHEN 'kk' THEN 4
          WHEN 'ky' THEN 5
          WHEN 'tg' THEN 6
          WHEN 'tk' THEN 7
          WHEN 'uz' THEN 8
          ELSE 99
        END,
        note_id
      `,
      [conceptId]
    );

    const bibliography = await pool.query(
      `
      SELECT
        l.link_id,
        l.reference_id,
        l.relation_type,
        l.note AS link_note,
        l.sort_order,
        r.citation,
        r.caal_permalink,
        r.doi,
        r.zotero_uri,
        r.external_uri,
        r.created_at AS reference_created_at,
        r.updated_at AS reference_updated_at
      FROM public.concept_bibliographic_links l
      JOIN public.vocabulary_bibliographic_resources r
        ON r.reference_id = l.reference_id
      WHERE l.vocabulary_code = $1
        AND l.concept_id = $2
      ORDER BY
        COALESCE(l.sort_order, 2147483647),
        l.link_id
      `,
      [VOCABULARY_CODE, conceptId]
    );

    const parent = await pool.query(
      `
      SELECT
        c.concept_id,
        en.label AS label_en
      FROM public.concepts_curated c
      LEFT JOIN LATERAL (
        SELECT label
        FROM public.labels_curated
        WHERE concept_id = c.concept_id
          AND lang = 'en'
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        LIMIT 1
      ) en ON true
      WHERE c.concept_id = (
        SELECT parent_id
        FROM public.concepts_curated
        WHERE concept_id = $1
      )
      `,
      [conceptId]
    );

    const children = await pool.query(
      `
      SELECT
        c.concept_id,
        c.sort_order,
        en.label AS label_en
      FROM public.concepts_curated c
      LEFT JOIN LATERAL (
        SELECT label
        FROM public.labels_curated
        WHERE concept_id = c.concept_id
          AND lang = 'en'
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        LIMIT 1
      ) en ON true
      WHERE c.parent_id = $1
      ORDER BY c.sort_order, c.concept_id
      `,
      [conceptId]
    );

    const history = await pool.query(
      `
      SELECT
        revision_id,
        entity_type,
        entity_id,
        action,
        lang,
        old_data,
        new_data,
        changed_by_username,
        changed_at
      FROM vocab_workbench.concept_revisions
      WHERE vocabulary_code = $1
        AND concept_id = $2
      ORDER BY changed_at DESC, revision_id DESC
      LIMIT 100
      `,
      [VOCABULARY_CODE, conceptId]
    );

    return res.json({
      ok: true,
      concept: concept.rows[0],
      labels: labels.rows,
      definitions: notes.rows,
      scope_notes: scopeNotes.rows,
      bibliography: bibliography.rows,
      hierarchy: {
        parent: parent.rows[0] || null,
        children: children.rows
      },
      history: history.rows
    });
  } catch (error) {
    console.error("Failed to load concept:", error);
    return res.status(500).json({
      ok: false,
      error: "Failed to load concept"
    });
  }
});

router.put(
  "/site-types/concepts/:conceptId/labels/:lang",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();
    const label = clean(req.body?.label);

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    if (!label) {
      return res.status(400).json({
        ok: false,
        error: "Preferred label cannot be empty"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const conceptResult = await client.query(
        `
        SELECT concept_id, level, en_label
        FROM public.concepts_curated
        WHERE concept_id = $1
        FOR UPDATE
        `,
        [conceptId]
      );

      if (conceptResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Concept not found"
        });
      }

      const preferredResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(status, '')) = 'preferred'
        ORDER BY label_id
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (preferredResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple preferred labels already exist for this concept/language. " +
            "Resolve the data conflict before editing."
        });
      }

      let oldData = null;
      let updated;
      let action = "insert";

      if (preferredResult.rows.length === 1) {
        oldData = preferredResult.rows[0];
        action = "update";

        if (oldData.label === label) {
          await client.query("ROLLBACK");
          return res.json({
            ok: true,
            unchanged: true,
            label: oldData
          });
        }

        const updateResult = await client.query(
          `
          UPDATE public.labels_curated
          SET
            label = $1,
            norm_key = $2
          WHERE label_id = $3
          RETURNING
            label_id,
            concept_id,
            lang,
            label,
            status,
            source,
            norm_key,
            level,
            en_label,
            disambiguation
          `,
          [label, normaliseKey(label), oldData.label_id]
        );

        updated = updateResult.rows[0];
      } else {
        const exactExisting = await client.query(
          `
          SELECT
            label_id,
            concept_id,
            lang,
            label,
            status,
            source,
            norm_key,
            level,
            en_label,
            disambiguation
          FROM public.labels_curated
          WHERE concept_id = $1
            AND lang = $2
            AND label = $3
          ORDER BY label_id
          LIMIT 1
          FOR UPDATE
          `,
          [conceptId, lang, label]
        );

        if (exactExisting.rows.length === 1) {
          oldData = exactExisting.rows[0];
          action = "update";

          const promoteResult = await client.query(
            `
            UPDATE public.labels_curated
            SET
              status = 'preferred',
              norm_key = $1
            WHERE label_id = $2
            RETURNING
              label_id,
              concept_id,
              lang,
              label,
              status,
              source,
              norm_key,
              level,
              en_label,
              disambiguation
            `,
            [normaliseKey(label), oldData.label_id]
          );

          updated = promoteResult.rows[0];
        } else {
          const labelId = await nextNumericLabelId(client);
          const concept = conceptResult.rows[0];

          const insertResult = await client.query(
            `
            INSERT INTO public.labels_curated
              (
                label_id,
                concept_id,
                lang,
                label,
                status,
                source,
                norm_key,
                level,
                en_label,
                disambiguation
              )
            VALUES
              ($1, $2, $3, $4, 'preferred', 'workbench', $5, $6, $7, NULL)
            RETURNING
              label_id,
              concept_id,
              lang,
              label,
              status,
              source,
              norm_key,
              level,
              en_label,
              disambiguation
            `,
            [
              labelId,
              conceptId,
              lang,
              label,
              normaliseKey(label),
              concept.level,
              concept.en_label
            ]
          );

          updated = insertResult.rows[0];
        }
      }

      if (lang === "en") {
        await syncEnglishCompatibilityFields(client, conceptId, label);
        updated.en_label = label;
      }

      await writeRevision(client, {
        conceptId,
        entityType: "preferred_label",
        entityId: updated.label_id,
        action,
        lang,
        oldData,
        newData: updated,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        label: updated
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to save preferred label:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to save preferred label"
      });
    } finally {
      client.release();
    }
  }
);

router.put(
  "/site-types/concepts/:conceptId/definitions/:lang",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();
    const note = clean(req.body?.note);

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    if (!note) {
      return res.status(400).json({
        ok: false,
        error: "Definition cannot be empty"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const conceptResult = await client.query(
        `
        SELECT concept_id
        FROM public.concepts_curated
        WHERE concept_id = $1
        FOR UPDATE
        `,
        [conceptId]
      );

      if (conceptResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Concept not found"
        });
      }

      const existingResult = await client.query(
        `
        SELECT
          note_id,
          concept_id,
          lang,
          note_type,
          note,
          source,
          source_record,
          source_column,
          review_status,
          import_run_id,
          created_at,
          updated_at
        FROM public.concept_notes_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(note_type, '')) = 'definition'
        ORDER BY note_id
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (existingResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple definitions already exist for this concept/language. " +
            "Resolve the data conflict before editing."
        });
      }

      let oldData = null;
      let updated;
      let action = "insert";

      if (existingResult.rows.length === 1) {
        oldData = existingResult.rows[0];
        action = "update";

        if (oldData.note === note) {
          await client.query("ROLLBACK");
          return res.json({
            ok: true,
            unchanged: true,
            definition: oldData
          });
        }

        const updateResult = await client.query(
          `
          UPDATE public.concept_notes_curated
          SET
            note = $1,
            review_status = 'reviewed',
            updated_at = now()
          WHERE note_id = $2
          RETURNING
            note_id,
            concept_id,
            lang,
            note_type,
            note,
            source,
            source_record,
            source_column,
            review_status,
            import_run_id,
            created_at,
            updated_at
          `,
          [note, oldData.note_id]
        );

        updated = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `
          INSERT INTO public.concept_notes_curated
            (
              concept_id,
              lang,
              note_type,
              note,
              source,
              review_status
            )
          VALUES
            ($1, $2, 'definition', $3, 'workbench', 'reviewed')
          RETURNING
            note_id,
            concept_id,
            lang,
            note_type,
            note,
            source,
            source_record,
            source_column,
            review_status,
            import_run_id,
            created_at,
            updated_at
          `,
          [conceptId, lang, note]
        );

        updated = insertResult.rows[0];
      }

      await writeRevision(client, {
        conceptId,
        entityType: "definition",
        entityId: updated.note_id,
        action,
        lang,
        oldData,
        newData: updated,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        definition: updated
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to save definition:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to save definition"
      });
    } finally {
      client.release();
    }
  }
);


router.delete(
  "/site-types/concepts/:conceptId/definitions/:lang",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const conceptResult = await client.query(
        `
        SELECT concept_id
        FROM public.concepts_curated
        WHERE concept_id = $1
        FOR UPDATE
        `,
        [conceptId]
      );

      if (conceptResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Concept not found"
        });
      }

      const existingResult = await client.query(
        `
        SELECT
          note_id,
          concept_id,
          lang,
          note_type,
          note,
          source,
          source_record,
          source_column,
          review_status,
          import_run_id,
          created_at,
          updated_at
        FROM public.concept_notes_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(note_type, '')) = 'definition'
        ORDER BY note_id
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          deleted: false
        });
      }

      if (existingResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple definitions already exist for this concept/language. " +
            "Resolve the data conflict before deleting."
        });
      }

      const oldData = existingResult.rows[0];

      await client.query(
        `
        DELETE FROM public.concept_notes_curated
        WHERE note_id = $1
        `,
        [oldData.note_id]
      );

      await writeRevision(client, {
        conceptId,
        entityType: "definition",
        entityId: oldData.note_id,
        action: "delete",
        lang,
        oldData,
        newData: {
          deleted: true,
          concept_id: conceptId,
          lang,
          note_type: "definition"
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to delete definition:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to delete definition"
      });
    } finally {
      client.release();
    }
  }
);



router.put(
  "/site-types/concepts/:conceptId/scope-notes/:lang",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();
    const note = clean(req.body?.note);

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    if (!note) {
      return res.status(400).json({
        ok: false,
        error: "Scope note cannot be empty"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const conceptResult = await client.query(
        `
        SELECT concept_id
        FROM public.concepts_curated
        WHERE concept_id = $1
        FOR UPDATE
        `,
        [conceptId]
      );

      if (conceptResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Concept not found"
        });
      }

      const existingResult = await client.query(
        `
        SELECT
          note_id,
          concept_id,
          lang,
          note_type,
          note,
          source,
          source_record,
          source_column,
          review_status,
          import_run_id,
          created_at,
          updated_at
        FROM public.concept_notes_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(note_type, '')) = 'scopenote'
        ORDER BY note_id
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (existingResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple scope notes already exist for this concept/language. " +
            "Resolve the data conflict before editing."
        });
      }

      let oldData = null;
      let updated;
      let action = "insert";

      if (existingResult.rows.length === 1) {
        oldData = existingResult.rows[0];
        action = "update";

        if (oldData.note === note) {
          await client.query("ROLLBACK");
          return res.json({
            ok: true,
            unchanged: true,
            scope_note: oldData
          });
        }

        const updateResult = await client.query(
          `
          UPDATE public.concept_notes_curated
          SET
            note = $1,
            review_status = 'reviewed',
            updated_at = now()
          WHERE note_id = $2
          RETURNING
            note_id,
            concept_id,
            lang,
            note_type,
            note,
            source,
            source_record,
            source_column,
            review_status,
            import_run_id,
            created_at,
            updated_at
          `,
          [note, oldData.note_id]
        );

        updated = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `
          INSERT INTO public.concept_notes_curated
            (
              concept_id,
              lang,
              note_type,
              note,
              source,
              review_status
            )
          VALUES
            ($1, $2, 'scopeNote', $3, 'workbench', 'reviewed')
          RETURNING
            note_id,
            concept_id,
            lang,
            note_type,
            note,
            source,
            source_record,
            source_column,
            review_status,
            import_run_id,
            created_at,
            updated_at
          `,
          [conceptId, lang, note]
        );

        updated = insertResult.rows[0];
      }

      await writeRevision(client, {
        conceptId,
        entityType: "scope_note",
        entityId: updated.note_id,
        action,
        lang,
        oldData,
        newData: updated,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        scope_note: updated
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to save scope note:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to save scope note"
      });
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/site-types/concepts/:conceptId/scope-notes/:lang",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
        SELECT
          note_id,
          concept_id,
          lang,
          note_type,
          note,
          source,
          source_record,
          source_column,
          review_status,
          import_run_id,
          created_at,
          updated_at
        FROM public.concept_notes_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(note_type, '')) = 'scopenote'
        ORDER BY note_id
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          deleted: false
        });
      }

      if (existingResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple scope notes already exist for this concept/language. " +
            "Resolve the data conflict before deleting."
        });
      }

      const oldData = existingResult.rows[0];

      await client.query(
        `
        DELETE FROM public.concept_notes_curated
        WHERE note_id = $1
        `,
        [oldData.note_id]
      );

      await writeRevision(client, {
        conceptId,
        entityType: "scope_note",
        entityId: oldData.note_id,
        action: "delete",
        lang,
        oldData,
        newData: {
          deleted: true,
          concept_id: conceptId,
          lang,
          note_type: "scopeNote"
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to delete scope note:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to delete scope note"
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/site-types/concepts/:conceptId/bibliography",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);

    const citation = clean(req.body?.citation);
    const caalPermalink = clean(req.body?.caal_permalink);
    const doi = normaliseDoi(req.body?.doi);
    const zoteroUri = clean(req.body?.zotero_uri);
    const externalUri = clean(req.body?.external_uri);
    const relationType = clean(req.body?.relation_type) || "source";
    const linkNote = clean(req.body?.note);

    if (!validBibliographyRelation(relationType)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported bibliography relationship"
      });
    }

    if (!citation && !caalPermalink && !doi && !zoteroUri && !externalUri) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter a citation or at least one bibliography/DOI/Zotero/URI link"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const conceptResult = await client.query(
        `
        SELECT concept_id
        FROM public.concepts_curated
        WHERE concept_id = $1
        FOR UPDATE
        `,
        [conceptId]
      );

      if (conceptResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Concept not found"
        });
      }

      const matchResult = await client.query(
        `
        SELECT *
        FROM public.vocabulary_bibliographic_resources
        WHERE
          ($1 <> '' AND lower(COALESCE(caal_permalink, '')) = lower($1))
          OR ($2 <> '' AND lower(COALESCE(doi, '')) = lower($2))
          OR ($3 <> '' AND lower(COALESCE(zotero_uri, '')) = lower($3))
          OR ($4 <> '' AND lower(COALESCE(external_uri, '')) = lower($4))
        ORDER BY reference_id
        LIMIT 1
        FOR UPDATE
        `,
        [caalPermalink, doi, zoteroUri, externalUri]
      );

      let reference;

      if (matchResult.rows.length === 1) {
        const existing = matchResult.rows[0];

        const updateResult = await client.query(
          `
          UPDATE public.vocabulary_bibliographic_resources
          SET
            citation = CASE
              WHEN COALESCE(btrim(citation), '') = '' AND $2 <> ''
              THEN $2
              ELSE citation
            END,
            caal_permalink = CASE
              WHEN COALESCE(btrim(caal_permalink), '') = '' AND $3 <> ''
              THEN $3
              ELSE caal_permalink
            END,
            doi = CASE
              WHEN COALESCE(btrim(doi), '') = '' AND $4 <> ''
              THEN $4
              ELSE doi
            END,
            zotero_uri = CASE
              WHEN COALESCE(btrim(zotero_uri), '') = '' AND $5 <> ''
              THEN $5
              ELSE zotero_uri
            END,
            external_uri = CASE
              WHEN COALESCE(btrim(external_uri), '') = '' AND $6 <> ''
              THEN $6
              ELSE external_uri
            END,
            updated_by_username = $7,
            updated_at = now()
          WHERE reference_id = $1
          RETURNING *
          `,
          [
            existing.reference_id,
            citation,
            caalPermalink,
            doi,
            zoteroUri,
            externalUri,
            String(req.session.workbenchSession?.user?.username || "")
          ]
        );

        reference = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `
          INSERT INTO public.vocabulary_bibliographic_resources
            (
              citation,
              caal_permalink,
              doi,
              zotero_uri,
              external_uri,
              created_by_username,
              updated_by_username
            )
          VALUES
            (
              NULLIF($1, ''),
              NULLIF($2, ''),
              NULLIF($3, ''),
              NULLIF($4, ''),
              NULLIF($5, ''),
              $6,
              $6
            )
          RETURNING *
          `,
          [
            citation,
            caalPermalink,
            doi,
            zoteroUri,
            externalUri,
            String(req.session.workbenchSession?.user?.username || "")
          ]
        );

        reference = insertResult.rows[0];
      }

      const duplicateLink = await client.query(
        `
        SELECT link_id
        FROM public.concept_bibliographic_links
        WHERE vocabulary_code = $1
          AND concept_id = $2
          AND reference_id = $3
        LIMIT 1
        `,
        [VOCABULARY_CODE, conceptId, reference.reference_id]
      );

      if (duplicateLink.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "That bibliographic reference is already linked to this concept"
        });
      }

      const linkResult = await client.query(
        `
        INSERT INTO public.concept_bibliographic_links
          (
            vocabulary_code,
            concept_id,
            reference_id,
            relation_type,
            note,
            created_by_username,
            updated_by_username
          )
        VALUES
          ($1, $2, $3, $4, NULLIF($5, ''), $6, $6)
        RETURNING *
        `,
        [
          VOCABULARY_CODE,
          conceptId,
          reference.reference_id,
          relationType,
          linkNote,
          String(req.session.workbenchSession?.user?.username || "")
        ]
      );

      const link = linkResult.rows[0];

      await writeRevision(client, {
        conceptId,
        entityType: "bibliographic_reference",
        entityId: link.link_id,
        action: "insert",
        lang: "und",
        oldData: null,
        newData: {
          link,
          reference
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        bibliography: {
          ...reference,
          ...link,
          doi_url: doiUrl(reference.doi)
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to add bibliographic reference:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to add bibliographic reference",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: error.message }
          : {})
      });
    } finally {
      client.release();
    }
  }
);

router.put(
  "/site-types/concepts/:conceptId/bibliography/:linkId",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const linkId = clean(req.params.linkId);

    const citation = clean(req.body?.citation);
    const caalPermalink = clean(req.body?.caal_permalink);
    const doi = normaliseDoi(req.body?.doi);
    const zoteroUri = clean(req.body?.zotero_uri);
    const externalUri = clean(req.body?.external_uri);
    const relationType = clean(req.body?.relation_type) || "source";
    const linkNote = clean(req.body?.note);

    if (!validBibliographyRelation(relationType)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported bibliography relationship"
      });
    }

    if (!citation && !caalPermalink && !doi && !zoteroUri && !externalUri) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter a citation or at least one bibliography/DOI/Zotero/URI link"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
        SELECT
          l.*,
          r.citation,
          r.caal_permalink,
          r.doi,
          r.zotero_uri,
          r.external_uri
        FROM public.concept_bibliographic_links l
        JOIN public.vocabulary_bibliographic_resources r
          ON r.reference_id = l.reference_id
        WHERE l.vocabulary_code = $1
          AND l.concept_id = $2
          AND l.link_id = $3
        FOR UPDATE OF l, r
        `,
        [VOCABULARY_CODE, conceptId, linkId]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Bibliographic reference link not found"
        });
      }

      const oldData = existingResult.rows[0];

      const duplicateIdentity = await client.query(
        `
        SELECT reference_id
        FROM public.vocabulary_bibliographic_resources
        WHERE reference_id <> $1
          AND (
            ($2 <> '' AND lower(COALESCE(caal_permalink, '')) = lower($2))
            OR ($3 <> '' AND lower(COALESCE(doi, '')) = lower($3))
            OR ($4 <> '' AND lower(COALESCE(zotero_uri, '')) = lower($4))
            OR ($5 <> '' AND lower(COALESCE(external_uri, '')) = lower($5))
          )
        ORDER BY reference_id
        LIMIT 1
        `,
        [
          oldData.reference_id,
          caalPermalink,
          doi,
          zoteroUri,
          externalUri
        ]
      );

      if (duplicateIdentity.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Another bibliographic resource already uses one of those identifiers"
        });
      }

      const username = String(
        req.session.workbenchSession?.user?.username || ""
      );

      const referenceResult = await client.query(
        `
        UPDATE public.vocabulary_bibliographic_resources
        SET
          citation = NULLIF($2, ''),
          caal_permalink = NULLIF($3, ''),
          doi = NULLIF($4, ''),
          zotero_uri = NULLIF($5, ''),
          external_uri = NULLIF($6, ''),
          updated_by_username = $7,
          updated_at = now()
        WHERE reference_id = $1
        RETURNING *
        `,
        [
          oldData.reference_id,
          citation,
          caalPermalink,
          doi,
          zoteroUri,
          externalUri,
          username
        ]
      );

      const linkResult = await client.query(
        `
        UPDATE public.concept_bibliographic_links
        SET
          relation_type = $2,
          note = NULLIF($3, ''),
          updated_by_username = $4,
          updated_at = now()
        WHERE link_id = $1
        RETURNING *
        `,
        [
          linkId,
          relationType,
          linkNote,
          username
        ]
      );

      const reference = referenceResult.rows[0];
      const link = linkResult.rows[0];

      await writeRevision(client, {
        conceptId,
        entityType: "bibliographic_reference",
        entityId: linkId,
        action: "update",
        lang: "und",
        oldData,
        newData: {
          link,
          reference
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        bibliography: {
          ...reference,
          ...link,
          doi_url: doiUrl(reference.doi)
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to update bibliographic reference:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to update bibliographic reference",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: error.message }
          : {})
      });
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/site-types/concepts/:conceptId/bibliography/:linkId",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const linkId = clean(req.params.linkId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
        SELECT
          l.*,
          r.citation,
          r.caal_permalink,
          r.doi,
          r.zotero_uri,
          r.external_uri
        FROM public.concept_bibliographic_links l
        JOIN public.vocabulary_bibliographic_resources r
          ON r.reference_id = l.reference_id
        WHERE l.vocabulary_code = $1
          AND l.concept_id = $2
          AND l.link_id = $3
        FOR UPDATE
        `,
        [VOCABULARY_CODE, conceptId, linkId]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          deleted: false
        });
      }

      const oldData = existingResult.rows[0];

      await client.query(
        `
        DELETE FROM public.concept_bibliographic_links
        WHERE link_id = $1
        `,
        [linkId]
      );

      const remainingLinks = await client.query(
        `
        SELECT count(*)::int AS count
        FROM public.concept_bibliographic_links
        WHERE reference_id = $1
        `,
        [oldData.reference_id]
      );

      if (remainingLinks.rows[0].count === 0) {
        await client.query(
          `
          DELETE FROM public.vocabulary_bibliographic_resources
          WHERE reference_id = $1
          `,
          [oldData.reference_id]
        );
      }

      await writeRevision(client, {
        conceptId,
        entityType: "bibliographic_reference",
        entityId: linkId,
        action: "delete",
        lang: "und",
        oldData,
        newData: {
          deleted: true,
          link_id: linkId,
          reference_id: oldData.reference_id
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to remove bibliographic reference:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to remove bibliographic reference"
      });
    } finally {
      client.release();
    }
  }
);


async function createAlternativeLabel(req, res, conceptId, lang, label) {
  if (!validLanguage(lang)) {
    return res.status(400).json({
      ok: false,
      error: "Unsupported language"
    });
  }

  if (!label) {
    return res.status(400).json({
      ok: false,
      error: "Alternative label cannot be empty"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const conceptResult = await client.query(
      `
      SELECT concept_id, level, en_label
      FROM public.concepts_curated
      WHERE concept_id = $1
      FOR UPDATE
      `,
      [conceptId]
    );

    if (conceptResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "Concept not found"
      });
    }

    const duplicateResult = await client.query(
      `
      SELECT label_id, label, status
      FROM public.labels_curated
      WHERE concept_id = $1
        AND lang = $2
        AND label = $3
      LIMIT 1
      `,
      [conceptId, lang, label]
    );

    if (duplicateResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error: "That label already exists for this concept and language"
      });
    }

    const labelId = await nextNumericLabelId(client);
    const concept = conceptResult.rows[0];

    const insertResult = await client.query(
      `
      INSERT INTO public.labels_curated
        (
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        )
      VALUES
        ($1, $2, $3, $4, 'alt', 'workbench', $5, $6, $7, NULL)
      RETURNING
        label_id,
        concept_id,
        lang,
        label,
        status,
        source,
        norm_key,
        level,
        en_label,
        disambiguation
      `,
      [
        labelId,
        conceptId,
        lang,
        label,
        normaliseKey(label),
        concept.level,
        concept.en_label
      ]
    );

    const inserted = insertResult.rows[0];

    await writeRevision(client, {
      conceptId,
      entityType: "label",
      entityId: inserted.label_id,
      action: "insert",
      lang,
      oldData: null,
      newData: inserted,
      session: req.session.workbenchSession
    });

    await client.query("COMMIT");

    return res.json({
      ok: true,
      label: inserted
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to add alternative label:", error);

    return res.status(500).json({
      ok: false,
      error: "Failed to add alternative label",
      ...(process.env.NODE_ENV !== "production"
        ? { detail: error.message }
        : {})
    });
  } finally {
    client.release();
  }
}

router.post(
  "/site-types/concepts/:conceptId/alternative-labels",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.body?.lang).toLowerCase();
    const label = clean(req.body?.label);

    return createAlternativeLabel(req, res, conceptId, lang, label);
  }
);

router.post(
  "/site-types/concepts/:conceptId/labels/:lang/alternatives",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const lang = clean(req.params.lang).toLowerCase();
    const label = clean(req.body?.label);

    return createAlternativeLabel(req, res, conceptId, lang, label);
  }
);


router.put(
  "/site-types/concepts/:conceptId/alternative-labels/:labelId",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const labelId = clean(req.params.labelId);
    const label = clean(req.body?.label);
    const lang = clean(req.body?.lang).toLowerCase();

    if (!validLanguage(lang)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported language"
      });
    }

    if (!label) {
      return res.status(400).json({
        ok: false,
        error: "Label cannot be empty"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND label_id = $2
        FOR UPDATE
        `,
        [conceptId, labelId]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Label not found"
        });
      }

      const oldData = existingResult.rows[0];

      if (String(oldData.status || "").toLowerCase() === "preferred") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Use the preferred-label editor for a preferred label. " +
            "This route edits alternative labels only."
        });
      }

      const duplicateResult = await client.query(
        `
        SELECT label_id
        FROM public.labels_curated
        WHERE concept_id = $1
          AND lang = $2
          AND label = $3
          AND label_id <> $4
        LIMIT 1
        `,
        [conceptId, lang, label, labelId]
      );

      if (duplicateResult.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "That label already exists for this concept and language"
        });
      }

      const updateResult = await client.query(
        `
        UPDATE public.labels_curated
        SET
          lang = $1,
          label = $2,
          norm_key = $3
        WHERE label_id = $4
        RETURNING
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        `,
        [lang, label, normaliseKey(label), labelId]
      );

      const updated = updateResult.rows[0];

      await writeRevision(client, {
        conceptId,
        entityType: "label",
        entityId: labelId,
        action: "update",
        lang,
        oldData,
        newData: updated,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        label: updated
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to edit alternative label:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to edit alternative label"
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/site-types/concepts/:conceptId/labels/:labelId/promote",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const labelId = clean(req.params.labelId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const targetResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND label_id = $2
        FOR UPDATE
        `,
        [conceptId, labelId]
      );

      if (targetResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Label not found"
        });
      }

      const target = targetResult.rows[0];
      const lang = clean(target.lang).toLowerCase();

      if (!validLanguage(lang)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error:
            "This label must first be assigned to one of the 8 CAAL languages"
        });
      }

      if (String(target.status || "").toLowerCase() === "preferred") {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          label: target
        });
      }

      const preferredResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND lang = $2
          AND lower(COALESCE(status, '')) = 'preferred'
        FOR UPDATE
        `,
        [conceptId, lang]
      );

      if (preferredResult.rows.length > 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "Multiple preferred labels already exist for this concept/language"
        });
      }

      if (preferredResult.rows.length === 1) {
        const previousPreferred = preferredResult.rows[0];

        const demoteResult = await client.query(
          `
          UPDATE public.labels_curated
          SET status = 'alt'
          WHERE label_id = $1
          RETURNING
            label_id,
            concept_id,
            lang,
            label,
            status,
            source,
            norm_key,
            level,
            en_label,
            disambiguation
          `,
          [previousPreferred.label_id]
        );

        await writeRevision(client, {
          conceptId,
          entityType: "label",
          entityId: previousPreferred.label_id,
          action: "demote",
          lang,
          oldData: previousPreferred,
          newData: demoteResult.rows[0],
          session: req.session.workbenchSession
        });
      }

      const promoteResult = await client.query(
        `
        UPDATE public.labels_curated
        SET status = 'preferred'
        WHERE label_id = $1
        RETURNING
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        `,
        [labelId]
      );

      const promoted = promoteResult.rows[0];

      if (lang === "en") {
        await syncEnglishCompatibilityFields(
          client,
          conceptId,
          promoted.label
        );
      }

      await writeRevision(client, {
        conceptId,
        entityType: "label",
        entityId: labelId,
        action: "promote",
        lang,
        oldData: target,
        newData: promoted,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        label: promoted
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to promote label:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to promote label"
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/site-types/concepts/:conceptId/labels/:labelId/demote",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const labelId = clean(req.params.labelId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const targetResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND label_id = $2
        FOR UPDATE
        `,
        [conceptId, labelId]
      );

      if (targetResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Label not found"
        });
      }

      const target = targetResult.rows[0];
      const lang = clean(target.lang).toLowerCase();

      if (String(target.status || "").toLowerCase() !== "preferred") {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          label: target
        });
      }

      const demoteResult = await client.query(
        `
        UPDATE public.labels_curated
        SET status = 'alt'
        WHERE label_id = $1
        RETURNING
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        `,
        [labelId]
      );

      const demoted = demoteResult.rows[0];

      if (lang === "en") {
        await syncEnglishCompatibilityFields(client, conceptId, null);
      }

      await writeRevision(client, {
        conceptId,
        entityType: "label",
        entityId: labelId,
        action: "demote",
        lang,
        oldData: target,
        newData: demoted,
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        label: demoted
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to demote label:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to demote label"
      });
    } finally {
      client.release();
    }
  }
);


router.delete(
  "/site-types/concepts/:conceptId/alternative-labels/:labelId",
  async (req, res) => {
    const conceptId = clean(req.params.conceptId);
    const labelId = clean(req.params.labelId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
        SELECT
          label_id,
          concept_id,
          lang,
          label,
          status,
          source,
          norm_key,
          level,
          en_label,
          disambiguation
        FROM public.labels_curated
        WHERE concept_id = $1
          AND label_id = $2
        FOR UPDATE
        `,
        [conceptId, labelId]
      );

      if (existingResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          unchanged: true,
          deleted: false
        });
      }

      const oldData = existingResult.rows[0];

      if (String(oldData.status || "").toLowerCase() === "preferred") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error:
            "This is a preferred label. Make it alternative before deleting it."
        });
      }

      await client.query(
        `
        DELETE FROM public.labels_curated
        WHERE label_id = $1
        `,
        [labelId]
      );

      await writeRevision(client, {
        conceptId,
        entityType: "label",
        entityId: labelId,
        action: "delete",
        lang: oldData.lang,
        oldData,
        newData: {
          deleted: true,
          concept_id: conceptId,
          label_id: labelId,
          lang: oldData.lang,
          label: oldData.label,
          status: oldData.status
        },
        session: req.session.workbenchSession
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to delete alternative label:", error);

      return res.status(500).json({
        ok: false,
        error: "Failed to delete alternative label",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: error.message }
          : {})
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
