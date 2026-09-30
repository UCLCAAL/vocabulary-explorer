#!/usr/bin/env python3
"""
Reconcile CAAL Site Types preferred labels to the current published RDF.

The published RDF is treated as authoritative.

Default: AUDIT ONLY.
With --write:

1. Formatting-only slash-spacing differences
   Example:
       "Грот комплекс/храм"
       -> "Грот комплекс / храм"
   The existing preferred row is updated in place.
   No duplicate/alt label is created.

2. Genuine textual differences
   The published value becomes preferred.
   The former database preferred value is retained as status='alt'.

3. Missing database preferred label
   The published value is inserted/promoted to preferred.
   If the staged source contains competing variants, the non-published
   variants are preserved as status='alt'.

The script does NOT alter concept IDs, hierarchy, active status, or sort order.

Connection:
- --dsn takes precedence
- otherwise CAAL_DATABASE_URL
- otherwise DATABASE_URL
"""

from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
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


def lexical(value: Any) -> str:
    return "" if value is None else str(value).strip()


def matching_key(value: Any) -> str:
    s = unicodedata.normalize("NFKC", lexical(value))
    s = re.sub(r"\s+", " ", s)
    return s.casefold()


def slash_spacing_key(value: Any) -> str:
    s = lexical(value)
    s = re.sub(r"\s*/\s*", "/", s)
    return s


def concept_id_from_uri(uri: URIRef) -> str | None:
    text = str(uri)
    if not text.startswith(CONCEPT_BASE):
        return None
    cid = text[len(CONCEPT_BASE):]
    return cid or None


def parse_reference(path: Path):
    g = Graph()
    g.parse(str(path))

    concepts = {
        concept_id_from_uri(s)
        for s in g.subjects(RDF.type, SKOS.Concept)
        if isinstance(s, URIRef)
    }
    concepts.discard(None)

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

    return concepts, pref


def load_labels(cur, published_concepts):
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

    for tup in cur.fetchall():
        row = dict(zip(cols, tup))
        cid = lexical(row["concept_id"])
        lang = lexical(row["lang"])

        if cid not in published_concepts or lang not in LANGS:
            continue

        all_rows[(cid, lang)].append(row)

        if lexical(row["status"]).casefold() == "preferred":
            preferred[(cid, lang)].append(row)

    return all_rows, preferred


def load_concepts(cur):
    cur.execute(
        """
        SELECT concept_id, level, en_label
        FROM public.concepts_curated
        """
    )
    return {
        lexical(cid): {
            "level": lexical(level),
            "en_label": lexical(en_label),
        }
        for cid, level, en_label in cur.fetchall()
    }


def parse_level(value: Any) -> int | None:
    text = lexical(value)
    m = re.fullmatch(r"L(\d+)", text, flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


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

        cid = lexical(row_data.get("concept_id"))
        if not cid:
            continue

        level = parse_level(row_data.get("level_curated"))
        if level is None:
            continue

        for lang in LANGS:
            value = lexical(row_data.get(f"H{level}_{lang}"))
            if value:
                variants[(cid, lang)][value].append(source_row_number)

    return variants


def classify(reference_pref, db_all, db_preferred, staged_variants):
    cases = []

    for key in sorted(reference_pref):
        cid, lang = key
        published = reference_pref[key]
        current_rows = db_preferred.get(key, [])
        current = [lexical(r["label"]) for r in current_rows]

        if len(published) != 1:
            cases.append({
                "concept_id": cid,
                "lang": lang,
                "classification": "manual",
                "published": published,
                "database": current,
                "reason": "Reference graph has multiple preferred labels for this language.",
            })
            continue

        pub = published[0]

        if len(current) == 1 and current[0] == pub:
            continue

        staged = staged_variants.get(key, {})
        staged_report = [
            {
                "label": label,
                "source_rows": rows,
                "is_published": label == pub,
                "is_current_db_preferred": label in current,
            }
            for label, rows in sorted(staged.items())
        ]

        existing_exact_rows = [
            r for r in db_all.get(key, [])
            if lexical(r["label"]) == pub
        ]

        if len(current) == 1:
            old = current[0]

            # Explicit migration-only formatting exceptions.
            # These are known transcription artefacts, not meaningful
            # alternative vocabulary terms.
            formatting_overrides = {
                ("MT-2-0115", "ru"),
            }

            if (
                slash_spacing_key(old) == slash_spacing_key(pub)
                or (cid, lang) in formatting_overrides
            ):
                classification = "formatting_only"
                action = (
                    "Update the existing preferred row in place to the exact "
                    "published lexical form. Do not create an alt label."
                )
            else:
                classification = "substantive"
                action = (
                    "Make the published value preferred and retain the former "
                    "database preferred value as alt."
                )

        elif len(current) == 0:
            classification = "missing_preferred"
            action = (
                "Make the published value preferred. Preserve any competing "
                "staged source variants as alt."
            )

        else:
            classification = "manual"
            action = (
                "Manual review required because multiple database preferred "
                "labels currently exist for this concept/language."
            )

        cases.append({
            "concept_id": cid,
            "lang": lang,
            "classification": classification,
            "published": [pub],
            "database": current,
            "database_preferred_rows": [
                {
                    "label_id": r["label_id"],
                    "label": lexical(r["label"]),
                    "source": lexical(r["source"]),
                }
                for r in current_rows
            ],
            "published_exact_rows_in_database": [
                {
                    "label_id": r["label_id"],
                    "label": lexical(r["label"]),
                    "status": lexical(r["status"]),
                    "source": lexical(r["source"]),
                }
                for r in existing_exact_rows
            ],
            "staged_source_variants": staged_report,
            "proposed_action": action,
        })

    return cases


def next_numeric_label_ids(cur, count: int):
    if count <= 0:
        return []

    cur.execute("LOCK TABLE public.labels_curated IN SHARE ROW EXCLUSIVE MODE")
    cur.execute(
        """
        SELECT COALESCE(
            max(label_id::bigint) FILTER (WHERE label_id ~ '^[0-9]+$'),
            0
        )
        FROM public.labels_curated
        """
    )
    start = int(cur.fetchone()[0]) + 1
    return [str(start + i) for i in range(count)]


def insert_label(cur, label_id, cid, lang, label, status, source, concept):
    cur.execute(
        """
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
            (%s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
        """,
        (
            label_id,
            cid,
            lang,
            label,
            status,
            source,
            matching_key(label),
            concept.get("level") or None,
            concept.get("en_label") or None,
        ),
    )


def apply(cur, cases, concepts, import_run_id):
    changes = {
        "formatting_rows_updated_in_place": 0,
        "old_preferred_rows_demoted_to_alt": 0,
        "published_existing_rows_promoted": 0,
        "published_rows_inserted": 0,
        "competing_staged_alt_rows_inserted": 0,
        "manual_cases_skipped": 0,
    }

    insert_need = 0
    for case in cases:
        if case["classification"] == "manual":
            continue

        pub = case["published"][0]
        if not case.get("published_exact_rows_in_database"):
            insert_need += 1

        if case["classification"] == "missing_preferred":
            for variant in case.get("staged_source_variants", []):
                if variant["label"] != pub:
                    insert_need += 1

    ids = iter(next_numeric_label_ids(cur, insert_need))

    for case in cases:
        cid = case["concept_id"]
        lang = case["lang"]
        classification = case["classification"]

        if classification == "manual":
            changes["manual_cases_skipped"] += 1
            continue

        pub = case["published"][0]
        concept = concepts.get(cid, {})

        if classification == "formatting_only":
            current_rows = case["database_preferred_rows"]
            if len(current_rows) != 1:
                changes["manual_cases_skipped"] += 1
                continue

            cur.execute(
                """
                UPDATE public.labels_curated
                SET label = %s,
                    norm_key = %s
                WHERE label_id = %s
                  AND lower(COALESCE(status, '')) = 'preferred'
                """,
                (pub, matching_key(pub), current_rows[0]["label_id"]),
            )
            changes["formatting_rows_updated_in_place"] += cur.rowcount
            continue

        exact_rows = case.get("published_exact_rows_in_database", [])
        published_label_id = None

        if exact_rows:
            published_label_id = exact_rows[0]["label_id"]
            cur.execute(
                """
                UPDATE public.labels_curated
                SET status = 'preferred',
                    norm_key = %s
                WHERE label_id = %s
                """,
                (matching_key(pub), published_label_id),
            )
            changes["published_existing_rows_promoted"] += cur.rowcount
        else:
            published_label_id = next(ids)
            insert_label(
                cur,
                published_label_id,
                cid,
                lang,
                pub,
                "preferred",
                f"published_reconciliation_import_{import_run_id}",
                concept,
            )
            changes["published_rows_inserted"] += 1

        cur.execute(
            """
            UPDATE public.labels_curated
            SET status = 'alt'
            WHERE concept_id = %s
              AND lang = %s
              AND lower(COALESCE(status, '')) = 'preferred'
              AND label_id <> %s
              AND label IS DISTINCT FROM %s
            """,
            (cid, lang, published_label_id, pub),
        )
        changes["old_preferred_rows_demoted_to_alt"] += cur.rowcount

        if classification == "missing_preferred":
            for variant in case.get("staged_source_variants", []):
                alt = variant["label"]
                if not alt or alt == pub:
                    continue

                cur.execute(
                    """
                    SELECT 1
                    FROM public.labels_curated
                    WHERE concept_id = %s
                      AND lang = %s
                      AND label = %s
                    LIMIT 1
                    """,
                    (cid, lang, alt),
                )
                if cur.fetchone():
                    continue

                insert_label(
                    cur,
                    next(ids),
                    cid,
                    lang,
                    alt,
                    "alt",
                    f"staged_conflict_import_{import_run_id}",
                    concept,
                )
                changes["competing_staged_alt_rows_inserted"] += 1

    return changes


def print_report(cases):
    counts = defaultdict(int)
    for c in cases:
        counts[c["classification"]] += 1

    print("\nSite Types published-authority reconciliation")
    print("=" * 72)
    print(f"Total differences requiring action: {len(cases)}")
    print(f"Formatting-only slash spacing:      {counts['formatting_only']}")
    print(f"Substantive differences:            {counts['substantive']}")
    print(f"Missing database preferred:         {counts['missing_preferred']}")
    print(f"Manual/ambiguous:                   {counts['manual']}")

    for i, case in enumerate(cases, start=1):
        print("\n" + "-" * 72)
        print(
            f"{i}. {case['concept_id']} [{case['lang']}] "
            f"{case['classification']}"
        )
        print("   PUBLISHED:")
        for x in case["published"] or ["<none>"]:
            print(f"     {x}")
        print("   DATABASE PREFERRED:")
        for x in case["database"] or ["<none>"]:
            print(f"     {x}")

        if case.get("staged_source_variants"):
            print("   STAGED SOURCE:")
            for v in case["staged_source_variants"]:
                flags = []
                if v["is_published"]:
                    flags.append("published")
                if v["is_current_db_preferred"]:
                    flags.append("db-preferred")
                suffix = f" [{' / '.join(flags)}]" if flags else ""
                print(
                    f"     {v['label']} rows={v['source_rows']}{suffix}"
                )

        print(f"   ACTION: {case.get('proposed_action', case.get('reason', ''))}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--import-run-id", type=int, default=1)
    ap.add_argument("--dsn", default="")
    ap.add_argument("--write", action="store_true")
    ap.add_argument(
        "--report",
        default="site_types_published_authority_reconciliation.json",
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

    published_concepts, reference_pref = parse_reference(reference_path)

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            db_all, db_preferred = load_labels(cur, published_concepts)
            concepts = load_concepts(cur)
            staged_variants = load_staged_variants(cur, args.import_run_id)

            cases = classify(
                reference_pref,
                db_all,
                db_preferred,
                staged_variants,
            )

            print_report(cases)

            Path(args.report).write_text(
                json.dumps(
                    {
                        "reference_file": reference_path.name,
                        "import_run_id": args.import_run_id,
                        "published_concepts": len(published_concepts),
                        "difference_count": len(cases),
                        "cases": cases,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            print(f"\nReport written to: {Path(args.report).resolve()}")

            if not args.write:
                conn.rollback()
                print("\nAUDIT ONLY. No database changes made.")
                return

            changes = apply(cur, cases, concepts, args.import_run_id)
            conn.commit()

            print("\nReconciliation committed")
            print("=" * 72)
            for key, value in changes.items():
                print(f"{key:42} {value}")

            print(
                "\nPublished RDF lexical forms are now authoritative in "
                "labels_curated. Genuine former database values were retained "
                "as alt labels."
            )


if __name__ == "__main__":
    main()
