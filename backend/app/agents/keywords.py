"""Deterministic keyword extraction for Jira/Confluence/code search. No LLM involved: the search terms an
agent used are visible in its tool calls, so a reviewer can see exactly what was searched."""
from __future__ import annotations

import re
from collections import Counter

STOP = set("""
a an the and or not but if else then than that this these those it its is are was were be been being have has had do does did will would can could
should may might must shall of in on at to from by for with without about into over under again once here there when where why how what which who
whom whose all any both each few more most other some such no nor only own same so too very just also as up down out off
const let var function return async await import export default from new class interface type extends implements try catch finally throw throws
public private protected static void int string number boolean true false null undefined none self def lambda pass yield elif while switch case break
continue typeof instanceof require module exports props state args kwargs param params value values data result results item items key keys
get set add use used using make made need needs exist exists existence does why please explain code line lines file files function functions
""".split())
WORD = re.compile(r"[A-Za-z][A-Za-z0-9]+")
CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")


def split_identifier(tok: str) -> list[str]:
    return [w.lower() for w in CAMEL.findall(tok.replace("_", " ")) if w]


def keywords(*texts: str | None, limit: int = 6, min_len: int = 4) -> list[str]:
    counts: Counter = Counter()
    for t in texts:
        for tok in WORD.findall(t or ""):
            parts = split_identifier(tok)
            for w in ([tok.lower()] if len(parts) <= 1 else parts + [tok.lower()]):
                if len(w) >= min_len and w not in STOP and not w.isdigit():
                    counts[w] += 1
    # Frequent first, then longer (more specific) words, then alphabetical for stable output.
    ranked = sorted(counts, key=lambda w: (-counts[w], -len(w), w))
    return ranked[:limit]
