#!/usr/bin/env python3
r"""
2_make_skos_wide_thesaurus.py

PART 2 of the wide-thesaurus SKOS workflow.

Converts a sparse and "wide" hierarchy CSV (one row per concept, many hierarchy and language columns)
into a SKOS RDF/XML file.

Designed for CSVs from output of 1_clean_merge_thesaurus.py

- Each row with a concept_id becomes a skos:Concept.
- A single header-type row (no concept_id) carries scheme metadata (L0_* + Notes_*).
- prefLabel is from level_curated: "L1", "L2", "L3", "L4" to select which H{level}_* column

Usage: 
python 2_make_skos_wide_thesaurus.py --input .\site_types_3_1_interim_MERGED.csv --output caal_site_types_wide.rdf --base "https://caal.example.org/concept" --scheme "https://caal.example.org/scheme/site-types"

Output
------
RDF/XML (.rdf) with:
  - skos:ConceptScheme
  - skos:Concepts with skos:prefLabel (multilingual), skos:broader/narrower
  - skos:hasTopConcept / skos:topConceptOf links
"""

import argparse
import csv
import re
from typing import Dict, List, Optional, Tuple

from rdflib import Graph, URIRef, Literal, Namespace
from rdflib.namespace import RDF, RDFS, SKOS, XSD


# placeholders, override in run command
DEFAULT_BASE = "https://caal.example.org/concept/"
DEFAULT_SCHEME = "https://caal.example.org/scheme/site-types"


# overkill to make sure true/false boolean is normalised
def norm_bool(val: Optional[str]) -> Optional[bool]:
    if val is None:
        return None
    s = str(val).strip().lower()
    if s == "":
        return None
    if s in ("true", "t", "1", "yes", "y"):
        return True
    if s in ("false", "f", "0", "no", "n"):
        return False
    return None


def concept_uri(base: str, concept_id: str) -> URIRef:
    """
    Build the full URI for a concept from the base URI + concept_id.

    Example:
      base="https://uclcaal.org/concept"
      concept_id="MT-2-0086"
      -> https://uclcaal.org/concept/MT-2-0086

    Base needs to be stable long-term
    """
    return URIRef(base.rstrip("/") + "/" + concept_id.strip())


def parse_level_num(level_curated: str) -> Optional[int]:
    """
    Convert 'L1' -> 1, 'L2' -> 2, etc or None if missing
    Used to decide which hier level contains the prefLabel for the row
    """
    if not level_curated:
        return None
    m = re.match(r"^\s*L(\d+)\s*$", str(level_curated))
    if not m:
        return None
    return int(m.group(1))


def detect_langs_from_header(fieldnames: List[str]) -> List[str]:
    """
    Detect languages from columns like H1_en, H2_ru, Notes_zh, L0_kk, etc in stable order
    Script generic so can add a new language column
    """
    langs: List[str] = []
    seen = set()
    patterns = (r"^H\d+_([a-z]{2,3})$", r"^Notes_([a-z]{2,3})$", r"^L0_([a-z]{2,3})$")
    for fn in fieldnames:
        for pat in patterns:
            m = re.match(pat, fn)
            if m:
                lang = m.group(1)
                if lang not in seen:
                    seen.add(lang)
                    langs.append(lang)
    # If nothing detected, default to English
    return langs or ["en"]


def get_scheme_labels(rows: List[Dict[str, str]], langs: List[str]) -> Dict[str, str]:
    """
    Pulls scheme labels from L0_ columns - first row contains L0_ values but no concept_id
    Fall back to 'CAAL Site Types' in English only
    """
    for row in rows:
        cid = (row.get("concept_id") or "").strip()
        if cid:
            continue
        labels = {}
        for lang in langs:
            v = (row.get(f"L0_{lang}") or "").strip()
            if v:
                labels[lang] = v
        if labels:
            return labels
    return {"en": "CAAL Site Types"}

def get_scheme_notes(rows: List[Dict[str, str]], langs: List[str]) -> Dict[str, str]:
    """
    Pull scheme-level notes by lang from the first row where concept_id is blank.
    """
    for row in rows:
        cid = (row.get("concept_id") or "").strip()
        if cid:
            continue
        notes = {}
        for lang in langs:
            v = (row.get(f"Notes_{lang}") or "").strip()
            if v:
                notes[lang] = v
        if notes:
            return notes
    return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to wide thesaurus CSV")
    ap.add_argument("--output", default="caal_site_types.rdf", help="Output RDF/XML filename")
    ap.add_argument("--base", default=DEFAULT_BASE, help="Base URI for concept identifiers")
    ap.add_argument("--scheme", default=DEFAULT_SCHEME, help="URI for the ConceptScheme")
    ap.add_argument(
        "--include-inactive",
        action="store_true",
        help="Include concepts where is_active is false (default: skip inactive if is_active present)",
    )
    ap.add_argument(
        "--notes-as",
        choices=["scopeNote", "note"],
        default="scopeNote",
        help="Which SKOS property to use for Notes_* columns",
    )
    args = ap.parse_args()

    # ----------------------------
    # Load CSV
     # DictReader yields each row as dict column_name -> string value, header to find langs
    with open(args.input, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        fieldnames = r.fieldnames or []
        langs = detect_langs_from_header(fieldnames)
        rows = list(r)

    # ----------------------------
    # Build RDF graph + add the ConceptScheme
    g = Graph()
    g.bind("skos", SKOS)

    scheme_uri = URIRef(args.scheme)
    g.add((scheme_uri, RDF.type, SKOS.ConceptScheme))

    # to generate our own predicates in triples (non-SKOS)
    CAAL = Namespace("https://vocab.uclcaal.org/ns/")  # need to pick a stable namespace
    g.bind("caal", CAAL)

    # Labels for CAAL-specific properties so applications such as Skosmos
    # can display them with human-readable names.
    g.add((CAAL.dateRangeLabel, RDF.type, RDF.Property))
    g.add((CAAL.dateRangeLabel, RDFS.label, Literal("Date range", lang="en")))
    g.add((
        CAAL.dateRangeLabel,
        RDFS.comment,
        Literal("Human-readable chronological range used by CAAL.", lang="en")
    ))

    # Scheme title(s) as skos:prefLabel
    scheme_labels = get_scheme_labels(rows, langs)
    for lang, label in scheme_labels.items():
        g.add((scheme_uri, SKOS.prefLabel, Literal(label, lang=lang)))

    # Scheme descriptions as skos:scopeNote   
    scheme_notes = get_scheme_notes(rows, langs)
    for lang, note in scheme_notes.items():
        g.add((scheme_uri, SKOS.scopeNote, Literal(note, lang=lang)))

    # Safe getter for option columns, returns blank if col is missing or value is blank
    def get_cell(row: Dict[str, str], col: str) -> str:
        v = row.get(col)
        return "" if v is None else str(v).strip()

    # ----------------------------
    # Index concepts
    # Only rows with a concept_id are concepts
    concepts: Dict[str, Dict[str, str]] = {}
    for row in rows:
        cid = (row.get("concept_id") or "").strip()
        if not cid:
            continue
        concepts[cid] = row

    # ----------------------------
    # Create nodes + labels + notes per concept
    # switch between scopeNote and note from CLI
    notes_pred = SKOS.scopeNote if args.notes_as == "scopeNote" else SKOS.note

    for cid, row in concepts.items():
        cu = concept_uri(args.base, cid)

        # Skip inactive concepts (from is_active)
        active = norm_bool(row.get("is_active"))
        if active is False and not args.include_inactive:
            continue

        # Core SKOS wiring for each concept
        g.add((cu, RDF.type, SKOS.Concept))
        g.add((cu, SKOS.inScheme, scheme_uri))
        g.add((cu, SKOS.notation, Literal(cid))) # helpful for audits + stable IDs

        # determine which hier level
        level_num = parse_level_num(row.get("level_curated") or "")
        if level_num is None:
            # If missing, fall back to en_label where present
            level_num = None

        # Preferred labels per language:
        # e.g. for L2 concept, use H2_en, H2_ru, ... 
        for lang in langs:
            label = ""
            if level_num is not None:
                label = (row.get(f"H{level_num}_{lang}") or "").strip()
            if not label:
                # fallback: en_label
                if lang == "en":
                    label = (row.get("en_label") or "").strip()
            if label:
                g.add((cu, SKOS.prefLabel, Literal(label, lang=lang)))

        # Concept notes per language
        for lang in langs:
            note = (row.get(f"Notes_{lang}") or "").strip()
            if note:
                g.add((cu, notes_pred, Literal(note, lang=lang)))

        # Optional date metadata (emitted only if these columns exist and are populated)
        date_range = get_cell(row, "date_range")
        date_from = get_cell(row, "date_from")
        date_to = get_cell(row, "date_to")

        if date_range:
            g.add((cu, CAAL.dateRangeLabel, Literal(date_range)))

        if date_from:
            try:
                g.add((cu, CAAL.startYear, Literal(int(date_from), datatype=XSD.integer)))
            except ValueError:
                pass

        if date_to:
            try:
                g.add((cu, CAAL.endYear, Literal(int(date_to), datatype=XSD.integer)))
            except ValueError:
                pass

    # ----------------------------
    # Hierarchy + top concepts
    # Only create links for concepts actually included (respects inactive skipping)
    included = set()
    for cid, row in concepts.items():
        active = norm_bool(row.get("is_active"))
        if active is False and not args.include_inactive:
            continue
        included.add(cid)

    # Emit skos:broader/skos:narrower edges, plus scheme-level top concept links.
    for cid, row in concepts.items():
        if cid not in included:
            continue

        cu = concept_uri(args.base, cid)
        parent = (row.get("parent_id") or "").strip()

        if parent and parent in included:
            pu = concept_uri(args.base, parent)
            g.add((cu, SKOS.broader, pu))
            g.add((pu, SKOS.narrower, cu))
        elif not parent:
            # means its a topConcept
            g.add((scheme_uri, SKOS.hasTopConcept, cu))
            g.add((cu, SKOS.topConceptOf, scheme_uri))
        else:
            # parent is present but missing (or excluded). Keep concept but do not link
            # This avoids dangling URIs in the hierarchy
            pass

    # ----------------------------
    # Write RDF/XML
    g.serialize(args.output, format="pretty-xml")

    # console summary
    print(f"Wrote {args.output}")
    print(f"Concept rows read: {len(concepts)}")
    print(f"Concepts included (after is_active filter): {len(included)}")
    print(f"Languages detected: {', '.join(langs)}")
    print(f"Scheme labels: {scheme_labels}")


if __name__ == "__main__":
    main()
