const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PREFIXES = `
PREFIX aat: <http://vocab.getty.edu/aat/>
PREFIX gvp: <http://vocab.getty.edu/ontology#>
PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX luc: <http://www.ontotext.com/owlim/lucene#>
`;
const ENDPOINT = "https://vocab.getty.edu/sparql.json";
const MAX_BYTES = 2 * 1024 * 1024;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function error(message, status = 502) { const e = new Error(message); e.status = status; return e; }

function aatUri(value) {
  const match = String(value || "").trim().match(/^(?:https?:\/\/vocab\.getty\.edu\/(?:page\/)?aat\/)?([0-9]{9})$/);
  if (!match) throw error("Enter a nine-digit Getty AAT ID or AAT record URL.", 400);
  return `http://vocab.getty.edu/aat/${match[1]}`;
}
function searchQuery(value) {
  const text = String(value || "").normalize("NFKC").trim();
  const tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (text.length > 120 || tokens.length > 8 || Array.from(tokens.join("")).length < 2) {
    throw error("Enter at least two letters, or an AAT ID. Use a shorter search if necessary.", 400);
  }
  // User input cannot introduce SPARQL syntax or Lucene operators.
  const lucene = tokens.map(token => `${token}*`).join(" AND ");
  return `${PREFIXES}
SELECT DISTINCT ?uri ?label ?parents WHERE {
  ?uri luc:term ${JSON.stringify(lucene)} ; skos:inScheme aat: ; gvp:prefLabelGVP/xl:literalForm ?label .
  OPTIONAL { ?uri gvp:parentStringAbbrev ?parents }
} ORDER BY DESC(LCASE(STR(?label)) = LCASE(${JSON.stringify(text)})) LCASE(STR(?label)) STR(?uri) LIMIT 21`;
}
function detailQuery(uri) {
  uri = aatUri(uri);
  return `${PREFIXES}
SELECT DISTINCT ?kind ?value ?ref ?language WHERE {
  VALUES ?subject { <${uri}> }
  ?subject skos:inScheme aat: .
  { ?subject gvp:prefLabelGVP/xl:literalForm ?value . BIND("preferred" AS ?kind) }
  UNION { ?subject (skos:prefLabel|skos:altLabel|xl:prefLabel/xl:literalForm|xl:altLabel/xl:literalForm) ?value . BIND("label" AS ?kind) }
  UNION { ?subject skos:scopeNote ?note . ?note (rdf:value|xl:literalForm) ?value .
          OPTIONAL { ?note dct:language ?language } BIND("definition" AS ?kind) }
  UNION { ?subject skos:scopeNote ?value . FILTER(isLiteral(?value)) BIND("definition" AS ?kind) }
  UNION { ?subject gvp:parentStringAbbrev ?value . BIND("parents" AS ?kind) }
  UNION { ?subject gvp:broaderPreferred ?ref . ?ref gvp:prefLabelGVP/xl:literalForm ?value . BIND("parent" AS ?kind) }
  UNION { ?subject owl:deprecated ?value . BIND("deprecated" AS ?kind) }
} ORDER BY DESC(?kind = "preferred") ?kind ?value LIMIT 300`;
}

function xmlResults(text) {
  return new Promise((resolve, reject) => {
    const helper = path.join(process.env.VOCAB_REPO_ROOT || path.resolve(__dirname, "..", ".."), "scripts", "parse_sparql_results.py");
    const child = spawn(process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"), [helper], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(error("Getty XML response parsing timed out.")); }, 5000);
    let out = "", err = "";
    child.on("error", () => { clearTimeout(timer); reject(error("Could not parse Getty XML. Check PYTHON_BIN and the installed parser script.")); });
    child.stdout.on("data", chunk => { out += chunk; if (Buffer.byteLength(out) > MAX_BYTES * 3) child.kill(); });
    child.stderr.on("data", chunk => { if (err.length < 2000) err += chunk; });
    child.stdin.on("error", () => {});
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(error("Getty returned an invalid SPARQL XML response."));
      try { resolve(JSON.parse(out)); } catch { reject(error("Could not decode the Getty response.")); }
    });
    child.stdin.end(text);
  });
}
async function parseResults(text) {
  let document;
  try {
    document = text.trimStart().startsWith("<") ? await xmlResults(text) : JSON.parse(text);
  } catch (e) { if (e.status) throw e; throw error("Getty returned an unreadable response."); }
  if (!Array.isArray(document?.results?.bindings)) throw error("Getty did not return SPARQL search results.");
  for (const row of document.results.bindings) {
    if (!row || typeof row !== "object" || Object.values(row).some(v => !v || typeof v.value !== "string")) throw error("Getty returned malformed result bindings.");
  }
  return document.results.bindings;
}
function request(query) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    url.searchParams.set("query", query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const req = https.get(url, {
      family: 4, // Use the IPv4 address Getty has approved for this droplet.
      signal: controller.signal,
      headers: { Accept: "application/sparql-results+json, application/sparql-results+xml;q=0.9", "User-Agent": "CAAL-Vocabulary-Workbench/1.0 (https://vocab.uclcaal.org/)" }
    }, async res => {
      try {
        let bytes = 0; const chunks = [];
        for await (const chunk of res) {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { res.destroy(); throw error("Getty returned too much data. Narrow the search."); }
          chunks.push(chunk);
        }
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") });
      } catch (e) { reject(e); }
      finally { clearTimeout(timer); }
    });
    req.on("error", e => { clearTimeout(timer); reject(error(e.name === "AbortError" ? "Getty search timed out. Try a more specific term." : "Could not connect to Getty from the Workbench server.", 503)); });
  });
}

function candidate(rows, uri, fetchedAt) {
  const get = (r, name) => r[name]?.value || "";
  const preferred = rows.find(r => get(r, "kind") === "preferred");
  if (!preferred) throw error("That ID was not found as an AAT concept.", 404);
  const lang = r => {
    const value = r.value?.["xml:lang"] || get(r, "language").split("/").pop() || "";
    return /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value) ? value : "";
  };
  const distinct = items => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  return {
    uri, id: uri.split("/").pop(), label: get(preferred, "value"), language: lang(preferred),
    labels: distinct(rows.filter(r => ["preferred","label"].includes(get(r,"kind"))).map(r => ({label:get(r,"value"),language:lang(r)}))).slice(0,100),
    definitions: distinct(rows.filter(r => get(r,"kind")==="definition").map(r => ({text:get(r,"value"),language:lang(r)}))).slice(0,20),
    parents: distinct(rows.filter(r => get(r,"kind")==="parent").map(r => ({uri:get(r,"ref"),label:get(r,"value")}))).slice(0,10),
    parent_string: rows.find(r => get(r,"kind")==="parents")?.value?.value || "",
    deprecated: rows.some(r => get(r,"kind")==="deprecated" && ["true","1"].includes(get(r,"value"))), fetched_at:fetchedAt
  };
}
function createGettyClient(pool, options = {}) {
  const transport = options.transport || request;
  const now = options.now || (() => Date.now());
  const wait = options.wait || delay;
  const interval = Math.max(250, Math.min(10000, Number(options.interval || process.env.GETTY_MIN_INTERVAL_MS) || 250));
  const cache = new Map(), pending = new Map();
  async function acquire() {
    const deadline = now() + 8000;
    while (now() < deadline) {
      const gate = await pool.query(`UPDATE vocab_workbench.getty_request_gate
        SET next_request_at=clock_timestamp()+($1::double precision * interval '1 millisecond')
        WHERE service='aat' AND next_request_at<=clock_timestamp() AND blocked_until<=clock_timestamp()
        RETURNING service`, [interval]);
      if (gate.rows.length) return;
      const blocked = await pool.query(`SELECT GREATEST(0,EXTRACT(EPOCH FROM (blocked_until-clock_timestamp()))) AS blocked_seconds
        FROM vocab_workbench.getty_request_gate WHERE service='aat'`);
      if (!blocked.rows.length) throw error("The Getty request gate is missing. Run migration 005.",503);
      if (Number(blocked.rows[0].blocked_seconds)>0) throw error("Getty has asked us to pause requests. Please try again later.",503);
      await wait(interval);
    }
    throw error("Getty search is busy. Please try again in a few seconds.",503);
  }
  async function query(key, sparql, ttl) {
    const hit = cache.get(key);
    if (hit && hit.expires>now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size>=20) throw error("Getty search is busy. Please try again shortly.",503);
    const operation = (async () => {
      await acquire();
      const response = await transport(sparql);
      if (response.status===429 || response.status===503) {
        const header = response.headers?.["retry-after"];
        const retry = Number.isFinite(Number(header)) ? Number(header)*1000 : Date.parse(header)-now();
        const pause = Math.max(60000,Math.min(3600000,retry || 60000));
        await pool.query(`UPDATE vocab_workbench.getty_request_gate SET blocked_until=GREATEST(blocked_until,clock_timestamp()+($1::double precision * interval '1 millisecond')) WHERE service='aat'`,[pause]);
        throw error("Getty is limiting requests or temporarily unavailable. Please try again later.",503);
      }
      if (response.status===403) throw error("Getty refused this server's request (403). Check that its outgoing IPv4 address is still approved.",502);
      if (response.status!==200) throw error(`Getty returned HTTP ${response.status}. Please try again later.`,502);
      const rows = await parseResults(response.text);
      const value = {rows, fetchedAt:new Date(now()).toISOString()};
      if (cache.size>=200) cache.delete(cache.keys().next().value);
      cache.set(key,{value,expires:now()+ttl});
      return value;
    })();
    pending.set(key,operation);
    try { return await operation; } finally { pending.delete(key); }
  }
  return {
    async search(text) {
      text = String(text || "").trim();
      if (/^(?:https?:\/\/vocab\.getty\.edu\/(?:page\/)?aat\/)?[0-9]{9}$/.test(text)) {
        const item = await this.detail(text);
        return {results:[item],has_more:false};
      }
      const sparql = searchQuery(text);
      const {rows,fetchedAt} = await query(`search:${sparql}`,sparql,10*60*1000);
      const seen = new Set();
      const items = rows.map(row => {
        let uri; try { uri=aatUri(row.uri?.value); } catch { return null; }
        if (!row.label?.value || seen.has(uri)) return null;
        seen.add(uri);
        return {uri,id:uri.split('/').pop(),label:row.label.value,language:row.label['xml:lang']||'',parent_string:row.parents?.value||'',fetched_at:fetchedAt};
      }).filter(Boolean);
      return {results:items.slice(0,20),has_more:items.length>20};
    },
    async detail(value) {
      const uri=aatUri(value);
      const {rows,fetchedAt}=await query(`detail:${uri}`,detailQuery(uri),60*60*1000);
      return candidate(rows,uri,fetchedAt);
    }
  };
}
module.exports={createGettyClient,aatUri,searchQuery,detailQuery,parseResults,candidate};
