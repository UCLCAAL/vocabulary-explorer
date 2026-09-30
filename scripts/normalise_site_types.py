#!/usr/bin/env python3
"""
CAAL Site Types normalisation audit/import.

Reads the losslessly staged Site Types source from:
    vocab_workbench.import_runs
    vocab_workbench.import_rows

Compares it with the live authoritative tables:
    public.concepts_curated
    public.labels_curated
    public.concept_notes_curated

Default mode is READ-ONLY AUDIT.

With --write it only performs safe additions:
- fills NULL concepts_curated.sort_order from the earliest source sortOrder;
- inserts a missing preferred label only when the staged source has exactly
  one value for that concept/language AND no different preferred value already
  exists in labels_curated;
- inserts a missing scope note when the staged source has exactly one value for
  that concept/language and no different current scope note already exists.

It never:
- overwrites an existing preferred label;
- resolves conflicting staged values automatically;
- changes concept IDs, parents, levels, id_keys or active status;
- deletes anything.

Connection:
- --dsn takes precedence;
- otherwise CAAL_DATABASE_URL;
- otherwise DATABASE_URL.
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

LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def norm_text(value: Any) -> str:
    s = unicodedata.normalize("NFKC", clean(value))
    s = re.sub(r"\s+", " ", s)
    return s


def norm_key(value: Any) -> str:
    return norm_text(value).casefold()


def parse_level(value: Any) -> int | None:
    s = clean(value)
    m = re.fullmatch(r"L(\d+)", s, flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def staged_label(row: dict[str, Any], lang: str) -> str:
    lvl = parse_level(row.get("level_curated"))
    if lvl is None:
        return ""
    return norm_text(row.get(f"H{lvl}_{lang}"))


def staged_note(row: dict[str, Any], lang: str) -> str:
    return norm_text(row.get(f"Notes_{lang}"))


def connect(dsn: str):
    try:
        import psycopg
    except ImportError:
        raise SystemExit('psycopg is not installed. Run: pip install "psycopg[binary]"')
    return psycopg.connect(dsn)


def fetch_import(cur, import_run_id: int):
    cur.execute(
        """
        SELECT
            r.source_row_number,
            r.source_key,
            r.row_data
        FROM vocab_workbench.import_rows r
        WHERE r.import_run_id = %s
        ORDER BY r.source_row_number
        """,
        (import_run_id,),
    )
    return cur.fetchall()


def fetch_concepts(cur):
    cur.execute(
        """
        SELECT
            concept_id,
            level,
            parent_id,
            en_label,
            id_key,
            is_active,
            sort_order
        FROM public.concepts_curated
        ORDER BY concept_id
        """
    )
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_labels(cur):
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
        ORDER BY concept_id, lang, label_id
        """
    )
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_notes(cur):
    cur.execute(
        """
        SELECT
            note_id,
            concept_id,
            lang,
            note_type,
            note,
            source,
            source_record,
            source_column,
            review_status,
            import_run_id
        FROM public.concept_notes_curated
        ORDER BY concept_id, lang, note_id
        """
    )
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def build_source(staged_rows):
    concept_occurrences: dict[str, list[dict[str, Any]]] = defaultdict(list)
    scheme_rows = []
    unresolved_rows = []

    for source_row_number, source_key, row_data in staged_rows:
        row = row_data if isinstance(row_data, dict) else json.loads(row_data)
        cid = clean(row.get("concept_id"))
        join_key = clean(row.get("join_key_norm"))

        wrapped = {
            "source_row_number": source_row_number,
            "source_key": source_key,
            "row": row,
        }

        if cid:
            concept_occurrences[cid].append(wrapped)
        elif join_key:
            unresolved_rows.append(wrapped)
        else:
            scheme_rows.append(wrapped)

    source_labels: dict[tuple[str, str], dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    source_notes: dict[tuple[str, str], dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    source_sort_orders: dict[str, list[int]] = defaultdict(list)

    for cid, occurrences in concept_occurrences.items():
        for item in occurrences:
            row = item["row"]
            source_row_number = item["source_row_number"]

            so = clean(row.get("sortOrder"))
            if so.isdigit():
                source_sort_orders[cid].append(int(so))

            for lang in LANGS:
                label = staged_label(row, lang)
                if label:
                    source_labels[(cid, lang)][label].append(source_row_number)

                note = staged_note(row, lang)
                if note:
                    source_notes[(cid, lang)][note].append(source_row_number)

    return {
        "concept_occurrences": concept_occurrences,
        "scheme_rows": scheme_rows,
        "unresolved_rows": unresolved_rows,
        "source_labels": source_labels,
        "source_notes": source_notes,
        "source_sort_orders": source_sort_orders,
    }


def analyse(source, concepts, labels, notes):
    concepts_by_id = {clean(c["concept_id"]): c for c in concepts}

    preferred_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    all_labels_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    for label in labels:
        cid = clean(label["concept_id"])
        lang = clean(label["lang"])
        if not cid or not lang:
            continue
        all_labels_by_key[(cid, lang)].append(label)
        if clean(label["status"]).casefold() == "preferred":
            preferred_by_key[(cid, lang)].append(label)

    scope_notes_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for note in notes:
        if clean(note["note_type"]).casefold() == "scopenote":
            scope_notes_by_key[(clean(note["concept_id"]), clean(note["lang"]))].append(note)

    report = {
        "counts": {},
        "source_conflicting_labels": [],
        "source_conflicting_notes": [],
        "missing_preferred_labels": [],
        "matching_preferred_labels": [],
        "different_existing_preferred_labels": [],
        "matching_nonpreferred_labels": [],
        "missing_scope_notes": [],
        "matching_scope_notes": [],
        "different_existing_scope_notes": [],
        "sort_order_to_fill": [],
        "sort_order_conflicts": [],
        "concepts_in_source_missing_from_database": [],
        "concepts_in_database_missing_from_source": [],
        "unresolved_source_rows": [],
        "scheme_rows": [],
    }

    source_ids = set(source["concept_occurrences"])
    db_ids = set(concepts_by_id)

    report["concepts_in_source_missing_from_database"] = sorted(source_ids - db_ids)
    report["concepts_in_database_missing_from_source"] = sorted(db_ids - source_ids)

    for item in source["unresolved_rows"]:
        row = item["row"]
        report["unresolved_source_rows"].append({
            "source_row_number": item["source_row_number"],
            "join_key_norm": clean(row.get("join_key_norm")),
            "H1_en": clean(row.get("H1_en")),
            "H2_en": clean(row.get("H2_en")),
            "H3_en": clean(row.get("H3_en")),
            "H4_en": clean(row.get("H4_en")),
        })

    for item in source["scheme_rows"]:
        row = item["row"]
        report["scheme_rows"].append({
            "source_row_number": item["source_row_number"],
            "labels": {lang: clean(row.get(f"L0_{lang}")) for lang in LANGS},
            "notes": {lang: clean(row.get(f"Notes_{lang}")) for lang in LANGS},
        })

    # Sort order
    for cid in sorted(source_ids & db_ids):
        orders = source["source_sort_orders"].get(cid, [])
        if not orders:
            continue
        proposed = min(orders)
        existing = concepts_by_id[cid].get("sort_order")
        if existing is None:
            report["sort_order_to_fill"].append({
                "concept_id": cid,
                "sort_order": proposed,
                "source_values": sorted(set(orders)),
            })
        elif int(existing) != proposed:
            report["sort_order_conflicts"].append({
                "concept_id": cid,
                "database_sort_order": int(existing),
                "source_sort_order": proposed,
                "source_values": sorted(set(orders)),
            })

    # Labels
    for (cid, lang), values_to_rows in sorted(source["source_labels"].items()):
        if cid not in db_ids:
            continue

        source_values = sorted(values_to_rows)
        if len(source_values) > 1:
            report["source_conflicting_labels"].append({
                "concept_id": cid,
                "lang": lang,
                "values": [
                    {"label": v, "source_rows": values_to_rows[v]}
                    for v in source_values
                ],
            })
            continue

        proposed = source_values[0]
        preferred = preferred_by_key.get((cid, lang), [])
        preferred_values = [norm_text(x["label"]) for x in preferred if norm_text(x["label"])]

        if any(norm_text(x) == proposed for x in preferred_values):
            report["matching_preferred_labels"].append({
                "concept_id": cid,
                "lang": lang,
                "label": proposed,
            })
            continue

        if preferred_values:
            report["different_existing_preferred_labels"].append({
                "concept_id": cid,
                "lang": lang,
                "source_label": proposed,
                "database_preferred_labels": preferred_values,
                "source_rows": values_to_rows[proposed],
            })
            continue

        nonpreferred_matches = [
            x for x in all_labels_by_key.get((cid, lang), [])
            if norm_text(x["label"]) == proposed
        ]
        if nonpreferred_matches:
            report["matching_nonpreferred_labels"].append({
                "concept_id": cid,
                "lang": lang,
                "label": proposed,
                "existing_statuses": sorted({
                    clean(x["status"]) for x in nonpreferred_matches
                }),
                "source_rows": values_to_rows[proposed],
            })

        report["missing_preferred_labels"].append({
            "concept_id": cid,
            "lang": lang,
            "label": proposed,
            "source_rows": values_to_rows[proposed],
        })

    # Notes
    for (cid, lang), values_to_rows in sorted(source["source_notes"].items()):
        if cid not in db_ids:
            continue

        source_values = sorted(values_to_rows)
        if len(source_values) > 1:
            report["source_conflicting_notes"].append({
                "concept_id": cid,
                "lang": lang,
                "values": [
                    {"note": v, "source_rows": values_to_rows[v]}
                    for v in source_values
                ],
            })
            continue

        proposed = source_values[0]
        existing_notes = scope_notes_by_key.get((cid, lang), [])
        existing_values = [norm_text(x["note"]) for x in existing_notes if norm_text(x["note"])]

        if any(v == proposed for v in existing_values):
            report["matching_scope_notes"].append({
                "concept_id": cid,
                "lang": lang,
                "note": proposed,
            })
        elif existing_values:
            report["different_existing_scope_notes"].append({
                "concept_id": cid,
                "lang": lang,
                "source_note": proposed,
                "database_scope_notes": existing_values,
                "source_rows": values_to_rows[proposed],
            })
        else:
            report["missing_scope_notes"].append({
                "concept_id": cid,
                "lang": lang,
                "note": proposed,
                "source_rows": values_to_rows[proposed],
            })

    report["counts"] = {
        "database_concepts": len(db_ids),
        "source_unique_concepts": len(source_ids),
        "source_concepts_missing_from_database": len(report["concepts_in_source_missing_from_database"]),
        "database_concepts_missing_from_source": len(report["concepts_in_database_missing_from_source"]),
        "source_conflicting_labels": len(report["source_conflicting_labels"]),
        "matching_preferred_labels": len(report["matching_preferred_labels"]),
        "different_existing_preferred_labels": len(report["different_existing_preferred_labels"]),
        "missing_preferred_labels": len(report["missing_preferred_labels"]),
        "source_conflicting_notes": len(report["source_conflicting_notes"]),
        "matching_scope_notes": len(report["matching_scope_notes"]),
        "different_existing_scope_notes": len(report["different_existing_scope_notes"]),
        "missing_scope_notes": len(report["missing_scope_notes"]),
        "sort_order_to_fill": len(report["sort_order_to_fill"]),
        "sort_order_conflicts": len(report["sort_order_conflicts"]),
        "unresolved_source_rows": len(report["unresolved_source_rows"]),
    }

    return report, concepts_by_id


def print_report(report):
    c = report["counts"]

    print("\nCAAL Site Types normalisation audit")
    print("=" * 64)
    for key, value in c.items():
        print(f"{key:42} {value}")

    print("\nDatabase concepts absent from staged multilingual source")
    if report["concepts_in_database_missing_from_source"]:
        for cid in report["concepts_in_database_missing_from_source"]:
            print(f"  {cid}")
    else:
        print("  none")

    print("\nSource label conflicts")
    if report["source_conflicting_labels"]:
        for item in report["source_conflicting_labels"]:
            print(f"  {item['concept_id']} [{item['lang']}]")
            for value in item["values"]:
                print(f"    {value['label']}  rows={value['source_rows']}")
    else:
        print("  none")

    print("\nExisting preferred-label differences")
    if report["different_existing_preferred_labels"]:
        for item in report["different_existing_preferred_labels"][:50]:
            print(
                f"  {item['concept_id']} [{item['lang']}]\n"
                f"    source:   {item['source_label']}\n"
                f"    database: {' | '.join(item['database_preferred_labels'])}"
            )
        if len(report["different_existing_preferred_labels"]) > 50:
            print(f"  ... {len(report['different_existing_preferred_labels']) - 50} more in JSON report")
    else:
        print("  none")

    print("\nExisting scope-note differences")
    if report["different_existing_scope_notes"]:
        for item in report["different_existing_scope_notes"][:20]:
            print(
                f"  {item['concept_id']} [{item['lang']}]\n"
                f"    source:   {item['source_note']}\n"
                f"    database: {' | '.join(item['database_scope_notes'])}"
            )
        if len(report["different_existing_scope_notes"]) > 20:
            print(f"  ... {len(report['different_existing_scope_notes']) - 20} more in JSON report")
    else:
        print("  none")


def next_numeric_label_ids(cur, count: int) -> list[str]:
    if count <= 0:
        return []

    # Prevent another writer from selecting the same next ID during this migration.
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


def apply_safe_changes(cur, report, concepts_by_id, import_run_id: int):
    changes = {
        "sort_orders_updated": 0,
        "preferred_labels_inserted": 0,
        "scope_notes_inserted": 0,
    }

    # Stable sort order: only fill NULL values.
    for item in report["sort_order_to_fill"]:
        cur.execute(
            """
            UPDATE public.concepts_curated
            SET sort_order = %s
            WHERE concept_id = %s
              AND sort_order IS NULL
            """,
            (item["sort_order"], item["concept_id"]),
        )
        changes["sort_orders_updated"] += cur.rowcount

    # Missing preferred labels only. Conflict rows were excluded by analyse().
    missing_labels = report["missing_preferred_labels"]
    label_ids = next_numeric_label_ids(cur, len(missing_labels))

    for label_id, item in zip(label_ids, missing_labels):
        cid = item["concept_id"]
        concept = concepts_by_id[cid]

        # Recheck within the transaction: do not insert if a preferred value has appeared.
        cur.execute(
            """
            SELECT label
            FROM public.labels_curated
            WHERE concept_id = %s
              AND lang = %s
              AND lower(COALESCE(status, '')) = 'preferred'
            """,
            (cid, item["lang"]),
        )
        if cur.fetchall():
            continue

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
                (%s, %s, %s, %s, 'preferred', %s, %s, %s, %s, NULL)
            """,
            (
                label_id,
                cid,
                item["lang"],
                item["label"],
                f"workbench_import_{import_run_id}",
                norm_key(item["label"]),
                clean(concept.get("level")) or None,
                clean(concept.get("en_label")) or None,
            ),
        )
        changes["preferred_labels_inserted"] += 1

    # Missing scope notes.
    for item in report["missing_scope_notes"]:
        cid = item["concept_id"]
        lang = item["lang"]

        cur.execute(
            """
            SELECT 1
            FROM public.concept_notes_curated
            WHERE concept_id = %s
              AND lang = %s
              AND lower(note_type) = 'scopenote'
            LIMIT 1
            """,
            (cid, lang),
        )
        if cur.fetchone():
            continue

        cur.execute(
            """
            INSERT INTO public.concept_notes_curated
                (
                    concept_id,
                    lang,
                    note_type,
                    note,
                    source,
                    source_record,
                    source_column,
                    review_status,
                    import_run_id
                )
            VALUES
                (%s, %s, 'scopeNote', %s, %s, %s, %s, 'unreviewed', %s)
            """,
            (
                cid,
                lang,
                item["note"],
                f"workbench_import_{import_run_id}",
                ",".join(str(x) for x in item["source_rows"]),
                f"Notes_{lang}",
                import_run_id,
            ),
        )
        changes["scope_notes_inserted"] += 1

    return changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import-run-id", type=int, default=1)
    ap.add_argument("--dsn", default="")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--report", default="site_types_normalisation_audit.json")
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

    with connect(dsn) as conn:
        with conn.cursor() as cur:
            staged = fetch_import(cur, args.import_run_id)
            if not staged:
                raise SystemExit(
                    f"No staged rows found for import_run_id={args.import_run_id}"
                )

            concepts = fetch_concepts(cur)
            labels = fetch_labels(cur)
            notes = fetch_notes(cur)

            source = build_source(staged)
            report, concepts_by_id = analyse(source, concepts, labels, notes)

            print_report(report)

            Path(args.report).write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"\nDetailed audit written to: {Path(args.report).resolve()}")

            if not args.write:
                conn.rollback()
                print("\nREAD-ONLY audit complete. No database changes made.")
                return

            changes = apply_safe_changes(
                cur,
                report,
                concepts_by_id,
                args.import_run_id,
            )
            conn.commit()

            print("\nSafe normalisation changes committed")
            print("=" * 64)
            for key, value in changes.items():
                print(f"{key:42} {value}")
            print("\nConflicting/different values were NOT changed.")


if __name__ == "__main__":
    main()
