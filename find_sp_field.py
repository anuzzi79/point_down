#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
find_sp_field.py
Scansiona tutti i campi di una issue Jira e individua il campo "Story Points"
(o, in generale, il campo numerico che corrisponde a un valore target, es. 2.5).

USO:
  python find_sp_field.py \
    --base-url https://<tenant>.atlassian.net \
    --email nome@azienda.com \
    --token <JIRA_API_TOKEN> \
    --issue FGC-9446 \
    --target 2.5

Requisiti: Python 3.8+ e requests (pip install requests)
"""
import argparse
import base64
import json
import math
import sys
from typing import Any, Dict, Tuple, Optional, List

import requests


def basic_headers(email: str, token: str) -> Dict[str, str]:
    auth = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def to_float_maybe(v: Any) -> Optional[float]:
    """
    Converte v in float se ha senso:
      - int/float → float
      - stringa numerica → float
      - dict con chiavi tipiche → tenta 'value'
    Altrimenti None.
    """
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "."))  # tollera "2,5"
        except ValueError:
            return None
    if isinstance(v, dict):
        # Alcuni custom field restituiscono {"value": X} o simile
        # Prova chiavi comuni
        for k in ("value", "amount", "number"):
            if k in v:
                return to_float_maybe(v[k])
    return None


def fetch_issue_with_names(base_url: str, email: str, token: str, issue_key: str) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}/rest/api/3/issue/{issue_key}?expand=names"
    resp = requests.get(url, headers=basic_headers(email, token), timeout=25)
    if not resp.ok:
        raise SystemExit(f"Errore nel GET issue: {resp.status_code} {resp.text}")
    return resp.json()


def fetch_all_fields(base_url: str, email: str, token: str) -> List[Dict[str, Any]]:
    url = f"{base_url.rstrip('/')}/rest/api/3/field"
    resp = requests.get(url, headers=basic_headers(email, token), timeout=25)
    if not resp.ok:
        raise SystemExit(f"Errore nel GET fields: {resp.status_code} {resp.text}")
    return resp.json()


def main():
    ap = argparse.ArgumentParser(description="Scansiona i campi di una issue Jira per trovare il campo Story Points.")
    ap.add_argument("--base-url", required=True, help="Es: https://tenant.atlassian.net")
    ap.add_argument("--email", required=True, help="Email dell'account Jira")
    ap.add_argument("--token", required=True, help="API token Jira")
    ap.add_argument("--issue", required=True, help="Issue key, es. FGC-9446")
    ap.add_argument("--target", type=float, default=2.5, help="Valore target da cercare (default: 2.5)")
    ap.add_argument("--tolerance", type=float, default=1e-9, help="Tolleranza confronto numerico (default: 1e-9)")
    ap.add_argument("--show-all", action="store_true", help="Stampa anche tutti i campi non numerici")
    args = ap.parse_args()

    base_url = args.base_url
    email = args.email
    token = args.token
    issue_key = args.issue
    target = float(args.target)
    tol = float(args.tolerance)

    print(f"→ Issue: {issue_key}")
    issue = fetch_issue_with_names(base_url, email, token, issue_key)
    fields_payload = issue.get("fields", {}) or {}
    names_map = issue.get("names", {}) or {}  # id → nome visibile

    # Per tipologia/schema dei campi, interroga /field una volta
    fields_list = fetch_all_fields(base_url, email, token)
    schema_by_id: Dict[str, Dict[str, Any]] = {f.get("id"): f.get("schema", {}) for f in fields_list}
    name_by_id_fallback: Dict[str, str] = {f.get("id"): f.get("name") for f in fields_list}

    numeric_candidates: list[Tuple[str, str, Optional[str], float]] = []
    equal_hits: list[Tuple[str, str, Optional[str], float]] = []

    for fid, raw_value in fields_payload.items():
        # risolvi nome e (opzionale) tipo
        visible_name = names_map.get(fid) or name_by_id_fallback.get(fid) or fid
        schema = schema_by_id.get(fid) or {}
        schema_type = schema.get("type") or schema.get("items")

        # prova converter
        fval = to_float_maybe(raw_value)
        if fval is None:
            if args.show_all:
                print(f"  - {fid:>18}  {visible_name}  [schema:{schema_type}]  = {json.dumps(raw_value)[:80]}")
            continue

        # è numerico → inserisci tra i candidati
        numeric_candidates.append((fid, visible_name, str(schema_type), fval))
        if math.isfinite(target) and abs(fval - target) <= tol:
            equal_hits.append((fid, visible_name, str(schema_type), fval))

    print("\n=== CANDIDATI NUMERICI TROVATI ===")
    if not numeric_candidates:
        print("  (nessun campo numerico trovato)")
    else:
        # ordina mostrando prima i più vicini al target
        numeric_candidates.sort(key=lambda x: abs(x[3] - target))
        for fid, name, stype, val in numeric_candidates:
            star = "★ match" if abs(val - target) <= tol else "  "
            print(f"{star:7} {fid:>18}  {name}  [schema:{stype}]  = {val}")

    print("\n=== RISULTATO ===")
    if equal_hits:
        # se uno o più match perfetti col target
        print("Campo(i) che corrisponde(n) ESATTAMENTE al target:")
        for fid, name, stype, val in equal_hits:
            print(f"  -> {name} ({fid}) = {val}  [schema:{stype}]")
        best = equal_hits[0]
    elif numeric_candidates:
        # nessun match perfetto: prendi il più vicino
        best = numeric_candidates[0]
        fid, name, stype, val = best
        print("Nessun valore esattamente uguale al target; il più vicino è:")
        print(f"  -> {name} ({fid}) = {val}  [schema:{stype}]  (Δ={abs(val-target)})")
    else:
        print("Impossibile individuare un campo numerico. Verifica permessi o issue key.")
        sys.exit(2)

    # Consiglio pratico: salva l’ID da usare nell’estensione
    fid, name, stype, val = best
    print("\nSuggerimento: nell’estensione imposta questo ID come campo Story Points:")
    print(f"  spFieldIdFixed = \"{fid}\"    # nome visibile: {name}")

    # Esporta anche JSON “grezzo” (utile per debug/grep) — opzionale
    raw_out = {
        "issue": issue_key,
        "target": target,
        "best": {"id": fid, "name": name, "schema": stype, "value": val},
        "all_numeric": [
            {"id": f, "name": n, "schema": t, "value": v} for (f, n, t, v) in numeric_candidates
        ],
    }
    with open("find_sp_field_result.json", "w", encoding="utf-8") as fh:
        json.dump(raw_out, fh, ensure_ascii=False, indent=2)
    print('\nFile scritto: find_sp_field_result.json')


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto dall’utente.")
