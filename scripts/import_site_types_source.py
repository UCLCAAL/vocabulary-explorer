#!/usr/bin/env python3
"""
Lossless staging import for the CAAL Site Types merged thesaurus.

What this DOES:
- Reads site_types_3_1_interim_MERGED.csv exactly as supplied.
- Audits concept IDs, unresolved rows, multilingual labels, notes, and conflicts.
- Optionally stores every source row as JSONB in vocab_workbench.import_rows.
- Creates one vocab_workbench.import_runs record for the import.

What this DOES NOT do:
- It does not change concepts_curated.
- It does not change labels_curated.
- It does not populate concept_notes_curated yet.
- It does not change any current CAAL lookup view or Skosmos data.

Run once without --write to audit.
Run again with --write when the audit looks correct.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]


def clean(value: str | None) -> str:
    return "" if value is None else str(value).strip()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def level_number(value: str) -> int | None:
    value = clean(value)
    if len(value) >= 2 and value[0].upper() == "L" and value[1:].isdigit():
        return int(value[1:])
    return None


def audit(rows: list[dict[str, str]]) -> dict:
    concept_rows = [r for r in rows if clean(r.get("concept_id"))]
    ids = [clean(r.get("concept_id")) for r in concept_rows]
    duplicate_ids = {
        cid: count
        for cid, count in Counter(ids).items()
        if count > 1
    }

    scheme_rows = []
    unresolved_rows = []

    for index, row in enumerate(rows, start=2):  # header is physical line 1
        cid = clean(row.get("concept_id"))
        join_key = clean(row.get("join_key_norm"))

        if cid:
            continue
        if join_key:
            unresolved_rows.append({
                "csv_line": index,
                "sortOrder": clean(row.get("sortOrder")),
                "join_key_norm": join_key,
                "H1_en": clean(row.get("H1_en")),
                "H2_en": clean(row.get("H2_en")),
                "H3_en": clean(row.get("H3_en")),
                "H4_en": clean(row.get("H4_en")),
            })
        else:
            scheme_rows.append({
                "csv_line": index,
                "sortOrder": clean(row.get("sortOrder")),
                "L0_en": clean(row.get("L0_en")),
            })

    label_values: dict[tuple[str, str], set[str]] = defaultdict(set)
    note_values: dict[tuple[str, str], set[str]] = defaultdict(set)

    for row in concept_rows:
        cid = clean(row.get("concept_id"))
        level = level_number(clean(row.get("level_curated")))

        if level:
            for lang in LANGS:
                value = clean(row.get(f"H{level}_{lang}"))
                if value:
                    label_values[(cid, lang)].add(value)

        for lang in LANGS:
            value = clean(row.get(f"Notes_{lang}"))
            if value:
                note_values[(cid, lang)].add(value)

    label_counts = {}
    note_counts = {}
    label_conflicts = []
    note_conflicts = []

    for lang in LANGS:
        label_pairs = {
            cid: values
            for (cid, l), values in label_values.items()
            if l == lang
        }
        note_pairs = {
            cid: values
            for (cid, l), values in note_values.items()
            if l == lang
        }

        label_counts[lang] = len(label_pairs)
        note_counts[lang] = len(note_pairs)

        for cid, values in sorted(label_pairs.items()):
            if len(values) > 1:
                label_conflicts.append({
                    "concept_id": cid,
                    "lang": lang,
                    "values": sorted(values),
                })

        for cid, values in sorted(note_pairs.items()):
            if len(values) > 1:
                note_conflicts.append({
                    "concept_id": cid,
                    "lang": lang,
                    "values": sorted(values),
                })

    return {
        "source_rows": len(rows),
        "concept_rows": len(concept_rows),
        "unique_concept_ids": len(set(ids)),
        "duplicate_concept_ids": duplicate_ids,
        "scheme_rows": scheme_rows,
        "unresolved_rows": unresolved_rows,
        "preferred_label_concepts_by_language": label_counts,
        "scope_note_concepts_by_language": note_counts,
        "label_conflicts": label_conflicts,
        "note_conflicts": note_conflicts,
    }


def print_audit(result: dict, digest: str) -> None:
    print("\nCAAL Site Types source audit")
    print("=" * 60)
    print(f"SHA-256:            {digest}")
    print(f"Source rows:         {result['source_rows']}")
    print(f"Concept rows:        {result['concept_rows']}")
    print(f"Unique concept IDs:  {result['unique_concept_ids']}")
    print(f"Scheme rows:         {len(result['scheme_rows'])}")
    print(f"Unresolved rows:     {len(result['unresolved_rows'])}")

    print("\nDuplicate concept IDs")
    if result["duplicate_concept_ids"]:
        for cid, count in result["duplicate_concept_ids"].items():
            print(f"  {cid}: {count} source rows")
    else:
        print("  none")

    print("\nPreferred labels available by language")
    for lang in LANGS:
        print(f"  {lang}: {result['preferred_label_concepts_by_language'][lang]}")

    print("\nScope notes available by language")
    for lang in LANGS:
        print(f"  {lang}: {result['scope_note_concepts_by_language'][lang]}")

    print("\nLabel conflicts")
    if result["label_conflicts"]:
        for item in result["label_conflicts"]:
            values = " | ".join(item["values"])
            print(f"  {item['concept_id']} [{item['lang']}]: {values}")
    else:
        print("  none")

    print("\nScope-note conflicts")
    if result["note_conflicts"]:
        for item in result["note_conflicts"]:
            values = " | ".join(item["values"])
            print(f"  {item['concept_id']} [{item['lang']}]: {values}")
    else:
        print("  none")

    print("\nUnresolved source rows")
    if result["unresolved_rows"]:
        for item in result["unresolved_rows"]:
            print(
                f"  CSV line {item['csv_line']}, sortOrder {item['sortOrder']}: "
                f"{item['join_key_norm']}"
            )
    else:
        print("  none")


def stage_to_postgres(
    rows: list[dict[str, str]],
    csv_path: Path,
    digest: str,
    dsn: str,
) -> int:
    try:
        import psycopg
    except ImportError:
        raise SystemExit(
            'psycopg is not installed. Run: pip install "psycopg[binary]"'
        )

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO vocab_workbench.import_runs
                    (vocabulary_code, source_type, source_filename, row_count, notes)
                VALUES
                    (%s, %s, %s, %s, %s)
                RETURNING import_run_id
                """,
                (
                    "site-types",
                    "merged_wide_csv",
                    csv_path.name,
                    len(rows),
                    f"Lossless staging import. SHA-256={digest}. "
                    "No authoritative vocabulary tables changed.",
                ),
            )
            import_run_id = cur.fetchone()[0]

            payload = []
            for index, row in enumerate(rows, start=2):
                cid = clean(row.get("concept_id"))
                join_key = clean(row.get("join_key_norm"))

                if cid:
                    source_key = cid
                elif join_key:
                    source_key = join_key
                else:
                    source_key = "scheme"

                payload.append(
                    (
                        import_run_id,
                        index,
                        source_key,
                        json.dumps(row, ensure_ascii=False),
                    )
                )

            cur.executemany(
                """
                INSERT INTO vocab_workbench.import_rows
                    (import_run_id, source_row_number, source_key, row_data)
                VALUES
                    (%s, %s, %s, %s::jsonb)
                """,
                payload,
            )

        conn.commit()

    return import_run_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", help="site_types_3_1_interim_MERGED.csv")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the lossless source rows to vocab_workbench.import_runs/import_rows",
    )
    parser.add_argument(
        "--dsn",
        default=os.environ.get("DATABASE_URL", ""),
        help="PostgreSQL DSN. Defaults to DATABASE_URL environment variable.",
    )
    parser.add_argument(
        "--audit-json",
        default="site_types_source_audit.json",
        help="Audit JSON output path",
    )
    args = parser.parse_args()

    path = Path(args.csv).resolve()
    if not path.exists():
        raise SystemExit(f"CSV not found: {path}")

    rows = read_rows(path)
    digest = sha256_file(path)
    result = audit(rows)

    print_audit(result, digest)

    audit_path = Path(args.audit_json).resolve()
    audit_path.write_text(
        json.dumps(
            {
                "source_file": path.name,
                "sha256": digest,
                **result,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nAudit written to: {audit_path}")

    if not args.write:
        print("\nNo database changes made. Re-run with --write to stage the source.")
        return 0

    if not args.dsn:
        raise SystemExit(
            "No PostgreSQL DSN supplied. Set DATABASE_URL or pass --dsn."
        )

    import_run_id = stage_to_postgres(rows, path, digest, args.dsn)
    print(f"\nStaged successfully. import_run_id = {import_run_id}")
    print("Authoritative vocabulary tables were not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
