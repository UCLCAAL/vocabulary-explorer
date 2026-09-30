#!/usr/bin/env python3
"""
Migrate CAAL Site Types ConceptScheme metadata from the preserved staged import
into authoritative PostgreSQL tables.

Default: AUDIT ONLY.
With --write:
- creates the scheme metadata tables if they do not already exist;
- upserts the Site Types scheme record;
- upserts multilingual scheme prefLabels;
- upserts multilingual scheme scopeNotes.

No concept, label, hierarchy, or monument-assignment data is changed.

Connection:
- --dsn takes precedence
- otherwise CAAL_DATABASE_URL
- otherwise DATABASE_URL
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

try:
    import psycopg
except ImportError as e:
    raise SystemExit('psycopg is not installed. Run: pip install "psycopg[binary]"') from e


LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]

VOCABULARY_CODE = "site-types"
SCHEME_URI = "https://vocab.uclcaal.org/scheme/site-types"
CONCEPT_URI_BASE = "https://vocab.uclcaal.org/concept/"


def lexical(value: Any) -> str:
    return "" if value is None else str(value).strip()


def load_scheme_row(cur, import_run_id: int) -> dict[str, Any]:
    cur.execute(
        """
        SELECT source_row_number, row_data
        FROM vocab_workbench.import_rows
        WHERE import_run_id = %s
        ORDER BY source_row_number
        """,
        (import_run_id,),
    )

    candidates = []
    for source_row_number, row_data in cur.fetchall():
        if not isinstance(row_data, dict):
            row_data = json.loads(row_data)

        concept_id = lexical(row_data.get("concept_id"))
        join_key = lexical(row_data.get("join_key_norm"))
        has_scheme_data = any(
            lexical(row_data.get(f"L0_{lang}")) or lexical(row_data.get(f"Notes_{lang}"))
            for lang in LANGS
        )

        if not concept_id and not join_key and has_scheme_data:
            candidates.append((source_row_number, row_data))

    if len(candidates) != 1:
        raise RuntimeError(
            f"Expected exactly one scheme metadata row for import_run_id={import_run_id}; "
            f"found {len(candidates)}"
        )

    source_row_number, row = candidates[0]
    return {"source_row_number": source_row_number, **row}


def expected_metadata(row: dict[str, Any]) -> dict[str, Any]:
    labels = {
        lang: lexical(row.get(f"L0_{lang}"))
        for lang in LANGS
        if lexical(row.get(f"L0_{lang}"))
    }
    notes = {
        lang: lexical(row.get(f"Notes_{lang}"))
        for lang in LANGS
        if lexical(row.get(f"Notes_{lang}"))
    }

    return {
        "vocabulary_code": VOCABULARY_CODE,
        "scheme_uri": SCHEME_URI,
        "concept_uri_base": CONCEPT_URI_BASE,
        "labels": labels,
        "scope_notes": notes,
    }


def table_exists(cur, qualified_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (qualified_name,))
    return cur.fetchone()[0] is not None


def read_current(cur) -> dict[str, Any] | None:
    if not table_exists(cur, "public.vocabulary_schemes"):
        return None
    if not table_exists(cur, "public.vocabulary_scheme_labels"):
        return None
    if not table_exists(cur, "public.vocabulary_scheme_notes"):
        return None

    cur.execute(
        """
        SELECT vocabulary_code, scheme_uri, concept_uri_base, is_active, source, import_run_id
        FROM public.vocabulary_schemes
        WHERE vocabulary_code = %s
        """,
        (VOCABULARY_CODE,),
    )
    scheme = cur.fetchone()
    if not scheme:
        return {
            "scheme": None,
            "labels": {},
            "scope_notes": {},
        }

    cur.execute(
        """
        SELECT lang, label
        FROM public.vocabulary_scheme_labels
        WHERE vocabulary_code = %s
        ORDER BY lang
        """,
        (VOCABULARY_CODE,),
    )
    labels = {lang: label for lang, label in cur.fetchall()}

    cur.execute(
        """
        SELECT lang, note
        FROM public.vocabulary_scheme_notes
        WHERE vocabulary_code = %s
          AND note_type = 'scopeNote'
        ORDER BY lang
        """,
        (VOCABULARY_CODE,),
    )
    notes = {lang: note for lang, note in cur.fetchall()}

    return {
        "scheme": {
            "vocabulary_code": scheme[0],
            "scheme_uri": scheme[1],
            "concept_uri_base": scheme[2],
            "is_active": scheme[3],
            "source": scheme[4],
            "import_run_id": scheme[5],
        },
        "labels": labels,
        "scope_notes": notes,
    }


def create_tables(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.vocabulary_schemes (
            vocabulary_code text PRIMARY KEY,
            scheme_uri text NOT NULL UNIQUE,
            concept_uri_base text NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            source text,
            import_run_id bigint
                REFERENCES vocab_workbench.import_runs(import_run_id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.vocabulary_scheme_labels (
            vocabulary_code text NOT NULL
                REFERENCES public.vocabulary_schemes(vocabulary_code)
                ON DELETE CASCADE,
            lang text NOT NULL,
            label text NOT NULL,
            source text,
            import_run_id bigint
                REFERENCES vocab_workbench.import_runs(import_run_id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (vocabulary_code, lang)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.vocabulary_scheme_notes (
            vocabulary_code text NOT NULL
                REFERENCES public.vocabulary_schemes(vocabulary_code)
                ON DELETE CASCADE,
            lang text NOT NULL,
            note_type text NOT NULL DEFAULT 'scopeNote',
            note text NOT NULL,
            source text,
            import_run_id bigint
                REFERENCES vocab_workbench.import_runs(import_run_id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (vocabulary_code, lang, note_type)
        )
        """
    )


def apply(cur, expected: dict[str, Any], import_run_id: int):
    source = f"published_scheme_import_{import_run_id}"

    cur.execute(
        """
        INSERT INTO public.vocabulary_schemes
            (
                vocabulary_code,
                scheme_uri,
                concept_uri_base,
                is_active,
                source,
                import_run_id
            )
        VALUES (%s, %s, %s, true, %s, %s)
        ON CONFLICT (vocabulary_code)
        DO UPDATE SET
            scheme_uri = EXCLUDED.scheme_uri,
            concept_uri_base = EXCLUDED.concept_uri_base,
            is_active = true,
            source = EXCLUDED.source,
            import_run_id = EXCLUDED.import_run_id,
            updated_at = now()
        """,
        (
            expected["vocabulary_code"],
            expected["scheme_uri"],
            expected["concept_uri_base"],
            source,
            import_run_id,
        ),
    )

    for lang, label in expected["labels"].items():
        cur.execute(
            """
            INSERT INTO public.vocabulary_scheme_labels
                (vocabulary_code, lang, label, source, import_run_id)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (vocabulary_code, lang)
            DO UPDATE SET
                label = EXCLUDED.label,
                source = EXCLUDED.source,
                import_run_id = EXCLUDED.import_run_id,
                updated_at = now()
            """,
            (
                expected["vocabulary_code"],
                lang,
                label,
                source,
                import_run_id,
            ),
        )

    for lang, note in expected["scope_notes"].items():
        cur.execute(
            """
            INSERT INTO public.vocabulary_scheme_notes
                (
                    vocabulary_code,
                    lang,
                    note_type,
                    note,
                    source,
                    import_run_id
                )
            VALUES (%s, %s, 'scopeNote', %s, %s, %s)
            ON CONFLICT (vocabulary_code, lang, note_type)
            DO UPDATE SET
                note = EXCLUDED.note,
                source = EXCLUDED.source,
                import_run_id = EXCLUDED.import_run_id,
                updated_at = now()
            """,
            (
                expected["vocabulary_code"],
                lang,
                note,
                source,
                import_run_id,
            ),
        )


def print_expected(expected, source_row_number):
    print("\nSite Types ConceptScheme metadata migration")
    print("=" * 68)
    print(f"Vocabulary code:      {expected['vocabulary_code']}")
    print(f"Scheme URI:           {expected['scheme_uri']}")
    print(f"Concept URI base:     {expected['concept_uri_base']}")
    print(f"Staged source row:    {source_row_number}")
    print(f"Scheme labels:        {len(expected['labels'])}")
    print(f"Scheme scope notes:   {len(expected['scope_notes'])}")

    print("\nLabels")
    for lang in LANGS:
        if lang in expected["labels"]:
            print(f"  {lang}: {expected['labels'][lang]}")

    print("\nScope notes")
    for lang in LANGS:
        if lang in expected["scope_notes"]:
            print(f"  {lang}: {expected['scope_notes'][lang]}")


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
            scheme_row = load_scheme_row(cur, args.import_run_id)
            expected = expected_metadata(scheme_row)

            print_expected(expected, scheme_row["source_row_number"])

            current = read_current(cur)
            if current is None:
                print("\nCurrent authoritative scheme tables: not yet created")
            else:
                print("\nCurrent authoritative scheme metadata")
                print(json.dumps(current, ensure_ascii=False, indent=2, default=str))

            if not args.write:
                conn.rollback()
                print("\nAUDIT ONLY. No database changes made.")
                return

            create_tables(cur)
            apply(cur, expected, args.import_run_id)
            conn.commit()

            print("\nMigration committed")
            print("=" * 68)
            print(f"vocabulary_schemes:       1")
            print(f"vocabulary_scheme_labels: {len(expected['labels'])}")
            print(f"vocabulary_scheme_notes:  {len(expected['scope_notes'])}")


if __name__ == "__main__":
    main()
