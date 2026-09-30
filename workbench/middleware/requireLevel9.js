function requireLevel9(req, res, next) {
  const session = req.session?.workbenchSession;

  if (!session) {
    return res.status(401).json({
      ok: false,
      error: "No active workbench session"
    });
  }

  if (Number(session.user?.access_level) !== 9) {
    return res.status(403).json({
      ok: false,
      error: "Vocabulary Workbench requires access level 9"
    });
  }

  next();
}

module.exports = requireLevel9;
