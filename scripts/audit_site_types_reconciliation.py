#!/usr/bin/env python3
"""
Audit-only reconciliation of CAAL Site Types preferred labels.

Compares:
  1. the current published RDF (reference), and
  2. public.labels_curated in PostgreSQL

for the concepts currently published in the Site Types SKOS graph.

It produces a proposal for each concept/language mismatch, but MAKES NO
DATABASE CHANGES.

For each mismatch it reports:
- current published prefLabel(s)
- current database preferred label(s)
- whether the published label already exists in labels_curated as a
  non-preferred label
- staged source variants and source row numbers
- the proposed reconciliation action

Intended next step:
- inspect the JSON/CSV report;
- only then run a separate write script to apply approved changes.

Connection:
- --dsn takes precedence;
- otherwise CAAL_DATABASE_URL;
- otherwise DATABASE_URL.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import psycopg
except ImportError as e:
    raise SystemExit('psycopg is not installed. Run: pip install "psycopg[binary]"') from e

try:
    from rdflib import Graph, Literal, URIRef
    from rdflib.namespace import RDF, SKOS
except ImportError as e:
    raise SystemExit("rdflib is not installed. Run: pip install rdflib") from e


CONCEPT_BASE = "https://vocab.uclcaal.org/concept/"
LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def concept_id_from_uri(uri: URIRef) -> str | None:
    text = str(uri)
    if not text.startswith(CONCEPT_BASE):
        return None
    cid = text[len(CONCEPT_BASE):]
    return cid or None


def parse_reference(path: Path):
    g = Graph()
    g.parse(str(path))

    published_concepts = {
        concept_id_from_uri(s)
        for s in g.subjects(RDF.type, SKOS.Concept)
        if isinstance(s, URIRef)
    }
    published_concepts.discard(None)

    pref = defaultdict(list)
    for subject, _, obj in g.triples((None, SKOS.prefLabel, None)):
        if not isinstance(subject, URIRef) or not isinstance(obj, Literal):
            continue
        cid = concept_id_from_uri(subject)
        if not cid:
            continue
        lang = obj.language or ""
        if lang not in LANGS:
            continue
        value = str(obj)
        if value not in pref[(cid, lang)]:
            pref[(cid, lang)].append(value)

    return g, published_concepts, pref


def load_database(cur, published_concepts):
    cur.execute(
        """
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
        WHERE concept_id IS NOT NULL
          AND lang IS NOT NULL
          AND label IS NOT NULL
        ORDER BY concept_id, lang, label_id
        """
    )
    cols = [d.name for d in cur.description]

    all_rows = defaultdict(list)
    preferred = defaultdict(list)

    for row_tuple in cur.fetchall():
        row = dict(zip(cols, row_tuple))
        cid = clean(row["concept_id"])
        lang = clean(row["lang"])

        if cid not in published_concepts or lang not in LANGS:
            continue

        all_rows[(cid, lang)].append(row)
        if clean(row["status"]).casefold() == "preferred":
            preferred[(cid, lang)].append(row)

    return all_rows, preferred


def parse_level(value: Any) -> int | None:
    text = clean(value)
    if len(text) >= 2 and text[0].upper() == "L" and text[1:].isdigit():
        return int(text[1:])
    return None


def load_staged_variants(cur, import_run_id: int):
    cur.execute(
        """
        SELECT source_row_number, row_data
        FROM vocab_workbench.import_rows
        WHERE import_run_id = %s
        ORDER BY source_row_number
        """,
        (import_run_id,),
    )

    variants = defaultdict(lambda: defaultdict(list))

    for source_row_number, row_data in cur.fetchall():
        if not isinstance(row_data, dict):
            row_data = json.loads(row_data)

        cid = clean(row_data.get("concept_id"))
        if not cid:
            continue

        level = parse_level(row_data.get("level_curated"))
        if level is None:
            continue

        for lang in LANGS:
            value = clean(row_data.get(f"H{level}_{lang}"))
            if not value:
                continue
            variants[(cid, lang)][value].append(source_row_number)

    return variants


def audit(reference_pref, db_all, db_preferred, staged_variants):
    keys = sorted(set(reference_pref) | set(db_preferred))
    mismatches = []

    for cid, lang in keys:
        ref_values = reference_pref.get((cid, lang), [])
        db_pref_rows = db_preferred.get((cid, lang), [])
        db_pref_values = [clean(r["label"]) for r in db_pref_rows]

        if ref_values == db_pref_values:
            continue
        if set(ref_values) == set(db_pref_values) and len(ref_values) == len(db_pref_values):
            continue

        all_rows = db_all.get((cid, lang), [])
        ref_existing_rows = [
            r for r in all_rows
            if clean(r["label"]) in ref_values
        ]

        staged = staged_variants.get((cid, lang), {})
        staged_report = [
            {
                "label": label,
                "source_rows": rows,
                "is_published_value": label in ref_values,
                "is_current_db_preferred": label in db_pref_values,
            }
            for label, rows in sorted(staged.items())
        ]

        if len(ref_values) == 1 and len(db_pref_values) == 1:
            published = ref_values[0]
            current = db_pref_values[0]

            if ref_existing_rows:
                action = (
                    "Promote the existing database row matching the published "
                    "label to preferred; demote the current preferred row to alt."
                )
            else:
                action = (
                    "Insert the published label as preferred; demote the current "
                    "database preferred row to alt. Retain both."
                )

        elif len(ref_values) == 1 and len(db_pref_values) == 0:
            published = ref_values[0]

            if ref_existing_rows:
                action = (
                    "Promote the existing database row matching the published "
                    "label to preferred. Do not resolve any other source variants."
                )
            else:
                action = (
                    "Insert the published label as preferred. Preserve all staged "
                    "source variants for later review."
                )
        else:
            action = (
                "Manual review required because the reference or database contains "
                "multiple/no preferred values in an unexpected combination."
            )

        mismatches.append({
            "concept_id": cid,
            "lang": lang,
            "published_pref_labels": ref_values,
            "database_pref_labels": [
                {
                    "label_id": r["label_id"],
                    "label": clean(r["label"]),
                    "status": clean(r["status"]),
                    "source": clean(r["source"]),
                }
                for r in db_pref_rows
            ],
            "published_label_already_in_database": [
                {
                    "label_id": r["label_id"],
                    "label": clean(r["label"]),
                    "status": clean(r["status"]),
                    "source": clean(r["source"]),
                }
                for r in ref_existing_rows
            ],
            "staged_source_variants": staged_report,
            "proposed_action": action,
        })

    return mismatches


def print_report(mismatches):
    print("\nSite Types preferred-label reconciliation audit")
    print("=" * 72)
    print(f"Mismatched concept/language pairs: {len(mismatches)}")

    counts = defaultdict(int)
    for item in mismatches:
        counts[item["lang"]] += 1

    print("\nMismatches by language")
    for lang in LANGS:
        if counts[lang]:
            print(f"  {lang}: {counts[lang]}")

    print("\nProposals")
    print("-" * 72)

    for i, item in enumerate(mismatches, start=1):
        print(f"{i}. {item['concept_id']} [{item['lang']}]")

        published = item["published_pref_labels"] or ["<none>"]
        current = [
            r["label"] for r in item["database_pref_labels"]
        ] or ["<none>"]

        print("   PUBLISHED:")
        for value in published:
            print(f"     {value}")

        print("   DATABASE PREFERRED:")
        for value in current:
            print(f"     {value}")

        if item["staged_source_variants"]:
            print("   STAGED SOURCE:")
            for v in item["staged_source_variants"]:
                flags = []
                if v["is_published_value"]:
                    flags.append("published")
                if v["is_current_db_preferred"]:
                    flags.append("db-preferred")
                suffix = f" [{' / '.join(flags)}]" if flags else ""
                print(
                    f"     {v['label']}  rows={v['source_rows']}{suffix}"
                )

        print(f"   PROPOSED: {item['proposed_action']}")
        print()


def write_csv(path: Path, mismatches):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "concept_id",
            "lang",
            "published_pref_label",
            "database_pref_label",
            "published_label_already_in_database",
            "staged_source_variants",
            "proposed_action",
        ])

        for item in mismatches:
            writer.writerow([
                item["concept_id"],
                item["lang"],
                " | ".join(item["published_pref_labels"]),
                " | ".join(
                    r["label"] for r in item["database_pref_labels"]
                ),
                " | ".join(
                    f"{r['label']} [{r['status']}]"
                    for r in item["published_label_already_in_database"]
                ),
                " | ".join(
                    f"{v['label']} (rows {','.join(map(str, v['source_rows']))})"
                    for v in item["staged_source_variants"]
                ),
                item["proposed_action"],
            ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--reference",
        required=True,
        help="Current published Site Types RDF/XML or Turtle file",
    )
    ap.add_argument("--import-run-id", type=int, default=1)
    ap.add_argument("--dsn", default="")
    ap.add_argument(
        "--json",
        default="site_types_reconciliation_audit.json",
    )
    ap.add_argument(
        "--csv",
        default="site_types_reconciliation_audit.csv",
    )
    args = ap.parse_args()

    dsn = (
        args.dsn
        or os.environ.get("CAAL_DATABASE_URL", "")
        or os.environ.get("DATABASE_URL", "")
    )
    if not dsn:
        raise SystemExit(
            "No PostgreSQL connection supplied. Use --dsn or set CAAL_DATABASE_URL."
        )

    reference_path = Path(args.reference).resolve()
    if not reference_path.exists():
        raise SystemExit(f"Reference RDF not found: {reference_path}")

    _, published_concepts, reference_pref = parse_reference(reference_path)

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            db_all, db_preferred = load_database(cur, published_concepts)
            staged_variants = load_staged_variants(cur, args.import_run_id)

    mismatches = audit(
        reference_pref,
        db_all,
        db_preferred,
        staged_variants,
    )

    print_report(mismatches)

    json_path = Path(args.json).resolve()
    json_path.write_text(
        json.dumps(
            {
                "reference_file": reference_path.name,
                "import_run_id": args.import_run_id,
                "published_concepts": len(published_concepts),
                "mismatch_count": len(mismatches),
                "mismatches": mismatches,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    csv_path = Path(args.csv).resolve()
    write_csv(csv_path, mismatches)

    print(f"JSON report: {json_path}")
    print(f"CSV report:  {csv_path}")
    print("\nAUDIT ONLY. No database changes made.")


if __name__ == "__main__":
    main()
