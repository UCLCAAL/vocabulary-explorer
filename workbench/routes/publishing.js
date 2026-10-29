const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const pool = require("../db");
const requireLevel9 = require("../middleware/requireLevel9");

const router = express.Router();
const execFileAsync = promisify(execFile);

const VOCABULARY_CODE = "site-types";
const GRAPH_URI =
  process.env.SITE_TYPES_GRAPH_URI ||
  "https://vocab.uclcaal.org/graph/monument-types";

const FUSEKI_DATA_URL =
  process.env.FUSEKI_DATA_URL ||
  "http://localhost:9030/skosmos/data";

const REPO_ROOT =
  process.env.VOCAB_REPO_ROOT ||
  path.resolve(__dirname, "..", "..");

const EXPORTER_PATH =
  process.env.SITE_TYPES_EXPORTER_PATH ||
  path.join(REPO_ROOT, "scripts", "export_site_types_from_db.py");

const OUTPUT_PATH =
  process.env.SITE_TYPES_OUTPUT_PATH ||
  path.join(
    REPO_ROOT,
    "data",
    "generated",
    "site-types-curated.rdf"
  );

const SUMMARY_PATH =
  process.env.SITE_TYPES_SUMMARY_PATH ||
  path.join(
    REPO_ROOT,
    "data",
    "generated",
    "site-types-curated-summary.json"
  );

const AAT_GRAPH_URI = process.env.AAT_REFERENCE_GRAPH_URI || "https://vocab.uclcaal.org/graph/aat-reference";
const AAT_OUTPUT_PATH = path.join(REPO_ROOT, "data", "generated", "aat-accepted-reference.rdf");

const BACKUP_DIR =
  process.env.SITE_TYPES_BACKUP_DIR ||
  path.join(
    REPO_ROOT,
    "data",
    "generated",
    "backups"
  );

const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");

const RESTART_SERVICES =
  String(
    process.env.PUBLISH_RESTART_SERVICES ?? "true"
  ).toLowerCase() !== "false";

router.use(requireLevel9);

function truncateLog(value, max = 100000) {
  const text = String(value || "");

  if (text.length <= max) {
    return text;
  }

  return text.slice(0, max) + "\n...[truncated]";
}

function graphStoreUrl(graphUri = GRAPH_URI) {
  const url = new URL(FUSEKI_DATA_URL);
  url.searchParams.set("graph", graphUri);
  return url.toString();
}

function timestampForFile() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

async function ensureReadableFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function restartDisplayServices() {
  if (!RESTART_SERVICES) {
    return "Service restart disabled by configuration.";
  }

  const result = await execFileAsync(
    process.env.DOCKER_BIN || "docker",
    [
      "compose",
      "restart",
      "fuseki-cache",
      "skosmos"
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return [
    result.stdout,
    result.stderr
  ].filter(Boolean).join("\n");
}

async function backupCurrentGraph(graphUri = GRAPH_URI, tag = "site-types") {
  await fs.mkdir(BACKUP_DIR, {
    recursive: true
  });

  const response = await fetch(
    graphStoreUrl(graphUri),
    {
      method: "GET",
      headers: {
        Accept: "application/rdf+xml"
      }
    }
  );

  if (!response.ok && !(response.status === 404 && graphUri === AAT_GRAPH_URI)) {
    const detail = await response.text();

    throw new Error(
      `Could not back up current Fuseki graph ` +
      `(${response.status}): ${detail}`
    );
  }

  const content = response.status === 404
    ? Buffer.from('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>')
    : Buffer.from(await response.arrayBuffer());

  const backupPath = path.join(
    BACKUP_DIR,
    `${tag}-before-${timestampForFile()}.rdf`
  );

  await fs.writeFile(
    backupPath,
    graphUri,
    content
  );

  return {
    backupPath,
    content
  };
}

async function putGraph(rdfBuffer, graphUri = GRAPH_URI) {
  const response = await fetch(
    graphStoreUrl(graphUri),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/rdf+xml"
      },
      body: rdfBuffer
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Fuseki vocabulary PUT failed ` +
      `(${response.status}): ${detail}`
    );
  }

  return `Graph ${graphUri} PUT: ${response.status}`;
}

async function restoreBackup(backup, restart = true) {
  if (!backup?.content) {
    return "No backup available for rollback.";
  }

  const response = await fetch(
    graphStoreUrl(backup.graphUri),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/rdf+xml"
      },
      body: backup.content
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Rollback PUT failed ` +
      `(${response.status}): ${detail}`
    );
  }

  let restartLog = "";

  try {
    restartLog = restart ? await restartDisplayServices() : "";
  } catch (error) {
    restartLog =
      `Rollback restored graph, but service restart failed: ` +
      error.message;
  }

  return [
    "Previous Fuseki graph restored from backup.",
    restartLog
  ].filter(Boolean).join("\n");
}

router.get("/site-types/status", async (req, res) => {
  try {
    const latest = await pool.query(
      `
      SELECT
        publication_run_id,
        status,
        requested_by_username,
        started_at,
        finished_at,
        graph_uri,
        generated_summary,
        error
      FROM vocab_workbench.publication_runs
      WHERE vocabulary_code = $1
      ORDER BY started_at DESC, publication_run_id DESC
      LIMIT 10
      `,
      [VOCABULARY_CODE]
    );

    const latestSuccess = await pool.query(
      `
      SELECT
        publication_run_id,
        finished_at,
        started_at
      FROM vocab_workbench.publication_runs
      WHERE vocabulary_code = $1
        AND status = 'succeeded'
      ORDER BY finished_at DESC NULLS LAST,
               publication_run_id DESC
      LIMIT 1
      `,
      [VOCABULARY_CODE]
    );

    let unpublishedChanges = null;
    let lastEditAt = null;

    if (latestSuccess.rows.length === 1) {
      const since = latestSuccess.rows[0].started_at;

      const changes = await pool.query(
        `
        SELECT
          count(*)::int AS change_count,
          max(changed_at) AS last_edit_at
        FROM (
          SELECT changed_at FROM vocab_workbench.concept_revisions WHERE vocabulary_code=$1
          UNION ALL SELECT changed_at FROM vocab_workbench.editor_revisions WHERE vocabulary_code=$1
          UNION ALL
          SELECT changed_at FROM vocab_workbench.site_type_alignment_events
          WHERE action IN ('accept','deprecate','import')
        ) changes WHERE changed_at > $2
        `,
        [VOCABULARY_CODE, since]
      );

      unpublishedChanges =
        changes.rows[0].change_count;

      lastEditAt =
        changes.rows[0].last_edit_at;
    }

    const dataCounts = await pool.query(
      `
      SELECT
        (
          SELECT count(*)::int
          FROM public.concepts_curated
          WHERE sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS concepts,

        (
          SELECT count(*)::int
          FROM public.labels_curated l
          JOIN public.concepts_curated c
            ON c.concept_id = l.concept_id
          WHERE lower(COALESCE(l.status, '')) = 'preferred'
            AND c.sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(c.is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS preferred_labels,

        (
          SELECT count(*)::int
          FROM public.labels_curated l
          JOIN public.concepts_curated c
            ON c.concept_id = l.concept_id
          WHERE lower(COALESCE(l.status, '')) = 'alt'
            AND l.lang = ANY($2::text[])
            AND c.sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(c.is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS alternative_labels,

        (
          SELECT count(*)::int
          FROM public.concept_notes_curated n
          JOIN public.concepts_curated c
            ON c.concept_id = n.concept_id
          WHERE lower(COALESCE(n.note_type, '')) = 'definition'
            AND c.sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(c.is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS definitions,

        (
          SELECT count(*)::int
          FROM public.concept_notes_curated n
          JOIN public.concepts_curated c
            ON c.concept_id = n.concept_id
          WHERE lower(COALESCE(n.note_type, '')) = 'scopenote'
            AND c.sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(c.is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS scope_notes,

        (
          SELECT count(*)::int
          FROM public.concept_bibliographic_links b
          JOIN public.concepts_curated c
            ON c.concept_id = b.concept_id
          WHERE b.vocabulary_code = $1
            AND c.sort_order IS NOT NULL
            AND lower(
                  COALESCE(
                    NULLIF(btrim(c.is_active), ''),
                    'true'
                  )
                ) NOT IN ('false', '0', 'no', 'inactive')
        ) AS bibliography_links,
        (SELECT count(*)::int FROM vocab_workbench.site_type_alignments
         WHERE vocabulary_code=$1 AND status='accepted') AS accepted_alignments
      `,
      [
        VOCABULARY_CODE,
        ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]
      ]
    );

    return res.json({
      ok: true,
      graph_uri: GRAPH_URI,
      fuseki_data_url: FUSEKI_DATA_URL,
      latest_runs: latest.rows,
      latest_success:
        latestSuccess.rows[0] || null,
      unpublished_changes: unpublishedChanges,
      last_edit_at: lastEditAt,
      current_data: dataCounts.rows[0]
    });
  } catch (error) {
    console.error(
      "Failed to load publishing status:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to load publishing status"
    });
  }
});

router.post("/site-types/publish", async (req, res) => {
  if (req.body?.confirm !== "PUBLISH_SITE_TYPES") {
    return res.status(400).json({
      ok: false,
      error: "Publication confirmation was not supplied"
    });
  }

  const lockClient = await pool.connect();

  let runId = null;
  let backup = null;
  let graphWasReplaced = false;
  let referenceBackup = null;
  let referenceWasReplaced = false;

  const publishLog = [];

  try {
    if (GRAPH_URI === AAT_GRAPH_URI || path.resolve(OUTPUT_PATH) === path.resolve(AAT_OUTPUT_PATH)) {
      throw new Error("The vocabulary and AAT reference graphs must use distinct graph URIs and output files.");
    }
    const lockResult = await lockClient.query(
      `
      SELECT pg_try_advisory_lock(
        hashtext('caal-vocabulary-publish-site-types')
      ) AS locked
      `
    );

    if (!lockResult.rows[0].locked) {
      return res.status(409).json({
        ok: false,
        error: "A Site Types publication is already running"
      });
    }

    const runResult = await lockClient.query(
      `
      INSERT INTO vocab_workbench.publication_runs
        (
          vocabulary_code,
          status,
          requested_by_user_id,
          requested_by_username,
          graph_uri
        )
      VALUES
        ($1, 'running', $2, $3, $4)
      RETURNING publication_run_id
      `,
      [
        VOCABULARY_CODE,
        req.session.workbenchSession?.user?.user_id == null
          ? null
          : String(
              req.session.workbenchSession.user.user_id
            ),
        String(
          req.session.workbenchSession?.user?.username || ""
        ),
        GRAPH_URI
      ]
    );

    runId = runResult.rows[0].publication_run_id;

    await ensureReadableFile(
      EXPORTER_PATH,
      "Site Types exporter"
    );

    await fs.mkdir(
      path.dirname(OUTPUT_PATH),
      { recursive: true }
    );

    const exporterResult = await execFileAsync(
      PYTHON_BIN,
      [
        EXPORTER_PATH,
        "--mode",
        "curated",
        "--output",
        OUTPUT_PATH,
        "--summary-json",
        SUMMARY_PATH,
        "--alignment-reference-output",
        AAT_OUTPUT_PATH
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      }
    );

    const exporterLog = [
      exporterResult.stdout,
      exporterResult.stderr
    ].filter(Boolean).join("\n");

    publishLog.push("RDF generation completed.");

    const summary = JSON.parse(
      await fs.readFile(
        SUMMARY_PATH,
        "utf8"
      )
    );

    if (!summary.triples || summary.triples < 1) {
      throw new Error(
        "Generated RDF summary reported zero triples"
      );
    }

    const rdf = await fs.readFile(
      OUTPUT_PATH
    );

    const referenceRdf = await fs.readFile(AAT_OUTPUT_PATH);

    backup = await backupCurrentGraph();
    referenceBackup = await backupCurrentGraph(AAT_GRAPH_URI, "aat-reference");

    publishLog.push(
      `Current graph backed up to ${backup.backupPath}`
    );

    graphWasReplaced = true;
    publishLog.push(await putGraph(rdf));
    referenceWasReplaced = true;
    publishLog.push(await putGraph(referenceRdf, AAT_GRAPH_URI));

    publishLog.push(
      await restartDisplayServices()
    );

    await lockClient.query(
      `
      UPDATE vocab_workbench.publication_runs
      SET
        status = 'succeeded',
        finished_at = now(),
        output_file = $2,
        backup_file = $3,
        generated_summary = $4::jsonb,
        exporter_log = $5,
        publish_log = $6,
        error = NULL
      WHERE publication_run_id = $1
      `,
      [
        runId,
        OUTPUT_PATH,
        backup.backupPath,
        JSON.stringify(summary),
        truncateLog(exporterLog),
        truncateLog(
          publishLog.filter(Boolean).join("\n")
        )
      ]
    );

    return res.json({
      ok: true,
      publication_run_id: runId,
      summary,
      graph_uri: GRAPH_URI,
      backup_file: backup.backupPath,
      message:
        "Site Types published successfully. " +
        "Vocabulary RDF and accepted alignments were published, " +
        "and display services were refreshed."
    });
  } catch (error) {
    let rollbackLog = "";

    const rollbackMessages = [];
    for (const [changed, saved] of [[referenceWasReplaced, referenceBackup], [graphWasReplaced, backup]]) {
      if (!changed || !saved) continue;
      try { rollbackMessages.push(await restoreBackup(saved, false)); }
      catch (rollbackError) { rollbackMessages.push(`ROLLBACK FAILED for ${saved.graphUri}: ${rollbackError.message}`); }
    }
    if (graphWasReplaced || referenceWasReplaced) {
      try { rollbackMessages.push(await restartDisplayServices()); }
      catch (restartError) { rollbackMessages.push(`Display refresh after rollback failed: ${restartError.message}`); }
    }
    rollbackLog = rollbackMessages.filter(Boolean).join("\n");
    if (rollbackLog) publishLog.push(rollbackLog);

    if (runId) {
      try {
        await lockClient.query(
          `
          UPDATE vocab_workbench.publication_runs
          SET
            status = 'failed',
            finished_at = now(),
            output_file = $2,
            backup_file = $3,
            publish_log = $4,
            error = $5
          WHERE publication_run_id = $1
          `,
          [
            runId,
            OUTPUT_PATH,
            backup?.backupPath || null,
            truncateLog(
              publishLog.filter(Boolean).join("\n")
            ),
            truncateLog(error.message)
          ]
        );
      } catch (dbError) {
        console.error(
          "Could not record failed publication:",
          dbError
        );
      }
    }

    console.error(
      "Site Types publication failed:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Site Types publication failed",
      detail: [
        error.message,
        rollbackLog
      ].filter(Boolean).join(" | ")
    });
  } finally {
    try {
      await lockClient.query(
        `
        SELECT pg_advisory_unlock(
          hashtext('caal-vocabulary-publish-site-types')
        )
        `
      );
    } catch {
      // Connection release will also release the advisory lock.
    }

    lockClient.release();
  }
});

module.exports = router;
