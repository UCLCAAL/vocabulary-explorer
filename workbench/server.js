const path = require("path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const pgSession = require("connect-pg-simple")(session);
require("dotenv").config();

const pool = require("./db");
const authRoutes = require("./auth");
const vocabularyRoutes = require("./routes/vocabularies");
const publishingRoutes = require("./routes/publishing");

const app = express();
const PORT = Number(process.env.PORT || 3100);
const publicRoot = path.join(__dirname, "public");

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}

app.set("trust proxy", 1);
app.use(compression());
app.use(express.json());

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "vocabulary_workbench_sessions",
      createTableIfMissing: true
    }),
    name: "caal_vocab_workbench_sid",
    secret: process.env.SESSION_SECRET || "change-this-for-development",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 3 * 60 * 60 * 1000
    }
  })
);

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");
    return res.json({
      ok: true,
      message: "Vocabulary Workbench is running",
      db_time: result.rows[0].server_time
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Database connection failed"
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/vocabularies", vocabularyRoutes);
app.use("/api/publishing", publishingRoutes);

app.use(express.static(publicRoot));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicRoot, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vocabulary Workbench listening on port ${PORT}`);
});
