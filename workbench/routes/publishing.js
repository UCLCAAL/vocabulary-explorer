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

const ALIGNMENT_PATH =
  process.env.SITE_TYPES_ALIGNMENT_PATH ||
  path.join(
    REPO_ROOT,
    "data",
    "alignments",
    "caal-aat-site-types.ttl"
  );

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

function graphStoreUrl() {
  const url = new URL(FUSEKI_DATA_URL);
  url.searchParams.set("graph", GRAPH_URI);
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

async function backupCurrentGraph() {
  await fs.mkdir(BACKUP_DIR, {
    recursive: true
  });

  const response = await fetch(
    graphStoreUrl(),
    {
      method: "GET",
      headers: {
        Accept: "application/rdf+xml"
      }
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Could not back up current Fuseki graph ` +
      `(${response.status}): ${detail}`
    );
  }

  const content = Buffer.from(
    await response.arrayBuffer()
  );

  const backupPath = path.join(
    BACKUP_DIR,
    `site-types-before-${timestampForFile()}.rdf`
  );

  await fs.writeFile(
    backupPath,
    content
  );

  return {
    backupPath,
    content
  };
}

async function putGraph(rdfBuffer) {
  const response = await fetch(
    graphStoreUrl(),
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

  return `Vocabulary graph PUT: ${response.status}`;
}

async function postAlignments(ttlBuffer) {
  const response = await fetch(
    graphStoreUrl(),
    {
      method: "POST",
      headers: {
        "Content-Type": "text/turtle"
      },
      body: ttlBuffer
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Fuseki alignment POST failed ` +
      `(${response.status}): ${detail}`
    );
  }

  return `Alignment graph POST: ${response.status}`;
}

async function restoreBackup(backup) {
  if (!backup?.content) {
    return "No backup available for rollback.";
  }

  const response = await fetch(
    graphStoreUrl(),
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
    restartLog = await restartDisplayServices();
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
        finished_at
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
      const since = latestSuccess.rows[0].finished_at;

      const changes = await pool.query(
        `
        SELECT
          count(*)::int AS change_count,
          max(changed_at) AS last_edit_at
        FROM vocab_workbench.concept_revisions
        WHERE vocabulary_code = $1
          AND changed_at > $2
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
        ) AS bibliography_links
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

  const publishLog = [];

  try {
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

    await ensureReadableFile(
      ALIGNMENT_PATH,
      "Site Types alignment file"
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
        SUMMARY_PATH
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

    const alignments = await fs.readFile(
      ALIGNMENT_PATH
    );

    backup = await backupCurrentGraph();

    publishLog.push(
      `Current graph backed up to ${backup.backupPath}`
    );

    publishLog.push(
      await putGraph(rdf)
    );

    graphWasReplaced = true;

    publishLog.push(
      await postAlignments(alignments)
    );

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
        "Vocabulary RDF was replaced, alignments were restored, " +
        "and display services were refreshed."
    });
  } catch (error) {
    let rollbackLog = "";

    if (graphWasReplaced && backup) {
      try {
        rollbackLog = await restoreBackup(
          backup
        );

        publishLog.push(rollbackLog);
      } catch (rollbackError) {
        rollbackLog =
          `ROLLBACK FAILED: ${rollbackError.message}`;

        publishLog.push(rollbackLog);
      }
    }

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
