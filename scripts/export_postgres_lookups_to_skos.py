#!/usr/bin/env python3
"""
export_postgres_lookups_to_skos.py

Generic CAAL PostgreSQL lookup -> SKOS exporter.

Exports selected ui.v_lkp_* lookup views as separate SKOS ConceptSchemes
for Fuseki/Skosmos, while leaving Site Types and Cultural Periods on their
specialist workflows.

Public Skosmos titles omit the redundant "CAAL" prefix.

Special public naming:
  v_lkp_origin -> "Surface Mark Origins"
because this lookup describes the interpreted origin of remote-sensing surface
marks (for example Anthropic / Natural), not general provenance.

Generated outputs:
  data/generated/*.rdf
  data/generated/manifest.json
  data/generated/audit_translation_coverage.csv
  data/generated/audit_lookup_issues.csv
  data/generated/skosmos_flat_vocabularies.ttl
  scripts/load_generated_lookups.ps1
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, SKOS, XSD

LANGS: Tuple[str, ...] = ("en", "ru", "zh", "kk", "ky", "tg", "tk", "uz")
BASE_ROOT = "https://vocab.uclcaal.org"
CAAL = Namespace(f"{BASE_ROOT}/ns/")


@dataclass(frozen=True)
class Vocabulary:
    slug: str
    view: str
    title: str
    short_name: str
    category: str


VOCABULARIES: Tuple[Vocabulary, ...] = (
    # Location and administration
    Vocabulary("address-types", "v_lkp_address_type", "Address Types", "Address Types", "cat_location"),
    Vocabulary("administrative-types", "v_lkp_admin_type", "Administrative Types", "Administrative Types", "cat_location"),
    Vocabulary("countries", "v_lkp_countries", "Countries", "Countries", "cat_location"),
    Vocabulary("location-accuracy-assessment", "v_lkp_loc_acc_ass", "Location Accuracy Assessment", "Location Accuracy Assessment", "cat_location"),

    # Archaeological classification and chronology
    Vocabulary("classifications", "v_lkp_classifications", "Classifications", "Classifications", "cat_archaeology"),
    Vocabulary("designation-types", "v_lkp_designation_type", "Designation Types", "Designation Types", "cat_archaeology"),
    Vocabulary("religions", "v_lkp_religion", "Religions", "Religions", "cat_archaeology"),

    # Archive and resource description
    Vocabulary("beginning-of-existence-types", "v_lkp_beg_of_exist_type", "Beginning of Existence Types", "Beginning of Existence Types", "cat_archive"),
    Vocabulary("content-types", "v_lkp_content_types", "Content Types", "Content Types", "cat_archive"),
    Vocabulary("copyright-status", "v_lkp_copyright_status", "Copyright Status", "Copyright Status", "cat_archive"),
    Vocabulary("dataset-types", "v_lkp_dataset_type", "Dataset Types", "Dataset Types", "cat_archive"),
    Vocabulary("description-types", "v_lkp_description_type", "Description Types", "Description Types", "cat_archive"),
    Vocabulary("digital-file-formats", "v_lkp_digital_file_formats", "Digital File Formats", "Digital File Formats", "cat_archive"),
    Vocabulary("end-of-existence-types", "v_lkp_end_of_exist_type", "End of Existence Types", "End of Existence Types", "cat_archive"),
    Vocabulary("levels", "v_lkp_level", "Levels", "Levels", "cat_archive"),
    Vocabulary("name-types", "v_lkp_names_type", "Name Types", "Name Types", "cat_archive"),
    Vocabulary("subjects", "v_lkp_subjects", "Subjects", "Subjects", "cat_archive"),
    Vocabulary("title-types", "v_lkp_titles_type", "Title Types", "Title Types", "cat_archive"),

    # Condition and risk
    Vocabulary("conditions", "v_lkp_condition", "Conditions", "Conditions", "cat_condition"),
    Vocabulary("condition-levels", "v_lkp_condition_level", "Condition Levels", "Condition Levels", "cat_condition"),
    Vocabulary("deterioration-causes", "v_lkp_deterioration_cause", "Deterioration Causes", "Deterioration Causes", "cat_condition"),
    Vocabulary("risk-levels", "v_lkp_risk_level", "Risk Levels", "Risk Levels", "cat_condition"),

    # Remote sensing interpretation
    Vocabulary("anomaly-types", "v_lkp_anomaly_type", "Anomaly Types", "Anomaly Types", "cat_remote_sensing"),
    Vocabulary("certainty", "v_lkp_certainty", "Certainty", "Certainty", "cat_remote_sensing"),
    Vocabulary("origins", "v_lkp_origin", "Surface Mark Origins", "Surface Mark Origins", "cat_remote_sensing"),

    # Physical description and measurement
    Vocabulary("colours", "v_lkp_colour", "Colours", "Colours", "cat_physical"),
    Vocabulary("measurement-types", "v_lkp_measurement_type", "Measurement Types", "Measurement Types", "cat_physical"),
    Vocabulary("size-dimensions-original-material", "v_lkp_size_dimensions_original_material", "Size/Dimensions Original Material", "Size/Dimensions Original Material", "cat_physical"),
    Vocabulary("units-of-measurement", "v_lkp_unit_of_measurement", "Units of Measurement", "Units of Measurement", "cat_physical"),

    # Language and writing
    Vocabulary("scripts", "v_lkp_scripts", "Scripts", "Scripts", "cat_language"),
    Vocabulary("writing-systems", "v_lkp_writing_systems", "Writing Systems", "Writing Systems", "cat_language"),
)


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def scheme_uri(slug: str) -> URIRef:
    return URIRef(f"{BASE_ROOT}/scheme/{slug}")


def concept_uri(slug: str, concept_id: Any) -> URIRef:
    return URIRef(f"{BASE_ROOT}/concept/{slug}/{str(concept_id).strip()}")


def graph_uri(slug: str) -> str:
    return f"{BASE_ROOT}/graph/{slug}"


def rdf_filename(slug: str) -> str:
    return f"caal_{slug.replace('-', '_')}.rdf"


def ttl_filename(slug: str) -> str:
    return f"caal_{slug.replace('-', '_')}.ttl"


def get_connection(args: argparse.Namespace):
    dsn = args.database_url or os.getenv("CAAL_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    return psycopg.connect(dsn, row_factory=dict_row)


def relation_columns(conn, schema: str, view: str) -> List[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, view),
        )
        return [r["column_name"] for r in cur.fetchall()]


def fetch_rows(conn, schema: str, view: str, columns: Sequence[str]) -> List[Dict[str, Any]]:
    order_parts = []
    if "sort_order" in columns:
        order_parts.append(sql.SQL("{} NULLS LAST").format(sql.Identifier("sort_order")))
    if "id" in columns:
        order_parts.append(sql.SQL("{} NULLS LAST").format(sql.Identifier("id")))

    query = sql.SQL("SELECT * FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(view))
    if order_parts:
        query += sql.SQL(" ORDER BY ") + sql.SQL(", ").join(order_parts)

    with conn.cursor() as cur:
        cur.execute(query)
        return list(cur.fetchall())


def validate_structure(vocab: Vocabulary, columns: Sequence[str]) -> List[str]:
    required = {"id", "canonical_value", "display_en"}
    missing = sorted(required.difference(columns))
    if missing:
        return [f"{vocab.view}: missing required column(s): {', '.join(missing)}"]

    missing_lang_cols = [f"display_{lang}" for lang in LANGS if f"display_{lang}" not in columns]
    if missing_lang_cols:
        return [f"{vocab.view}: missing language column(s): {', '.join(missing_lang_cols)}"]
    return []


def add_scheme(g: Graph, vocab: Vocabulary) -> URIRef:
    su = scheme_uri(vocab.slug)
    g.add((su, RDF.type, SKOS.ConceptScheme))
    g.add((su, SKOS.prefLabel, Literal(vocab.title, lang="en")))
    return su


def add_concept(
    g: Graph,
    vocab: Vocabulary,
    row: Mapping[str, Any],
    columns: Sequence[str],
    issues: List[Dict[str, str]],
) -> Optional[str]:
    cid = clean_text(row.get("id"))
    if not cid:
        issues.append({"vocabulary": vocab.slug, "id": "", "issue": "missing_id", "detail": "Row skipped because id is empty."})
        return None

    cu = concept_uri(vocab.slug, cid)
    su = scheme_uri(vocab.slug)

    g.add((cu, RDF.type, SKOS.Concept))
    g.add((cu, SKOS.inScheme, su))
    g.add((cu, SKOS.notation, Literal(cid)))
    g.add((su, SKOS.hasTopConcept, cu))
    g.add((cu, SKOS.topConceptOf, su))

    canonical = clean_text(row.get("canonical_value"))
    if canonical:
        g.add((cu, CAAL.canonicalValue, Literal(canonical)))

    english = clean_text(row.get("display_en"))
    if not english:
        if canonical:
            english = canonical
            issues.append({
                "vocabulary": vocab.slug,
                "id": cid,
                "issue": "english_label_fallback",
                "detail": "display_en was empty; canonical_value used as skos:prefLabel@en.",
            })
        else:
            issues.append({
                "vocabulary": vocab.slug,
                "id": cid,
                "issue": "missing_english_label",
                "detail": "Both display_en and canonical_value are empty.",
            })

    for lang in LANGS:
        label = clean_text(row.get(f"display_{lang}"))
        if lang == "en" and not label:
            label = english
        if label:
            g.add((cu, SKOS.prefLabel, Literal(label, lang=lang)))

    if "description" in columns:
        description = clean_text(row.get("description"))
        if description:
            g.add((cu, SKOS.scopeNote, Literal(description, lang="en")))

    if "sort_order" in columns:
        sort_value = row.get("sort_order")
        if sort_value is not None and clean_text(sort_value):
            try:
                g.add((cu, CAAL.sortOrder, Literal(int(sort_value), datatype=XSD.integer)))
            except (TypeError, ValueError):
                issues.append({
                    "vocabulary": vocab.slug,
                    "id": cid,
                    "issue": "invalid_sort_order",
                    "detail": f"Could not parse sort_order={sort_value!r} as integer.",
                })

    return cid


def duplicate_label_issues(vocab: Vocabulary, rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []
    for lang in LANGS:
        col = f"display_{lang}"
        label_to_ids: Dict[str, List[str]] = {}
        for row in rows:
            label = clean_text(row.get(col))
            cid = clean_text(row.get("id"))
            if label and cid:
                label_to_ids.setdefault(label.casefold(), []).append(cid)

        for folded, ids in label_to_ids.items():
            if len(ids) > 1:
                actual = next(clean_text(r.get(col)) for r in rows if clean_text(r.get(col)).casefold() == folded)
                issues.append({
                    "vocabulary": vocab.slug,
                    "id": ",".join(ids),
                    "issue": f"duplicate_label_{lang}",
                    "detail": actual,
                })
    return issues


def duplicate_id_issues(vocab: Vocabulary, rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, str]]:
    ids: Dict[str, int] = {}
    for row in rows:
        cid = clean_text(row.get("id"))
        if cid:
            ids[cid] = ids.get(cid, 0) + 1
    return [
        {"vocabulary": vocab.slug, "id": cid, "issue": "duplicate_id", "detail": f"id occurs {n} times in {vocab.view}"}
        for cid, n in ids.items()
        if n > 1
    ]


def translation_coverage(vocab: Vocabulary, rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    valid_rows = [r for r in rows if clean_text(r.get("id"))]
    total = len(valid_rows)
    output: List[Dict[str, Any]] = []
    for lang in LANGS:
        count = sum(1 for r in valid_rows if clean_text(r.get(f"display_{lang}")))
        pct = round((count / total * 100.0), 1) if total else 0.0
        output.append({
            "vocabulary": vocab.slug,
            "title": vocab.title,
            "category": vocab.category,
            "language": lang,
            "labelled_concepts": count,
            "total_concepts": total,
            "coverage_percent": pct,
        })
    return output


def turtle_identifier(slug: str) -> str:
    bits = re.split(r"[^A-Za-z0-9]+", slug)
    camel = "".join(x[:1].upper() + x[1:] for x in bits if x)
    return f"caal{camel}"


def skosmos_block(vocab: Vocabulary) -> str:
    ident = turtle_identifier(vocab.slug)
    langs = ", ".join(f'"{lang}"' for lang in LANGS)
    return f""":{ident} a skosmos:Vocabulary, void:Dataset ;
    dc:title "{vocab.title}"@en ;
    skosmos:shortName "{vocab.short_name}" ;
    dc:subject :{vocab.category} ;
    void:uriSpace "{BASE_ROOT}/concept/{vocab.slug}/" ;
    skosmos:language {langs} ;
    skosmos:defaultLanguage "en" ;
    skosmos:showTopConcepts true ;
    skosmos:fullAlphabeticalIndex true ;
    skosmos:mainConceptScheme <{BASE_ROOT}/scheme/{vocab.slug}> ;
    void:sparqlEndpoint <http://fuseki-cache:80/skosmos/sparql> ;
    skosmos:sparqlGraph <{BASE_ROOT}/graph/{vocab.slug}> .
"""


def write_csv(path: Path, rows: Sequence[Mapping[str, Any]], fieldnames: Sequence[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_loader_script(path: Path, manifest: Sequence[Mapping[str, Any]]) -> None:
    entries = []
    for item in manifest:
        file_rel = item["rdf_file"].replace("\\", "/")
        entries.append('    @{ File = "%s"; Graph = "%s" }' % (file_rel, item["graph_uri"]))

    body = r"""param(
    [string]$FusekiBase = "http://localhost:9030"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

$Items = @(
__ITEMS__
)

foreach ($item in $Items) {
    $filePath = Join-Path $RepoRoot $item.File
    if (-not (Test-Path $filePath)) {
        throw "RDF file not found: $filePath"
    }

    $encodedGraph = [System.Uri]::EscapeDataString($item.Graph)
    $url = "$FusekiBase/skosmos/data?graph=$encodedGraph"

    Write-Host "Loading $($item.Graph)"
    curl.exe -sS -X PUT `
        -H "Content-Type: application/rdf+xml" `
        --data-binary "@$filePath" `
        $url

    if ($LASTEXITCODE -ne 0) {
        throw "Fuseki load failed for $($item.Graph)"
    }

    Write-Host ""
}

Write-Host "Finished loading generated CAAL lookup vocabularies."
"""
    path.write_text(body.replace("__ITEMS__", "\n".join(entries)), encoding="utf-8")


def selected_vocabularies(only: str) -> List[Vocabulary]:
    if not only:
        return list(VOCABULARIES)

    wanted = {x.strip() for x in only.split(",") if x.strip()}
    known = {v.slug for v in VOCABULARIES}
    unknown = sorted(wanted - known)
    if unknown:
        raise SystemExit(
            "Unknown --only slug(s): "
            + ", ".join(unknown)
            + "\nKnown slugs: "
            + ", ".join(sorted(known))
        )
    return [v for v in VOCABULARIES if v.slug in wanted]


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Export CAAL generic PostgreSQL lookup views to SKOS RDF.")
    ap.add_argument("--database-url", help="PostgreSQL URL. Prefer CAAL_DATABASE_URL environment variable.")
    ap.add_argument("--schema", default="ui")
    ap.add_argument("--out-dir", default="data/generated")
    ap.add_argument("--only", default="", help="Comma-separated slugs, e.g. religions,conditions,levels.")
    ap.add_argument("--also-turtle", action="store_true")
    ap.add_argument("--strict", action="store_true")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    vocabs = selected_vocabularies(args.only)
    all_issues: List[Dict[str, str]] = []
    all_coverage: List[Dict[str, Any]] = []
    manifest: List[Dict[str, Any]] = []
    config_blocks: List[str] = []

    print(f"Exporting {len(vocabs)} CAAL lookup vocabularies from schema {args.schema!r}...")

    with get_connection(args) as conn:
        for vocab in vocabs:
            print(f"\n[{vocab.slug}] {args.schema}.{vocab.view}")
            columns = relation_columns(conn, args.schema, vocab.view)
            structural_errors = validate_structure(vocab, columns)

            if structural_errors:
                for msg in structural_errors:
                    all_issues.append({
                        "vocabulary": vocab.slug,
                        "id": "",
                        "issue": "invalid_view_structure",
                        "detail": msg,
                    })
                print("  SKIPPED:", "; ".join(structural_errors))
                continue

            rows = fetch_rows(conn, args.schema, vocab.view, columns)
            print(f"  Rows: {len(rows)}")

            issues: List[Dict[str, str]] = []
            issues.extend(duplicate_id_issues(vocab, rows))
            issues.extend(duplicate_label_issues(vocab, rows))

            g = Graph()
            g.bind("skos", SKOS)
            g.bind("caal", CAAL)
            add_scheme(g, vocab)

            included_ids: List[str] = []
            for row in rows:
                cid = add_concept(g, vocab, row, columns, issues)
                if cid:
                    included_ids.append(cid)

            all_issues.extend(issues)
            all_coverage.extend(translation_coverage(vocab, rows))

            rdf_path = out_dir / rdf_filename(vocab.slug)
            g.serialize(destination=str(rdf_path), format="pretty-xml")

            if args.also_turtle:
                g.serialize(destination=str(out_dir / ttl_filename(vocab.slug)), format="turtle")

            manifest.append({
                "slug": vocab.slug,
                "title": vocab.title,
                "short_name": vocab.short_name,
                "category": vocab.category,
                "source_view": f"{args.schema}.{vocab.view}",
                "scheme_uri": str(scheme_uri(vocab.slug)),
                "graph_uri": graph_uri(vocab.slug),
                "concept_uri_space": f"{BASE_ROOT}/concept/{vocab.slug}/",
                "rdf_file": str(rdf_path).replace("\\", "/"),
                "concept_count": len(included_ids),
                "triple_count": len(g),
            })
            config_blocks.append(skosmos_block(vocab))

            print(f"  Concepts: {len(included_ids)}")
            print(f"  Triples: {len(g)}")
            print(f"  RDF: {rdf_path}")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    write_csv(
        out_dir / "audit_translation_coverage.csv",
        all_coverage,
        ["vocabulary", "title", "category", "language", "labelled_concepts", "total_concepts", "coverage_percent"],
    )
    write_csv(
        out_dir / "audit_lookup_issues.csv",
        all_issues,
        ["vocabulary", "id", "issue", "detail"],
    )

    (out_dir / "skosmos_flat_vocabularies.ttl").write_text(
        "# Generated Skosmos blocks for generic CAAL lookup vocabularies.\n"
        "# Category IDs must already be defined in config-docker-compose.ttl.\n"
        "# Site Types and Cultural Periods are deliberately handled separately.\n\n"
        + "\n".join(config_blocks),
        encoding="utf-8",
    )

    scripts_dir = Path.cwd() / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    write_loader_script(scripts_dir / "load_generated_lookups.ps1", manifest)

    strict_failures = [
        issue for issue in all_issues
        if issue["issue"] in {"duplicate_id", "missing_english_label"}
    ]

    print("\nFinished.")
    print(f"Manifest: {out_dir / 'manifest.json'}")
    print(f"Translation audit: {out_dir / 'audit_translation_coverage.csv'}")
    print(f"Issue audit: {out_dir / 'audit_lookup_issues.csv'}")
    print(f"Skosmos config fragment: {out_dir / 'skosmos_flat_vocabularies.ttl'}")
    print(f"Fuseki loader: {scripts_dir / 'load_generated_lookups.ps1'}")
    print(f"Audit issues/warnings: {len(all_issues)}")

    if args.strict and strict_failures:
        print(
            f"STRICT MODE FAILED: {len(strict_failures)} critical issue(s).",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
