const { Pool } = require("pg");
require("dotenv").config();

const connectionString =
  process.env.CAAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

if (!connectionString) {
  throw new Error("CAAL_DATABASE_URL or DATABASE_URL must be set");
}

const isLocal =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

module.exports = pool;
