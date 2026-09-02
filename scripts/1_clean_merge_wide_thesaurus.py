#!/usr/bin/env python3
"""
1_clean_merge_thesaurus.py

PART 1 of the wide-thesaurus SKOS workflow.

Clean a sparse "wide" interim thesaurus CSV (where the hierarchy
columns are NOT repeated on every row), which requires human readability, and 
reconstructs the full hierarchy on each row (carry-forward), and then 
merges in curated concept metadata from concepts_curated.csv.

Join key matches concepts_curated.id_key format:
  L{level}|{child_en_label}|{parent_en_label_or_NA}
(child first, parent last)

Usage (Terminal):
  python 1_clean_merge_thesaurus.py site_types_3_1_interim.csv concepts_curated.csv out.csv

Outputs:
- out.csv (cleaned + mergedwide CSV where each row as Hierarchy blocks filled and concept data)
- audit_missing_concepts_after_merge.csv (no matches to concepts_curated)
- audit_curated_duplicate_id_keys.csv (duplicated concept keys)
- audit_fallback_candidates.csv 
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd

# langauges expected
# - how many columns each hierarchy "block" has (8)
# - canonical column names (H1_en..H1_uz etc.)
LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]


# ----------------------------
# Normalisation helpers
# ----------------------------

# trim and collapse whitespace to make matching stable
def norm_whitespace(s: str) -> str:
    s = "" if s is None else str(s)
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    return s

# trim whitespace and remove spaces around slashes
def norm_label(s: str) -> str:
    s = norm_whitespace(s)
    if not s:
        return ""
    s = re.sub(r"\s*/\s*", "/", s)
    return s

# Normalise id_key-like string "L2|Child|Parent" by normalising child and parent
# id_key is bridge between site types spreadsheet and concepts_curated.csv
def norm_id_key(key: str) -> str:
    key = norm_whitespace(key)
    if not key:
        return ""
    parts = key.split("|")
    if len(parts) != 3:
        return key
    lvl = norm_whitespace(parts[0])
    child = norm_label(parts[1])
    parent = norm_label(parts[2])
    return f"{lvl}|{child}|{parent}"


# ----------------------------
# Site type thesaurus parsing by position
# ----------------------------
def canonical_headers_for_interim() -> List[str]:
    """
    Defines the index position of the fields expected from the site type spreadsheet:

    L0 block (site types): 8 cols:
      L0_en..L0_uz

    H1..H4 blocks: each 8 cols:
      Hn_en..Hn_uz

    Notes block: 8 cols:
      Notes_en..Notes_uz

    Trailing: 3 cols:
      trail_uk, trail_russian, trail_chinese

    Total = 51
    Any extra columns beyond 51 are treated as extra_* and dropped if empty
    """
    cols: List[str] = []
    cols += [f"L0_{l}" for l in LANGS]
    for h in range(1, 5):
        cols += [f"H{h}_{l}" for l in LANGS]
    cols += [f"Notes_{l}" for l in LANGS]
    cols += ["trail_uk", "trail_russian", "trail_chinese"]
    return cols


def read_interim(path: str) -> pd.DataFrame:
    """
    Loads thesaurus spreadsheet and enforces header names
    Will fail if less than 51 columns
    """
    df = pd.read_csv(path, dtype=str, keep_default_na=False)

    canonical = canonical_headers_for_interim()
    needed = len(canonical)
    n = df.shape[1]

    if n < needed:
        raise ValueError(
            f"Interim file has {n} columns, but expected at least {needed}. "
            "Make sure you are pointing at the wide interim CSV."
        )

    # Rename first 51 columns to canonical, keep extras if any
    new_cols = canonical + [f"extra_{i}" for i in range(needed + 1, n + 1)]
    df.columns = new_cols[:n]

    # Drop trailing extra columns that are entirely empty
    extra_cols = [c for c in df.columns if c.startswith("extra_")]
    for c in extra_cols:
        if (df[c].astype(str).map(norm_whitespace) == "").all():
            df = df.drop(columns=[c])

    return df


# ----------------------------
#  Hierarchy carry-forward
# ----------------------------
def block_cols(level: int) -> List[str]:
    """
    Return the 8 language columns for a hierarchy level block.
    level: 0 for L0, 1..4 for H1..H4
    """
    prefix = "L0" if level == 0 else f"H{level}"
    return [f"{prefix}_{l}" for l in LANGS]


def clear_block(row: pd.Series, level: int) -> None:
    """
    Blank out entire hierarchy block for a given level 
    Clears deeper levels to avoid carrying forward stale hierarchy values
    """
    for c in block_cols(level):
        row[c] = ""


def set_block_from_row(state: Dict[int, Dict[str, str]], row: pd.Series, level: int) -> None:
    """
    Update state for a block if the English label is present in row.
    EN values are normalised (norm_label) to stabilise matching, non-EN only get whitespace normalisation
    """
    en_col = ("L0_en" if level == 0 else f"H{level}_en")
    if norm_label(row.get(en_col, "")) == "":
        return

    # Store normalised values for matching stability.
    state[level] = {c: norm_label(row.get(c, "")) if c.endswith("_en") else norm_whitespace(row.get(c, ""))
                    for c in block_cols(level)}


def fill_row_from_state(state: Dict[int, Dict[str, str]], row: pd.Series, level: int) -> None:
    """
    This turns the sparse hierarchy into a full format
    If row block is blank (by EN), fill all 8 language columns from current state
    """
    en_col = ("L0_en" if level == 0 else f"H{level}_en")
    if norm_label(row.get(en_col, "")) != "":
        return
    if level not in state:
        return
    for c in block_cols(level):
        row[c] = state[level].get(c, "")


def apply_sparse_hierarchy_context(df: pd.DataFrame) -> pd.DataFrame:
    """
    Critical step: carry-forward missing hier values from last seen at each level so each row filled consistently
    """
    df = df.copy()

    # State per level: 0..4
    state: Dict[int, Dict[str, str]] = {}

    out_rows = []
    for _, r in df.iterrows():
        r = r.copy()

        # L0 treated as header. Keep first non-empty and carry forward
        set_block_from_row(state, r, 0)
        fill_row_from_state(state, r, 0)

        # For H1..H4:
        # If a higher level appears, update it and clear deeper levels in state and row
        for lvl in [1, 2, 3, 4]:
            en_val = norm_label(r.get(f"H{lvl}_en", ""))

            if en_val != "":
                # New value at this level: update state and clear deeper
                set_block_from_row(state, r, lvl)
                for deeper in range(lvl + 1, 5):
                    if deeper in state:
                        del state[deeper]
                    clear_block(r, deeper)
            else:
                # No value at this level: inherit from state if available
                fill_row_from_state(state, r, lvl)

        out_rows.append(r)

    return pd.DataFrame(out_rows)


# ----------------------------
# Deepest hierarchy logic
# ----------------------------
def compute_deepest(row: pd.Series) -> Tuple[int, str]:
    """
    Find deepest filled level and returns deepest_level, deepest_en_label
    Used to build join key 
    """  
    for lvl in [4, 3, 2, 1]:
        v = norm_label(row.get(f"H{lvl}_en", ""))
        if v:
            return lvl, v
    return 0, ""


def compute_parent_en(row: pd.Series, deepest_level: int) -> str:
    """
    For a deepest level L2+ concept, the parent is the immediately higher level EN label
    """ 
    if deepest_level <= 1:
        return ""
    return norm_label(row.get(f"H{deepest_level - 1}_en", ""))


def build_join_key(deepest_level: int, child_en: str, parent_en: str) -> str:
    """
    Build join key by matching concepts_curated format
    """
    if deepest_level <= 0:
        return ""
    child = norm_label(child_en)
    if not child:
        return ""
    if deepest_level == 1:
        parent = "NA"
    else:
        parent = norm_label(parent_en) or "NA"
    return f"L{deepest_level}|{child}|{parent}"


def build_join_key_noparent(deepest_level: int, child_en: str) -> str:
    """
    Fallback key that ignores parent, only used when full join fails and fallback match is UNIQUE
    """
    if deepest_level <= 0:
        return ""
    child = norm_label(child_en)
    if not child:
        return ""
    return f"L{deepest_level}|{child}"


# ----------------------------
# Curated loading and audits
# ----------------------------
def read_curated(path: str) -> pd.DataFrame:
    """
    Load concepts_curated and validate columns
    Computes join keys
    """
    cc = pd.read_csv(path, dtype=str, keep_default_na=False)

    required = ["concept_id", "level", "parent_id", "en_label", "id_key", "is_active"]
    missing = [c for c in required if c not in cc.columns]
    if missing:
        raise ValueError(f"Curated file missing required columns: {missing}")

    cc["en_label_norm"] = cc["en_label"].map(norm_label)
    cc["id_key_norm"] = cc["id_key"].map(norm_id_key)

    def make_noparent(k: str) -> str:
        k = norm_id_key(k)
        parts = k.split("|")
        if len(parts) != 3:
            return ""
        return f"{parts[0]}|{parts[1]}"

    cc["id_key_noparent"] = cc["id_key_norm"].map(make_noparent)
    return cc


def audit_curated_duplicate_id_keys(cc: pd.DataFrame, out_dir: Path) -> None:
    """
    Writes audit file listing keys not unique
    If duplicates, resolve in curated table first
    """
    dup = (
        cc.groupby("id_key_norm", dropna=False)
        .size()
        .reset_index(name="n")
        .query("id_key_norm != '' and n > 1")
        .sort_values("n", ascending=False)
    )
    (out_dir / "audit_curated_duplicate_id_keys.csv").write_text(
        dup.to_csv(index=False, encoding="utf-8"),
        encoding="utf-8",
    )

def reorder_columns(merged: pd.DataFrame) -> pd.DataFrame:
    """
    Puts curated fields at front of merged file and keeps everything else
    """
    front = [
        "sortOrder",
        "concept_id",
        "level_curated",
        "parent_id",
        "en_label",
        "id_key",
        "is_active",
        # optional single audit column
        #"join_key_norm",
    ]

    cols = list(merged.columns)
    front_existing = [c for c in front if c in cols]
    remainder = [c for c in cols if c not in set(front_existing)]
    return merged[front_existing + remainder]


# ----------------------------
# Merge logic
# ----------------------------
def merge_interim_with_curated(df: pd.DataFrame, cc: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    """
    Merges cleaned thesaurus with concept IDs
    creates a stable sortOrder
    """
    df = df.copy()

    # Preserve original order explicitly
    df.insert(0, "sortOrder", range(1, len(df) + 1))

    # Compute deepest and parent
    deepest = df.apply(lambda r: compute_deepest(r), axis=1, result_type="expand")
    df["deepest_level"] = deepest[0].astype(int)
    df["deepest_en_label"] = deepest[1].astype(str)

    df["parent_en_label"] = df.apply(lambda r: compute_parent_en(r, int(r["deepest_level"])), axis=1)

    # build join keys in same pattern as curated id_key
    df["join_key"] = df.apply(
        lambda r: build_join_key(int(r["deepest_level"]), r["deepest_en_label"], r["parent_en_label"]),
        axis=1,
    )
    df["join_key_norm"] = df["join_key"].map(norm_id_key)
    # parent-less fallback
    df["join_key_noparent"] = df.apply(
        lambda r: build_join_key_noparent(int(r["deepest_level"]), r["deepest_en_label"]),
        axis=1,
    )

    # merge keys
    merged = df.merge(
        cc[["concept_id", "level", "parent_id", "en_label", "id_key", "is_active", "id_key_norm", "id_key_noparent"]],
        left_on="join_key_norm",
        right_on="id_key_norm",
        how="left",
        suffixes=("", "_curated"),
    )

    # rename curated to reflect provenance
    merged = merged.rename(columns={"level": "level_curated"})

    # Controlled fallback: only if join_key_noparent matches uniquely in curated
    missing_mask = merged["concept_id"].astype(str).map(norm_whitespace).eq("")
    eligible = missing_mask & merged["join_key_noparent"].astype(str).map(norm_whitespace).ne("")
    if eligible.any():
        counts = cc.groupby("id_key_noparent").size().to_dict()
        unique_keys = {k for k, v in counts.items() if k and v == 1}

        # audit
        fallback_candidates = merged.loc[eligible, ["sortOrder", "join_key_noparent", "join_key_norm"]].copy()
        fallback_candidates["is_unique_in_curated"] = fallback_candidates["join_key_noparent"].isin(unique_keys)
        fallback_candidates.to_csv(out_dir / "audit_fallback_candidates.csv", index=False, encoding="utf-8")

        # apply fallback for unique keys
        to_fix_idx = merged.index[eligible & merged["join_key_noparent"].isin(unique_keys)]
        if len(to_fix_idx) > 0:
            cc_unique = cc[cc["id_key_noparent"].isin(unique_keys)].copy()
            lookup = cc_unique.set_index("id_key_noparent")[["concept_id", "level", "parent_id", "en_label", "id_key", "is_active"]]

            for idx in to_fix_idx:
                k = merged.at[idx, "join_key_noparent"]
                if k in lookup.index:
                    merged.at[idx, "concept_id"] = lookup.at[k, "concept_id"]
                    merged.at[idx, "level_curated"] = lookup.at[k, "level"]
                    merged.at[idx, "parent_id"] = lookup.at[k, "parent_id"]
                    merged.at[idx, "en_label"] = lookup.at[k, "en_label"]
                    merged.at[idx, "id_key"] = lookup.at[k, "id_key"]
                    merged.at[idx, "is_active"] = lookup.at[k, "is_active"]

    # Audit remaining missing joins (still no concept_id after primary + fallback))
    still_missing = merged[merged["concept_id"].astype(str).map(norm_whitespace).eq("")].copy()
    keep = [
        "sortOrder",
        "H1_en", "H2_en", "H3_en", "H4_en",
        "deepest_level", "deepest_en_label", "parent_en_label",
        "join_key_norm", "join_key_noparent",
    ]
    keep = [c for c in keep if c in still_missing.columns]
    still_missing[keep].to_csv(out_dir / "audit_missing_concepts_after_merge.csv", index=False, encoding="utf-8")

    return merged


# ----------------------------
# CLI
# ----------------------------
def parse_args() -> argparse.Namespace:
    """
    Wrapper supports positional and flag-based call
    """
    p = argparse.ArgumentParser(description="Clean interim thesaurus CSV and merge curated concept fields.")
    p.add_argument("interim", nargs="?", help="Path to interim wide CSV")
    p.add_argument("curated", nargs="?", help="Path to concepts_curated.csv")
    p.add_argument("out", nargs="?", help="Path for output merged CSV")
    p.add_argument("--interim", dest="interim_flag", help="Path to interim wide CSV")
    p.add_argument("--curated", dest="curated_flag", help="Path to concepts_curated.csv")
    p.add_argument("--out", dest="out_flag", help="Path for output merged CSV")
    return p.parse_args()


def main() -> int:
    """
    Runs workflow
    """
    args = parse_args()
    interim_path = args.interim_flag or args.interim
    curated_path = args.curated_flag or args.curated
    out_path = args.out_flag or args.out

    if not interim_path or not curated_path or not out_path:
        raise SystemExit("Provide interim, curated, and out paths (positional or via --interim/--curated/--out).")

    out_dir = Path(out_path).resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)

    df = read_interim(str(interim_path))

    # Critical step for sparse hierarchy spreadsheets
    df = apply_sparse_hierarchy_context(df)

    cc = read_curated(str(curated_path))
    audit_curated_duplicate_id_keys(cc, out_dir)

    merged = merge_interim_with_curated(df, cc, out_dir)
    # removes internal helper columns 
    # Keep join_key_norm for debugging of merge
    DROP_COLS = [
    "join_key_noparent",
    "id_key_noparent",
    "join_key",          # raw, unnormalised
    "id_key_norm",       # already keep join_key_norm at end
    "deepest_level",
    "deepest_en_label",
    "parent_en_label",
    "extra_52",          # if it is junk
]

    merged = merged.drop(columns=[c for c in DROP_COLS if c in merged.columns])
    merged = reorder_columns(merged)

    merged.to_csv(out_path, index=False, encoding="utf-8")

    print(f"Wrote merged output to: {out_path}")
    print(f"Audits written to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
