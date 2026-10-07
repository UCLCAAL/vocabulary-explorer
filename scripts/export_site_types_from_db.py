#!/usr/bin/env python3
"""
Export CAAL Site Types SKOS/RDF from authoritative PostgreSQL.

Curated mode reads:
  public.vocabulary_schemes
  public.vocabulary_scheme_labels
  public.vocabulary_scheme_notes
  public.concepts_curated
  public.labels_curated
  public.concept_notes_curated
  public.vocabulary_bibliographic_resources
  public.concept_bibliographic_links

Published mappings:
  preferred label        -> skos:prefLabel
  alternative label      -> skos:altLabel
  definition             -> skos:definition
  scope note             -> skos:scopeNote
  bibliography source    -> dcterms:source
  bibliography reference -> dcterms:references

Bibliographic resources are described with:
  rdf:type dcmitype:BibliographicResource
  dcterms:bibliographicCitation
  dcterms:identifier (DOI)
  dcterms:relation (additional linked URIs)

The workbench's concept/reference note remains editorial metadata in
PostgreSQL and is not published in RDF in this version.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import psycopg
except ImportError as e:
    raise SystemExit(
        'psycopg is not installed. Run: pip install "psycopg[binary]"'
    ) from e

try:
    from rdflib import Graph, Literal, Namespace, URIRef
    from rdflib.namespace import RDF, SKOS, OWL
except ImportError as e:
    raise SystemExit("rdflib is not installed. Run: pip install rdflib") from e


LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]
VOCABULARY_CODE = "site-types"

BASELINE_SCHEME_URI = URIRef("https://vocab.uclcaal.org/scheme/site-types")
BASELINE_CONCEPT_BASE = "https://vocab.uclcaal.org/concept/"

DCTERMS = Namespace("http://purl.org/dc/terms/")
DCMITYPE = Namespace("http://purl.org/dc/dcmitype/")
REFERENCE_BASE = "https://vocab.uclcaal.org/reference/"


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def is_active(value: Any) -> bool:
    s = clean(value).casefold()
    return s not in {"false", "0", "no", "inactive"}


def get_staged_rows(cur, import_run_id: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT source_row_number, row_data
        FROM vocab_workbench.import_rows
        WHERE import_run_id = %s
        ORDER BY source_row_number
        """,
        (import_run_id,),
    )

    out = []

    for source_row_number, row_data in cur.fetchall():
        if not isinstance(row_data, dict):
            row_data = json.loads(row_data)

        out.append({
            "source_row_number": source_row_number,
            **row_data,
        })

    return out


def get_staged_scheme_row(
    staged_rows: list[dict[str, Any]]
) -> dict[str, Any]:
    candidates = []

    for row in staged_rows:
        if clean(row.get("concept_id")):
            continue

        if clean(row.get("join_key_norm")):
            continue

        if any(
            clean(row.get(f"L0_{lang}"))
            or clean(row.get(f"Notes_{lang}"))
            for lang in LANGS
        ):
            candidates.append(row)

    if len(candidates) != 1:
        raise RuntimeError(
            f"Expected one staged ConceptScheme row; found {len(candidates)}"
        )

    return candidates[0]


def add_baseline_scheme_metadata(
    g: Graph,
    row: dict[str, Any]
) -> None:
    g.add((BASELINE_SCHEME_URI, RDF.type, SKOS.ConceptScheme))

    for lang in LANGS:
        label = clean(row.get(f"L0_{lang}"))

        if label:
            g.add((
                BASELINE_SCHEME_URI,
                SKOS.prefLabel,
                Literal(label, lang=lang),
            ))

        note = clean(row.get(f"Notes_{lang}"))

        if note:
            g.add((
                BASELINE_SCHEME_URI,
                SKOS.scopeNote,
                Literal(note, lang=lang),
            ))


def baseline_concept_uri(concept_id: str) -> URIRef:
    return URIRef(BASELINE_CONCEPT_BASE + concept_id)


def build_baseline_graph(
    staged_rows: list[dict[str, Any]]
) -> Graph:
    g = Graph()
    g.bind("skos", SKOS)

    add_baseline_scheme_metadata(
        g,
        get_staged_scheme_row(staged_rows),
    )

    concepts: dict[str, dict[str, Any]] = {}

    # Preserve legacy behaviour: last duplicate concept ID wins.
    for row in staged_rows:
        cid = clean(row.get("concept_id"))

        if cid:
            concepts[cid] = row

    included: set[str] = set()

    for cid, row in concepts.items():
        if not is_active(row.get("is_active")):
            continue

        included.add(cid)
        cu = baseline_concept_uri(cid)

        g.add((cu, RDF.type, SKOS.Concept))
        g.add((cu, SKOS.inScheme, BASELINE_SCHEME_URI))
        g.add((cu, SKOS.notation, Literal(cid)))

        level = clean(row.get("level_curated"))
        level_num = (
            int(level[1:])
            if level.startswith("L") and level[1:].isdigit()
            else None
        )

        for lang in LANGS:
            label = (
                clean(row.get(f"H{level_num}_{lang}"))
                if level_num is not None
                else ""
            )

            if not label and lang == "en":
                label = clean(row.get("en_label"))

            if label:
                g.add((
                    cu,
                    SKOS.prefLabel,
                    Literal(label, lang=lang),
                ))

        for lang in LANGS:
            note = clean(row.get(f"Notes_{lang}"))

            if note:
                g.add((
                    cu,
                    SKOS.scopeNote,
                    Literal(note, lang=lang),
                ))

    for cid, row in concepts.items():
        if cid not in included:
            continue

        cu = baseline_concept_uri(cid)
        parent = clean(row.get("parent_id"))

        if parent and parent in included:
            pu = baseline_concept_uri(parent)
            g.add((cu, SKOS.broader, pu))
            g.add((pu, SKOS.narrower, cu))

        elif not parent:
            g.add((
                BASELINE_SCHEME_URI,
                SKOS.hasTopConcept,
                cu,
            ))
            g.add((
                cu,
                SKOS.topConceptOf,
                BASELINE_SCHEME_URI,
            ))

    return g


def load_curated_scheme(cur):
    cur.execute(
        """
        SELECT scheme_uri, concept_uri_base
        FROM public.vocabulary_schemes
        WHERE vocabulary_code = %s
          AND is_active = true
        """,
        (VOCABULARY_CODE,),
    )

    row = cur.fetchone()

    if not row:
        raise RuntimeError(
            f"No active authoritative scheme metadata found for "
            f"{VOCABULARY_CODE!r}."
        )

    scheme_uri = URIRef(row[0])
    concept_base = row[1]

    cur.execute(
        """
        SELECT lang, label
        FROM public.vocabulary_scheme_labels
        WHERE vocabulary_code = %s
        ORDER BY lang
        """,
        (VOCABULARY_CODE,),
    )

    labels = [(lang, label) for lang, label in cur.fetchall()]

    cur.execute(
        """
        SELECT lang, note
        FROM public.vocabulary_scheme_notes
        WHERE vocabulary_code = %s
          AND lower(COALESCE(note_type, '')) = 'scopenote'
        ORDER BY lang
        """,
        (VOCABULARY_CODE,),
    )

    notes = [(lang, note) for lang, note in cur.fetchall()]

    return scheme_uri, concept_base, labels, notes


def bibliography_uri(row: dict[str, Any]) -> URIRef:
    caal_permalink = clean(row.get("caal_permalink"))
    doi = clean(row.get("doi"))
    zotero_uri = clean(row.get("zotero_uri"))
    external_uri = clean(row.get("external_uri"))

    if caal_permalink:
        return URIRef(caal_permalink)

    if doi:
        return URIRef("https://doi.org/" + quote(doi, safe="/():.-_"))

    if zotero_uri:
        return URIRef(zotero_uri)

    if external_uri:
        return URIRef(external_uri)

    return URIRef(
        REFERENCE_BASE + str(row["reference_id"])
    )


def build_curated_graph(cur) -> Graph:
    g = Graph()

    g.bind("skos", SKOS)
    g.bind("dcterms", DCTERMS)
    g.bind("dcmitype", DCMITYPE)

    (
        scheme_uri,
        concept_base,
        scheme_labels,
        scheme_notes,
    ) = load_curated_scheme(cur)

    g.add((scheme_uri, RDF.type, SKOS.ConceptScheme))

    for lang, label in scheme_labels:
        if clean(label):
            g.add((
                scheme_uri,
                SKOS.prefLabel,
                Literal(label, lang=clean(lang)),
            ))

    for lang, note in scheme_notes:
        if clean(note):
            g.add((
                scheme_uri,
                SKOS.scopeNote,
                Literal(note, lang=clean(lang)),
            ))

    cur.execute(
        """
        SELECT
            concept_id,
            parent_id,
            level,
            en_label,
            is_active,
            sort_order,
            lifecycle_status,
            replaced_by_concept_id
        FROM public.concepts_curated
        WHERE sort_order IS NOT NULL
          AND (lifecycle_status = 'retired' OR lower(
                COALESCE(
                    NULLIF(btrim(is_active), ''),
                    'true'
                )
              ) NOT IN ('false', '0', 'no', 'inactive'))
        ORDER BY sort_order, concept_id
        """
    )

    concepts = {}

    for (
        concept_id,
        parent_id,
        level,
        en_label,
        active,
        sort_order,
        lifecycle_status,
        replaced_by_concept_id,
    ) in cur.fetchall():
        concepts[concept_id] = {
            "concept_id": concept_id,
            "parent_id": parent_id,
            "level": level,
            "en_label": en_label,
            "sort_order": sort_order,
            "lifecycle_status": lifecycle_status,
            "replaced_by_concept_id": replaced_by_concept_id,
        }

    included = set(concepts)

    cur.execute(
        """
        SELECT
            concept_id,
            lang,
            label,
            status,
            label_id
        FROM public.labels_curated
        WHERE concept_id IS NOT NULL
          AND lang IS NOT NULL
          AND label IS NOT NULL
          AND lower(COALESCE(status, ''))
              IN ('preferred', 'alt')
        ORDER BY concept_id, lang, status, label_id
        """
    )

    preferred: dict[tuple[str, str], list[str]] = {}
    alternatives: dict[tuple[str, str], list[str]] = {}
    skipped_unassigned_alt_labels = 0

    for cid, lang, label, status, label_id in cur.fetchall():
        cid = clean(cid)
        lang = clean(lang)
        value = clean(label)
        status_key = clean(status).casefold()

        if cid not in included or not value:
            continue

        if status_key == "preferred":
            if lang in LANGS:
                preferred.setdefault((cid, lang), []).append(value)

        elif status_key == "alt":
            if lang in LANGS:
                alternatives.setdefault((cid, lang), []).append(value)
            else:
                skipped_unassigned_alt_labels += 1

    cur.execute(
        """
        SELECT
            concept_id,
            lang,
            note_type,
            note
        FROM public.concept_notes_curated
        WHERE lower(COALESCE(note_type, ''))
              IN ('definition', 'scopenote')
          AND concept_id IS NOT NULL
          AND lang IS NOT NULL
          AND note IS NOT NULL
        ORDER BY concept_id, lang, note_type, note_id
        """
    )

    notes: dict[
        tuple[str, str, str],
        list[str]
    ] = {}

    for cid, lang, note_type, note in cur.fetchall():
        cid = clean(cid)
        lang = clean(lang)
        note_type = clean(note_type).casefold()
        note = clean(note)

        if cid not in included or lang not in LANGS or not note:
            continue

        notes.setdefault(
            (cid, lang, note_type),
            [],
        ).append(note)

    cur.execute(
        """
        SELECT
            l.concept_id,
            l.relation_type,
            l.note AS link_note,
            r.reference_id,
            r.citation,
            r.caal_permalink,
            r.doi,
            r.zotero_uri,
            r.external_uri
        FROM public.concept_bibliographic_links l
        JOIN public.vocabulary_bibliographic_resources r
          ON r.reference_id = l.reference_id
        WHERE l.vocabulary_code = %s
        ORDER BY
            l.concept_id,
            COALESCE(l.sort_order, 2147483647),
            l.link_id
        """,
        (VOCABULARY_CODE,),
    )

    bibliography_links: list[dict[str, Any]] = []

    for row in cur.fetchall():
        (
            cid,
            relation_type,
            link_note,
            reference_id,
            citation,
            caal_permalink,
            doi,
            zotero_uri,
            external_uri,
        ) = row

        cid = clean(cid)

        if cid not in included:
            continue

        relation_type = clean(relation_type)

        if relation_type not in {"source", "reference"}:
            raise RuntimeError(
                f"Unsupported bibliography relation_type "
                f"{relation_type!r} for concept {cid}"
            )

        bibliography_links.append({
            "concept_id": cid,
            "relation_type": relation_type,
            "link_note": clean(link_note),
            "reference_id": reference_id,
            "citation": clean(citation),
            "caal_permalink": clean(caal_permalink),
            "doi": clean(doi),
            "zotero_uri": clean(zotero_uri),
            "external_uri": clean(external_uri),
        })

    def concept_uri(cid: str) -> URIRef:
        return URIRef(concept_base + cid)

    for cid, row in concepts.items():
        cu = concept_uri(cid)

        g.add((cu, RDF.type, SKOS.Concept))
        g.add((cu, SKOS.inScheme, scheme_uri))
        g.add((cu, SKOS.notation, Literal(cid)))

        for lang in LANGS:
            for value in preferred.get((cid, lang), []):
                if value:
                    g.add((
                        cu,
                        SKOS.prefLabel,
                        Literal(value, lang=lang),
                    ))

            for value in alternatives.get((cid, lang), []):
                if value:
                    g.add((
                        cu,
                        SKOS.altLabel,
                        Literal(value, lang=lang),
                    ))

            for value in notes.get(
                (cid, lang, "definition"),
                [],
            ):
                if value:
                    g.add((
                        cu,
                        SKOS.definition,
                        Literal(value, lang=lang),
                    ))

            for value in notes.get(
                (cid, lang, "scopenote"),
                [],
            ):
                if value:
                    g.add((
                        cu,
                        SKOS.scopeNote,
                        Literal(value, lang=lang),
                    ))

        if row.get("lifecycle_status") == "retired":
            g.add((cu, OWL.deprecated, Literal(True)))
            replacement = clean(row.get("replaced_by_concept_id"))
            if replacement:
                g.add((cu, DCTERMS.isReplacedBy, concept_uri(replacement)))
            continue

        parent = clean(row.get("parent_id"))

        if parent and parent in included:
            pu = concept_uri(parent)
            g.add((cu, SKOS.broader, pu))
            g.add((pu, SKOS.narrower, cu))

        elif not parent:
            g.add((scheme_uri, SKOS.hasTopConcept, cu))
            g.add((cu, SKOS.topConceptOf, scheme_uri))

    cur.execute("""
        SELECT concept_id, deleted_snapshot FROM vocab_workbench.concept_id_registry
        WHERE deleted_at IS NOT NULL ORDER BY concept_id
    """)
    for deleted_id, deleted in cur.fetchall():
        deleted = deleted or {}
        cu = concept_uri(deleted_id)
        g.add((cu, RDF.type, SKOS.Concept))
        g.add((cu, SKOS.inScheme, scheme_uri))
        g.add((cu, SKOS.notation, Literal(deleted_id)))
        g.add((cu, OWL.deprecated, Literal(True)))
        g.add((cu, DCTERMS.description, Literal("Deleted from the active CAAL vocabulary.", lang="en")))
        replacement = clean((deleted.get("concept") or {}).get("replaced_by_concept_id"))
        if replacement:
            g.add((cu, DCTERMS.isReplacedBy, concept_uri(replacement)))
        for label in deleted.get("labels", []):
            if clean(label.get("label")) and clean(label.get("lang")):
                predicate = SKOS.prefLabel if clean(label.get("status")).lower() == "preferred" else SKOS.altLabel
                g.add((cu, predicate, Literal(label["label"], lang=label["lang"])))

    emitted_references: set[int] = set()

    for link in bibliography_links:
        cu = concept_uri(link["concept_id"])
        ref_uri = bibliography_uri(link)

        if link["relation_type"] == "source":
            g.add((cu, DCTERMS.source, ref_uri))
        else:
            g.add((cu, DCTERMS.references, ref_uri))

        reference_id = int(link["reference_id"])

        if reference_id in emitted_references:
            continue

        emitted_references.add(reference_id)

        g.add((
            ref_uri,
            RDF.type,
            DCMITYPE.BibliographicResource,
        ))

        citation = link["citation"]

        if citation:
            g.add((
                ref_uri,
                DCTERMS.bibliographicCitation,
                Literal(citation),
            ))

        doi = link["doi"]

        if doi:
            g.add((
                ref_uri,
                DCTERMS.identifier,
                Literal(doi),
            ))

        for related_uri in [
            link["caal_permalink"],
            (
                "https://doi.org/"
                + quote(doi, safe="/():.-_")
                if doi
                else ""
            ),
            link["zotero_uri"],
            link["external_uri"],
        ]:
            related_uri = clean(related_uri)

            if related_uri and related_uri != str(ref_uri):
                g.add((
                    ref_uri,
                    DCTERMS.relation,
                    URIRef(related_uri),
                ))

    # Used only in graph_summary() output.
    g._caal_skipped_unassigned_alt_labels = (
        skipped_unassigned_alt_labels
    )

    return g


def graph_summary(g: Graph) -> dict[str, Any]:
    concepts = set(g.subjects(RDF.type, SKOS.Concept))
    schemes = set(g.subjects(RDF.type, SKOS.ConceptScheme))
    bibliography_resources = set(
        g.subjects(
            RDF.type,
            DCMITYPE.BibliographicResource,
        )
    )

    pref_langs = Counter()

    for _, _, obj in g.triples((None, SKOS.prefLabel, None)):
        pref_langs[obj.language or ""] += 1

    alt_langs = Counter()

    for _, _, obj in g.triples((None, SKOS.altLabel, None)):
        alt_langs[obj.language or ""] += 1

    scope_note_langs = Counter()

    for _, _, obj in g.triples((None, SKOS.scopeNote, None)):
        scope_note_langs[obj.language or ""] += 1

    definition_langs = Counter()

    for _, _, obj in g.triples((None, SKOS.definition, None)):
        definition_langs[obj.language or ""] += 1

    return {
        "triples": len(g),
        "concepts": len(concepts),
        "schemes": len(schemes),
        "pref_labels": sum(pref_langs.values()),
        "pref_labels_by_lang": dict(sorted(pref_langs.items())),
        "alt_labels": sum(alt_langs.values()),
        "alt_labels_by_lang": dict(sorted(alt_langs.items())),
        "alt_labels_skipped_unassigned": int(
            getattr(
                g,
                "_caal_skipped_unassigned_alt_labels",
                0,
            )
        ),
        "scope_notes": sum(scope_note_langs.values()),
        "scope_notes_by_lang": dict(
            sorted(scope_note_langs.items())
        ),
        "definitions": sum(definition_langs.values()),
        "definitions_by_lang": dict(
            sorted(definition_langs.items())
        ),
        "broader": sum(
            1
            for _ in g.triples(
                (None, SKOS.broader, None)
            )
        ),
        "narrower": sum(
            1
            for _ in g.triples(
                (None, SKOS.narrower, None)
            )
        ),
        "topConceptOf": sum(
            1
            for _ in g.triples(
                (None, SKOS.topConceptOf, None)
            )
        ),
        "hasTopConcept": sum(
            1
            for _ in g.triples(
                (None, SKOS.hasTopConcept, None)
            )
        ),
        "notations": sum(
            1
            for _ in g.triples(
                (None, SKOS.notation, None)
            )
        ),
        "bibliographic_resources": len(
            bibliography_resources
        ),
        "bibliography_sources": sum(
            1
            for _ in g.triples(
                (None, DCTERMS.source, None)
            )
        ),
        "bibliography_references": sum(
            1
            for _ in g.triples(
                (None, DCTERMS.references, None)
            )
        ),
    }


def term_text(term) -> str:
    if isinstance(term, URIRef):
        return f"<{term}>"

    return term.n3()


def triple_text(t) -> str:
    s, p, o = t
    return (
        f"{term_text(s)} "
        f"{term_text(p)} "
        f"{term_text(o)}"
    )


def compare_graphs(
    generated: Graph,
    reference_path: Path,
    max_examples: int,
) -> bool:
    reference = Graph()
    reference.parse(str(reference_path))

    generated_set = set(generated)
    reference_set = set(reference)

    missing = sorted(
        reference_set - generated_set,
        key=lambda t: tuple(map(str, t)),
    )

    extra = sorted(
        generated_set - reference_set,
        key=lambda t: tuple(map(str, t)),
    )

    print("\nReference graph summary")
    print("-" * 64)

    for k, v in graph_summary(reference).items():
        print(f"{k:32} {v}")

    print("\nGraph comparison")
    print("-" * 64)
    print(f"Reference triples:  {len(reference_set)}")
    print(f"Generated triples:  {len(generated_set)}")
    print(f"Missing triples:    {len(missing)}")
    print(f"Extra triples:      {len(extra)}")
    print(
        f"Graph equivalent:   "
        f"{'YES' if not missing and not extra else 'NO'}"
    )

    if missing:
        print(
            f"\nFirst {min(max_examples, len(missing))} "
            f"triples missing from generated graph:"
        )

        for t in missing[:max_examples]:
            print("  -", triple_text(t))

    if extra:
        print(
            f"\nFirst {min(max_examples, len(extra))} "
            f"extra generated triples:"
        )

        for t in extra[:max_examples]:
            print("  +", triple_text(t))

    return not missing and not extra


def main() -> int:
    ap = argparse.ArgumentParser()

    ap.add_argument(
        "--mode",
        choices=["baseline", "curated"],
        default="curated",
    )

    ap.add_argument(
        "--import-run-id",
        type=int,
        default=1,
        help="Used only by baseline mode",
    )

    ap.add_argument("--output", required=True)
    ap.add_argument("--compare")
    ap.add_argument("--summary-json")
    ap.add_argument("--dsn", default="")
    ap.add_argument(
        "--max-diff-examples",
        type=int,
        default=30,
    )

    args = ap.parse_args()

    dsn = (
        args.dsn
        or os.environ.get("CAAL_DATABASE_URL", "")
        or os.environ.get("DATABASE_URL", "")
    )

    if not dsn:
        raise SystemExit(
            "No PostgreSQL connection supplied. "
            "Use --dsn or set CAAL_DATABASE_URL."
        )

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            if args.mode == "baseline":
                staged_rows = get_staged_rows(
                    cur,
                    args.import_run_id,
                )

                if not staged_rows:
                    raise SystemExit(
                        f"No staged source rows found for "
                        f"import_run_id={args.import_run_id}"
                    )

                graph = build_baseline_graph(staged_rows)

            else:
                graph = build_curated_graph(cur)

    output = Path(args.output).resolve()
    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    graph.serialize(
        destination=str(output),
        format="pretty-xml",
    )

    summary = graph_summary(graph)

    print(f"\nWrote: {output}")
    print(f"Mode:  {args.mode}")

    print("\nGenerated graph summary")
    print("-" * 64)

    for k, v in summary.items():
        print(f"{k:32} {v}")

    if args.summary_json:
        summary_path = Path(args.summary_json).resolve()
        summary_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        summary_path.write_text(
            json.dumps(
                summary,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        print(f"\nSummary JSON: {summary_path}")

    if args.compare:
        reference_path = Path(
            args.compare
        ).resolve()

        if not reference_path.exists():
            raise SystemExit(
                f"Reference RDF not found: "
                f"{reference_path}"
            )

        equivalent = compare_graphs(
            graph,
            reference_path,
            args.max_diff_examples,
        )

        return 0 if equivalent else 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
