#!/usr/bin/env python3
"""
1_clean_merge_cultural_periods.py

PART 1 for Cultural Periods (uses an existing curated concept table)

Takes cultural_periods.csv  and:
1) Renames columns into the standard "wide" schema used by the site_types workflow:
   - L0_{lang}, H1_{lang}..H4_{lang}, Notes_{lang}
2) Backfills hierarchy (carry-forward) so every row has its higher levels filled.
3) Builds the same stable join key format:
     L{level}|{child_en}|{parent_en_or_NA}
4) Merges curated concept metadata from concepts_curated_cultural_periods.csv.
5) Keeps the source Date column as date_range and adds date_from/date_to (best-effort parse).

Outputs:
- out.csv (cleaned + merged wide CSV, ready for 2_make_skos_wide_thesaurus.py)
- audit_missing_concepts_after_merge.csv
- audit_curated_duplicate_id_keys.csv
- audit_fallback_candidates.csv
- audit_unparsed_dates.csv (rows where date_range present but could not parse)

Usage:
  python 1_clean_merge_cultural_periods.py cultural_periods.csv concepts_curated_cultural_periods.csv cultural_periods_MERGED.csv
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import pandas as pd


LANGS = ["en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"]

# ----------------------------
# Normalisation helpers
# ----------------------------
def norm_whitespace(s: str) -> str:
    s = "" if s is None else str(s)
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    return s


def norm_label(s: str) -> str:
    s = norm_whitespace(s)
    if not s:
        return ""
    s = re.sub(r"\s*/\s*", "/", s)
    return s


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


def norm_bool(val: str) -> Optional[bool]:
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


# ----------------------------
# Column mapping for cultural_periods.csv -> standard wide schema
# ----------------------------
def build_colmap() -> Dict[str, str]:
    # Scheme labels row (row 0)
    base = {
        "Unnamed: 0": "L0_en",
        "Russian": "L0_ru",
        "Chinese": "L0_zh",
        "Kazakh": "L0_kk",
        "Kyrgyz": "L0_ky",
        "Tajik": "L0_tg",
        "Turkmen": "L0_tk",
        "Uzbek": "L0_uz",
        # Hierarchy levels (English)
        "Hierarchy 1": "H1_en",
        "Hierarchy 2": "H2_en",
        "Hierarchy 3": "H3_en",
        # Notes (English)
        "Notes": "Notes_en",
        # Date
        "Date": "date_range",
    }

    lang_src = {
        "Russian": "ru",
        "Chinese": "zh",
        "Kazakh": "kk",
        "Kyrgyz": "ky",
        "Tajik": "tg",
        "Turkmen": "tk",
        "Uzbek": "uz",
    }

    # Excel-style duplicated column names become suffixes like Russian.1, Russian.2, etc.
    for src, lang in lang_src.items():
        base[f"{src}.1"] = f"H1_{lang}"
        base[f"{src}.2"] = f"H2_{lang}"
        base[f"{src}.3"] = f"H3_{lang}"
        base[f"{src}.4"] = f"Notes_{lang}"

    return base


def standard_wide_cols() -> List[str]:
    cols: List[str] = []
    cols += [f"L0_{l}" for l in LANGS]
    for h in range(1, 5):  # support H4 for compatibility with Part 2, will remain blank here
        cols += [f"H{h}_{l}" for l in LANGS]
    cols += [f"Notes_{l}" for l in LANGS]
    cols += ["date_range", "date_from", "date_to"]
    return cols


def read_cultural_periods(path: str) -> Tuple[pd.Series, pd.DataFrame]:
    """
    Returns:
      scheme_row (Series) with L0_* and Notes_* (for scheme metadata)
      df (DataFrame) concept rows (everything after row 0) in standard wide columns
    """
    raw = pd.read_csv(path, dtype=str, keep_default_na=False)
    colmap = build_colmap()

    df = raw.rename(columns={k: v for k, v in colmap.items() if k in raw.columns}).copy()

    # Ensure all expected columns exist
    for c in standard_wide_cols():
        if c not in df.columns:
            df[c] = ""

    # Normalize whitespace on relevant cols
    for c in df.columns:
        if c.startswith(("L0_", "H1_", "H2_", "H3_", "H4_", "Notes_")) or c == "date_range":
            df[c] = df[c].map(norm_whitespace)

    if len(df) == 0:
        raise ValueError("Input file has no rows.")

    scheme_row = df.iloc[0].copy()

    # Concept rows start after the scheme row
    df_concepts = df.iloc[1:].copy().reset_index(drop=True)

    # Force scheme L0 labels onto all concept rows (so L0 carry-forward is stable)
    for lang in LANGS:
        df_concepts[f"L0_{lang}"] = norm_whitespace(scheme_row.get(f"L0_{lang}", ""))

    # Ensure H4_* exists and stays blank (3-level sheet)
    for lang in LANGS:
        df_concepts[f"H4_{lang}"] = ""

    # Ensure date_from/to exist (computed later)
    df_concepts["date_from"] = ""
    df_concepts["date_to"] = ""

    return scheme_row, df_concepts


# ----------------------------
# Hierarchy carry-forward (same logic as site types)
# ----------------------------
def block_cols(level: int) -> List[str]:
    prefix = "L0" if level == 0 else f"H{level}"
    return [f"{prefix}_{l}" for l in LANGS]


def clear_block(row: pd.Series, level: int) -> None:
    for c in block_cols(level):
        row[c] = ""


def set_block_from_row(state: Dict[int, Dict[str, str]], row: pd.Series, level: int) -> None:
    en_col = ("L0_en" if level == 0 else f"H{level}_en")
    if norm_label(row.get(en_col, "")) == "":
        return
    state[level] = {
        c: norm_label(row.get(c, "")) if c.endswith("_en") else norm_whitespace(row.get(c, ""))
        for c in block_cols(level)
    }


def fill_row_from_state(state: Dict[int, Dict[str, str]], row: pd.Series, level: int) -> None:
    en_col = ("L0_en" if level == 0 else f"H{level}_en")
    if norm_label(row.get(en_col, "")) != "":
        return
    if level not in state:
        return
    for c in block_cols(level):
        row[c] = state[level].get(c, "")


def apply_sparse_hierarchy_context(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    state: Dict[int, Dict[str, str]] = {}
    out_rows = []

    for _, r in df.iterrows():
        r = r.copy()

        # L0 always present, but treat the same way for consistency
        set_block_from_row(state, r, 0)
        fill_row_from_state(state, r, 0)

        # H1..H4
        for lvl in [1, 2, 3, 4]:
            en_val = norm_label(r.get(f"H{lvl}_en", ""))
            if en_val != "":
                set_block_from_row(state, r, lvl)
                for deeper in range(lvl + 1, 5):
                    if deeper in state:
                        del state[deeper]
                    clear_block(r, deeper)
            else:
                fill_row_from_state(state, r, lvl)

        out_rows.append(r)

    return pd.DataFrame(out_rows)


# ----------------------------
# Deepest hierarchy logic for join key
# ----------------------------
def compute_deepest(row: pd.Series) -> Tuple[int, str]:
    for lvl in [4, 3, 2, 1]:
        v = norm_label(row.get(f"H{lvl}_en", ""))
        if v:
            return lvl, v
    return 0, ""


def compute_parent_en(row: pd.Series, deepest_level: int) -> str:
    if deepest_level <= 1:
        return ""
    return norm_label(row.get(f"H{deepest_level - 1}_en", ""))


def build_join_key(deepest_level: int, child_en: str, parent_en: str) -> str:
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
    if deepest_level <= 0:
        return ""
    child = norm_label(child_en)
    if not child:
        return ""
    return f"L{deepest_level}|{child}"


# ----------------------------
# Date parsing: best-effort
# - outputs integer years
# - BCE/BC -> negative
# - if only one year, from=to
# ----------------------------
_BCE = re.compile(r"\b(BCE|BC)\b", re.IGNORECASE)
_CE  = re.compile(r"\b(CE|AD)\b", re.IGNORECASE)
_BP  = re.compile(r"\bBP\b", re.IGNORECASE)

# Matches things like "3rd century", "11th c", "7th-6th centuries"
_CENTURY = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s*(?:century|c)\b", re.IGNORECASE)

def _clean(s: str) -> str:
    s = "" if s is None else str(s)
    s = s.strip()
    # normalize unicode dashes to hyphen
    s = s.replace("–", "-").replace("—", "-")
    # remove "c." / "ca" but keep the rest
    s = re.sub(r"\b(ca\.?|c\.)\b", "", s, flags=re.IGNORECASE)
    # strip surrounding parentheses
    s = s.strip("()[]{} ")
    # normalize whitespace
    s = re.sub(r"\s+", " ", s)
    return s

def _parse_yearish(token: str, *, want_upper: bool) -> Optional[int]:
    """
    Parse a single endpoint token into an integer year, without era sign.
    - Handles commas: 2,000 -> 2000
    - Handles decades: 1340s -> 1340 (lower), 1349 (upper)
    - Handles slashes: 593/603 -> lower=min, upper=max
    Returns None if no usable number is found.
    """
    t = token
    t = t.replace(",", "")
    t = _BCE.sub("", _CE.sub("", _BP.sub("", t)))
    t = t.strip()

    # slash years: "593/603"
    if "/" in t:
        parts = [p.strip() for p in t.split("/") if p.strip()]
        vals = []
        for p in parts:
            m = re.search(r"\d{1,6}", p)
            if m:
                vals.append(int(m.group(0)))
        if not vals:
            return None
        return max(vals) if want_upper else min(vals)

    # decade: "1340s"
    m = re.search(r"(\d{3,4})s\b", t, flags=re.IGNORECASE)
    if m:
        base = int(m.group(1))
        return base + 9 if want_upper else base

    # plain year
    m = re.search(r"\d{1,6}", t)
    if not m:
        return None
    return int(m.group(0))

def _century_bounds(n: int, era: str) -> Tuple[int, int]:
    """
    Approximate bounds for an nth century.
    CE:  n=1 -> 1..100, n=2 -> 101..200
    BCE: n=1 -> -100..-1, n=2 -> -200..-101
    """
    if era == "bce":
        start = - (n * 100)
        end = - ((n - 1) * 100 + 1)
        return start, end
    # CE
    start = (n - 1) * 100 + 1
    end = n * 100
    return start, end

def parse_date_range_to_years(date_range: str):
    # manual handling
    s = _clean(date_range)

    if not s:
        return None, None

    if re.search(r"\bcenturies\b", s, flags=re.IGNORECASE):
        return None, None

    # Optional: BP conversion
    # If string contains BP, interpret numbers as "years before 1950"
    # and convert to CE-style years (can become negative for deep time).
    if _BP.search(s):
         nums = re.findall(r"\d[\d,]*", s)
         if not nums:
             return None, None
         vals = [int(x.replace(",", "")) for x in nums]
         if len(vals) == 1:
             y = 1950 - vals[0]
             return y, y
         y1 = 1950 - vals[0]
         y2 = 1950 - vals[1]
         return min(y1, y2), max(y1, y2)

    has_bce = bool(_BCE.search(s))
    has_ce = bool(_CE.search(s))

    # Split into endpoints on common range delimiters.
    # Important: we treat '-' as a delimiter, NOT a sign.
    parts = re.split(r"\s*(?:-|to)\s*", s, flags=re.IGNORECASE)
    parts = [p.strip() for p in parts if p.strip()]

    # If we got more than 2 chunks (because of extra hyphens), fall back to first two meaningful ones.
    if len(parts) == 1:
        left = parts[0]
        right = parts[0]
    else:
        left = parts[0]
        right = parts[1]

    # Determine era per endpoint
    def endpoint_era(token: str) -> str:
        if _BCE.search(token):
            return "bce"
        if _CE.search(token):
            return "ce"
        # If the whole string declares only BCE or only CE, apply it
        if has_bce and not has_ce:
            return "bce"
        if has_ce and not has_bce:
            return "ce"
        # Mixed and not specified: assume CE unless evidence otherwise
        return "ce"

    era_left = endpoint_era(left)
    era_right = endpoint_era(right)

    # Century handling (approximate)
    # Example: "6th century BCE to 8th century CE"
    mL = _CENTURY.search(left)
    mR = _CENTURY.search(right)
    if mL and mR:
        nL = int(mL.group(1))
        nR = int(mR.group(1))
        lo1, hi1 = _century_bounds(nL, era_left)
        lo2, hi2 = _century_bounds(nR, era_right)
        date_from = min(lo1, lo2)
        date_to = max(hi1, hi2)
        return date_from, date_to

    # Parse numeric endpoints
    y1 = _parse_yearish(left, want_upper=False)
    y2 = _parse_yearish(right, want_upper=True)

    if y1 is None and y2 is None:
        return None, None
    if y1 is None:
        y1 = y2
    if y2 is None:
        y2 = y1

    # Apply BCE sign only where appropriate
    if era_left == "bce":
        y1 = -abs(int(y1))
    else:
        y1 = abs(int(y1))
    if era_right == "bce":
        y2 = -abs(int(y2))
    else:
        y2 = abs(int(y2))

    return min(y1, y2), max(y1, y2)


# ----------------------------
# Curated loading and audits
# ----------------------------
def read_curated(path: str) -> pd.DataFrame:
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
    front = [
        "sortOrder",
        "concept_id",
        "level_curated",
        "parent_id",
        "en_label",
        "id_key",
        "is_active",
        "date_range",
        "date_from",
        "date_to",
    ]
    cols = list(merged.columns)
    front_existing = [c for c in front if c in cols]
    remainder = [c for c in cols if c not in set(front_existing)]
    return merged[front_existing + remainder]


# ----------------------------
# Merge logic (same as site types, plus date parsing)
# ----------------------------
def merge_interim_with_curated(df: pd.DataFrame, cc: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    df = df.copy()

    # Preserve original order explicitly
    df.insert(0, "sortOrder", range(1, len(df) + 1))

    deepest = df.apply(lambda r: compute_deepest(r), axis=1, result_type="expand")
    df["deepest_level"] = deepest[0].astype(int)
    df["deepest_en_label"] = deepest[1].astype(str)

    df["parent_en_label"] = df.apply(lambda r: compute_parent_en(r, int(r["deepest_level"])), axis=1)

    df["join_key"] = df.apply(
        lambda r: build_join_key(int(r["deepest_level"]), r["deepest_en_label"], r["parent_en_label"]),
        axis=1,
    )
    df["join_key_norm"] = df["join_key"].map(norm_id_key)

    df["join_key_noparent"] = df.apply(
        lambda r: build_join_key_noparent(int(r["deepest_level"]), r["deepest_en_label"]),
        axis=1,
    )

    merged = df.merge(
        cc[["concept_id", "level", "parent_id", "en_label", "id_key", "is_active", "id_key_norm", "id_key_noparent"]],
        left_on="join_key_norm",
        right_on="id_key_norm",
        how="left",
        suffixes=("", "_curated"),
    )

    merged = merged.rename(columns={"level": "level_curated"})

    # Fallback only when parentless key is unique in curated
    missing_mask = merged["concept_id"].astype(str).map(norm_whitespace).eq("")
    eligible = missing_mask & merged["join_key_noparent"].astype(str).map(norm_whitespace).ne("")
    if eligible.any():
        counts = cc.groupby("id_key_noparent").size().to_dict()
        unique_keys = {k for k, v in counts.items() if k and v == 1}

        fallback_candidates = merged.loc[eligible, ["sortOrder", "join_key_noparent", "join_key_norm"]].copy()
        fallback_candidates["is_unique_in_curated"] = fallback_candidates["join_key_noparent"].isin(unique_keys)
        fallback_candidates.to_csv(out_dir / "audit_fallback_candidates.csv", index=False, encoding="utf-8")

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

    # Date parsing: only for rows where date_range is present (row still represents the deepest concept)
    unparsed = []
    date_from_list = []
    date_to_list = []
    for _, r in merged.iterrows():
        dr = norm_whitespace(r.get("date_range", ""))
        if not dr:
            date_from_list.append("")
            date_to_list.append("")
            continue
        dfy, dty = parse_date_range_to_years(dr)
        if dfy is None or dty is None:
            unparsed.append({"sortOrder": r.get("sortOrder", ""), "date_range": dr})
            date_from_list.append("")
            date_to_list.append("")
        else:
            date_from_list.append(str(dfy))
            date_to_list.append(str(dty))

    merged["date_from"] = date_from_list
    merged["date_to"] = date_to_list

    pd.DataFrame(unparsed).to_csv(out_dir / "audit_unparsed_dates.csv", index=False, encoding="utf-8")

    still_missing = merged[merged["concept_id"].astype(str).map(norm_whitespace).eq("")].copy()
    keep = [
        "sortOrder",
        "H1_en", "H2_en", "H3_en", "H4_en",
        "deepest_level", "deepest_en_label", "parent_en_label",
        "join_key_norm", "join_key_noparent",
        "date_range",
    ]
    keep = [c for c in keep if c in still_missing.columns]
    still_missing[keep].to_csv(out_dir / "audit_missing_concepts_after_merge.csv", index=False, encoding="utf-8")

    return merged


# ----------------------------
# CLI
# ----------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Clean cultural periods CSV and merge curated concept fields.")
    p.add_argument("interim", nargs="?", help="Path to cultural_periods.csv")
    p.add_argument("curated", nargs="?", help="Path to concepts_curated_cultural_periods.csv")
    p.add_argument("out", nargs="?", help="Output merged wide CSV (feeds Part 2)")
    p.add_argument("--interim", dest="interim_flag", help="Path to cultural_periods.csv")
    p.add_argument("--curated", dest="curated_flag", help="Path to concepts_curated_cultural_periods.csv")
    p.add_argument("--out", dest="out_flag", help="Output merged wide CSV (feeds Part 2)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    interim_path = args.interim_flag or args.interim
    curated_path = args.curated_flag or args.curated
    out_path = args.out_flag or args.out

    if not interim_path or not curated_path or not out_path:
        raise SystemExit("Provide interim, curated, and out paths (positional or via --interim/--curated/--out).")

    out_dir = Path(out_path).resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # Read and normalize cultural_periods.csv
    scheme_row, df = read_cultural_periods(str(interim_path))

    # Backfill hierarchy context (H1..H4), same logic as site types
    df = apply_sparse_hierarchy_context(df)

    # Load curated concepts and audit duplicates
    cc = read_curated(str(curated_path))
    audit_curated_duplicate_id_keys(cc, out_dir)

    # Merge curated IDs in
    merged = merge_interim_with_curated(df, cc, out_dir)

    # Drop helper columns used for joining
    DROP_COLS = [
        "join_key_noparent",
        "id_key_noparent",
        "join_key",
        "id_key_norm",
        "deepest_level",
        "deepest_en_label",
        "parent_en_label",
    ]
    merged = merged.drop(columns=[c for c in DROP_COLS if c in merged.columns])
    merged = reorder_columns(merged)

    # Reattach a scheme metadata row at the top (sortOrder 0) so Part 2 can read L0 + scheme notes if present
    scheme_out = {c: "" for c in merged.columns}
    scheme_out["sortOrder"] = 0
    scheme_out["concept_id"] = ""
    scheme_out["level_curated"] = ""
    scheme_out["parent_id"] = ""
    scheme_out["en_label"] = ""
    scheme_out["id_key"] = ""
    scheme_out["is_active"] = ""

    for lang in LANGS:
        scheme_out[f"L0_{lang}"] = norm_whitespace(scheme_row.get(f"L0_{lang}", ""))
        # scheme notes live on the scheme row if populated
        scheme_out[f"Notes_{lang}"] = norm_whitespace(scheme_row.get(f"Notes_{lang}", ""))

    out_df = pd.concat([pd.DataFrame([scheme_out]), merged], ignore_index=True)
    out_df.to_csv(out_path, index=False, encoding="utf-8")

    print(f"Wrote merged output to: {out_path}")
    print(f"Audits written to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())