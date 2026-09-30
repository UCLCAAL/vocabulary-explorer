const express = require("express");
const pool = require("./db");

const router = express.Router();

router.post("/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({
      ok: false,
      error: "Username and password are required"
    });
  }

  try {
    const authResult = await pool.query(
      `
      SELECT
        au.user_id,
        au.username,
        au.must_reset_password,
        sp.access_level,
        sp.workspace_code,
        sp.preferred_language,
        sp.country,
        sp.workspace_label
      FROM public.app_users au
      JOIN public.v_app_user_session_profile sp
        ON sp.username = au.username
      WHERE lower(au.username) = lower($1)
        AND au.password_hash = crypt($2, au.password_hash)
        AND au.is_enabled = true
        AND sp.user_is_enabled = true
        AND sp.workspace_is_enabled = true
        AND sp.access_level = 9
      LIMIT 1
      `,
      [username, password]
    );

    if (authResult.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: "Invalid credentials or access level is not 9"
      });
    }

    const row = authResult.rows[0];

    req.session.workbenchSession = {
      user: {
        user_id: row.user_id,
        username: row.username,
        access_level: Number(row.access_level),
        workspace_code: row.workspace_code
      },
      profile: {
        preferred_language: row.preferred_language,
        country: row.country,
        workspace_label: row.workspace_label
      },
      permissions: {
        can_view_vocabularies: true,
        can_edit_vocabularies: true,
        can_edit_alignments: true,
        can_publish: true
      }
    };

    return res.json({
      ok: true,
      must_reset_password: !!row.must_reset_password,
      session: req.session.workbenchSession
    });
  } catch (error) {
    console.error("Workbench login failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Login failed"
    });
  }
});

router.get("/session", (req, res) => {
  const session = req.session?.workbenchSession || null;

  if (!session) {
    return res.status(401).json({
      ok: false,
      error: "No active workbench session"
    });
  }

  return res.json({
    ok: true,
    session
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        error: "Logout failed"
      });
    }

    res.clearCookie("caal_vocab_workbench_sid");
    return res.json({ ok: true });
  });
});

module.exports = router;
