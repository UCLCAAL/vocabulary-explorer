#!/usr/bin/env python3
"""
Repair lexical forms introduced by the first Site Types normalisation import.

The original normalisation script used Unicode NFKC + whitespace collapsing
when inserting missing labels and notes. That is useful for comparison keys,
but should not have been used for the stored/published lexical value.

This script restores the exact lexical form used by the staged source and
current published RDF, while touching ONLY rows created by workbench import 1
(or another import_run_id supplied explicitly).

Default mode is audit-only.
Use --write to commit the repairs.

It does NOT touch:
- pre-existing labels_curated rows;
- the 24 pre-existing preferred-label differences;
- the MT-3-0013 Kazakh source conflict;
- hierarchy, IDs, active status or sort order.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from collections import defaultdict
from typing import Any

try:
    import psycopg
except ImportError as e:
    raise SystemExit('psycopg is not installed. Run: pip install "psycopg[binary]"') from e

LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]


def lexical(value: Any) -> str:
    """Match publication cleaning: trim outer whitespace only."""
    return "" if value is None else str(value).strip()


def norm_key(value: Any) -> str:
    """Normalisation is appropriate for matching/indexing, not display text."""
    s = unicodedata.normalize("NFKC", lexical(value))
    s = re.sub(r"\s+", " ", s)
    return s.casefold()


def parse_level(value: Any) -> int | None:
    s = lexical(value)
    m = re.fullmatch(r"L(\d+)", s, flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def get_staged_rows(cur, import_run_id: int):
    cur.execute(
        """
        SELECT source_row_number, row_data
        FROM vocab_workbench.import_rows
        WHERE import_run_id = %s
        ORDER BY source_row_number
        """,
        (import_run_id,),
    )
    rows = []
    for source_row_number, row_data in cur.fetchall():
        if not isinstance(row_data, dict):
            row_data = json.loads(row_data)
        rows.append((source_row_number, row_data))
    return rows


def build_expected(staged_rows):
    labels = defaultdict(lambda: defaultdict(list))
    notes = defaultdict(lambda: defaultdict(list))

    for source_row_number, row in staged_rows:
        cid = lexical(row.get("concept_id"))
        if not cid:
            continue

        level = parse_level(row.get("level_curated"))
        if level is not None:
            for lang in LANGS:
                value = lexical(row.get(f"H{level}_{lang}"))
                if value:
                    labels[(cid, lang)][value].append(source_row_number)

        for lang in LANGS:
            value = lexical(row.get(f"Notes_{lang}"))
            if value:
                notes[(cid, lang)][value].append(source_row_number)

    return labels, notes


def audit(cur, import_run_id: int):
    source_tag = f"workbench_import_{import_run_id}"
    staged = get_staged_rows(cur, import_run_id)
    expected_labels, expected_notes = build_expected(staged)

    label_repairs = []
    label_conflicts = []

    for (cid, lang), values in sorted(expected_labels.items()):
        if len(values) != 1:
            label_conflicts.append({
                "concept_id": cid,
                "lang": lang,
                "values": [
                    {"value": v, "source_rows": rows}
                    for v, rows in sorted(values.items())
                ],
            })
            continue

        expected = next(iter(values))
        cur.execute(
            """
            SELECT label_id, label, norm_key
            FROM public.labels_curated
            WHERE concept_id = %s
              AND lang = %s
              AND source = %s
              AND lower(COALESCE(status, '')) = 'preferred'
            ORDER BY label_id
            """,
            (cid, lang, source_tag),
        )
        for label_id, current, current_norm_key in cur.fetchall():
            current = "" if current is None else str(current)
            if current != expected:
                label_repairs.append({
                    "label_id": label_id,
                    "concept_id": cid,
                    "lang": lang,
                    "current": current,
                    "expected": expected,
                    "expected_norm_key": norm_key(expected),
                })

    note_repairs = []
    note_conflicts = []

    for (cid, lang), values in sorted(expected_notes.items()):
        if len(values) != 1:
            note_conflicts.append({
                "concept_id": cid,
                "lang": lang,
                "values": [
                    {"value": v, "source_rows": rows}
                    for v, rows in sorted(values.items())
                ],
            })
            continue

        expected = next(iter(values))
        cur.execute(
            """
            SELECT note_id, note
            FROM public.concept_notes_curated
            WHERE concept_id = %s
              AND lang = %s
              AND import_run_id = %s
              AND lower(COALESCE(note_type, '')) = 'scopenote'
            ORDER BY note_id
            """,
            (cid, lang, import_run_id),
        )
        for note_id, current in cur.fetchall():
            current = "" if current is None else str(current)
            if current != expected:
                note_repairs.append({
                    "note_id": note_id,
                    "concept_id": cid,
                    "lang": lang,
                    "current": current,
                    "expected": expected,
                })

    return {
        "label_repairs": label_repairs,
        "note_repairs": note_repairs,
        "source_label_conflicts_skipped": label_conflicts,
        "source_note_conflicts_skipped": note_conflicts,
    }


def print_report(report):
    print("\nSite Types imported-text repair audit")
    print("=" * 68)
    print(f"Imported label rows needing restoration: {len(report['label_repairs'])}")
    print(f"Imported note rows needing restoration:  {len(report['note_repairs'])}")
    print(f"Source label conflicts skipped:          {len(report['source_label_conflicts_skipped'])}")
    print(f"Source note conflicts skipped:           {len(report['source_note_conflicts_skipped'])}")

    if report["label_repairs"]:
        print("\nLabel repairs")
        for item in report["label_repairs"][:30]:
            print(f"  {item['concept_id']} [{item['lang']}]")
            print(f"    stored:   {item['current']!r}")
            print(f"    restore:  {item['expected']!r}")
        if len(report["label_repairs"]) > 30:
            print(f"  ... {len(report['label_repairs']) - 30} more")

    if report["note_repairs"]:
        print("\nScope-note repairs")
        for item in report["note_repairs"][:20]:
            print(f"  {item['concept_id']} [{item['lang']}]")
            print(f"    stored:   {item['current']!r}")
            print(f"    restore:  {item['expected']!r}")
        if len(report["note_repairs"]) > 20:
            print(f"  ... {len(report['note_repairs']) - 20} more")

    if report["source_label_conflicts_skipped"]:
        print("\nConflicts deliberately untouched")
        for item in report["source_label_conflicts_skipped"]:
            print(f"  {item['concept_id']} [{item['lang']}]")
            for value in item["values"]:
                print(f"    {value['value']!r} rows={value['source_rows']}")


def apply(cur, report):
    labels_updated = 0
    notes_updated = 0

    for item in report["label_repairs"]:
        cur.execute(
            """
            UPDATE public.labels_curated
            SET label = %s,
                norm_key = %s
            WHERE label_id = %s
            """,
            (
                item["expected"],
                item["expected_norm_key"],
                item["label_id"],
            ),
        )
        labels_updated += cur.rowcount

    for item in report["note_repairs"]:
        cur.execute(
            """
            UPDATE public.concept_notes_curated
            SET note = %s,
                updated_at = now()
            WHERE note_id = %s
            """,
            (
                item["expected"],
                item["note_id"],
            ),
        )
        notes_updated += cur.rowcount

    return labels_updated, notes_updated


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import-run-id", type=int, default=1)
    ap.add_argument("--dsn", default="")
    ap.add_argument("--write", action="store_true")
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

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            report = audit(cur, args.import_run_id)
            print_report(report)

            if not args.write:
                conn.rollback()
                print("\nAUDIT ONLY. No database changes made.")
                return

            labels_updated, notes_updated = apply(cur, report)
            conn.commit()

            print("\nRepair committed")
            print("=" * 68)
            print(f"labels_updated: {labels_updated}")
            print(f"notes_updated:  {notes_updated}")
            print("\nOnly rows created by this workbench import were changed.")


if __name__ == "__main__":
    main()
