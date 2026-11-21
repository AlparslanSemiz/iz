from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .defter import dogrula, onar, onek_denetle
from .koken import koken, markdown
from .kontrol import kosu_durumu
from .sozlesme import SurumHatasi


def _defter_onek(eski: str, yeni: str) -> int:
    try:
        e, y = Path(eski).read_bytes(), Path(yeni).read_bytes()
    except OSError as x:
        print(f"defter-onek: okunamadı: {x.filename}", file=sys.stderr)
        return 2
    hata = onek_denetle(e, y)
    if hata:
        print(f"defter-onek: {hata}", file=sys.stderr)
        return 1
    print(f"defter-onek: tamam ({len(y) - len(e)} bayt eklendi)")
    return 0


def _defter_onar(yol: str) -> int:
    try:
        bayt, y = onar(yol)
    except FileNotFoundError:
        print(f"defter-onar: dosya yok: {yol}", file=sys.stderr)
        return 2
    print(f"defter-onar: yarım satır yok: {yol}" if y is None
          else f"defter-onar: son yarım satır ({bayt} bayt) {y} dosyasına taşındı")
    hatalar = dogrula(yol)
    for h in hatalar:
        print(h, file=sys.stderr)
    return 1 if hatalar else 0


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="iz")
    ap.add_argument("--kok", default=".iz")
    sp = ap.add_subparsers(dest="komut", required=True)
    k = sp.add_parser("koken")
    k.add_argument("dosya")
    k.add_argument("--bicim", choices=["json", "md"], default="json")
    c = sp.add_parser("kontrol")
    c.add_argument("--kosu", required=True)
    c.add_argument("--gerekli", required=True)
    d = sp.add_parser("defter-dogrula")
    d.add_argument("yol", nargs="?", default="iz/defter.jsonl")
    o = sp.add_parser("defter-onek", help="eski dosya yenisinin bayt öneki mi (yalnız sona ekleme)")
    o.add_argument("eski")
    o.add_argument("yeni")
    r = sp.add_parser("defter-onar", help="son yarım satırı <yol>.yarim dosyasına taşır")
    r.add_argument("yol", nargs="?", default="iz/defter.jsonl")
    a = ap.parse_args(argv)
    if a.komut == "koken":
        hatalar: list[str] = []
        try:
            agac = koken(a.dosya, a.kok, hatalar)
        except FileNotFoundError:
            print(f"dosya yok: {a.dosya}", file=sys.stderr)
            return 2
        except SurumHatasi as e:
            print(f"iz koken: {e}", file=sys.stderr)
            return 2
        print(json.dumps(agac, ensure_ascii=False, indent=2) if a.bicim == "json" else markdown(agac), end="")
        for h in hatalar:
            print(f"iz koken: {h}", file=sys.stderr)
        if hatalar:
            print(f"iz koken: {len(hatalar)} bozuk satır atlandı", file=sys.stderr)
            return 2
        return 0
    if a.komut == "kontrol":
        try:
            eksik, hatalar = kosu_durumu(a.kok, a.kosu, [x for x in a.gerekli.split(",") if x])
        except ValueError as e:
            print(f"iz kontrol: {e}", file=sys.stderr)
            return 2
        for h in hatalar:
            print(f"iz kontrol: {h}", file=sys.stderr)
        if hatalar:
            print(f"iz kontrol: {len(hatalar)} bozuk satır atlandı", file=sys.stderr)
        if eksik:
            print("eksik adım: " + ", ".join(eksik), file=sys.stderr)
        if hatalar:
            return 2
        if eksik:
            return 1
        print("tamam")
        return 0
    if a.komut == "defter-onek":
        return _defter_onek(a.eski, a.yeni)
    if a.komut == "defter-onar":
        return _defter_onar(a.yol)
    hatalar = dogrula(a.yol)
    for h in hatalar:
        print(h, file=sys.stderr)
    return 1 if hatalar else 0


if __name__ == "__main__":
    sys.exit(main())
