"""Kayıt biçimi sözleşmesi: sema_surumu, şema ve altın dosya yolları (paket verisi)."""
from __future__ import annotations

import json
from collections.abc import Mapping
from importlib import resources
from pathlib import Path

SEMA_SURUMU = 1
"""Bu sürümün yazdığı kayıt biçimi. Alan eklemek minor; alan silmek ya da anlamını değiştirmek major."""
DESTEKLENEN = frozenset({1})
"""Okunan biçimler (N ve N-1). `sema_surumu` alanı olmayan kayıt v1 sayılır."""


class SurumHatasi(ValueError):
    pass


def kayit_surumu(kayit: Mapping[str, object]) -> int:
    """Kaydın biçim sürümü; alan yoksa 1. Desteklenmeyen sürümde SurumHatasi."""
    s = kayit.get("sema_surumu", 1)
    if type(s) is not int or s not in DESTEKLENEN:
        raise SurumHatasi("desteklenmeyen sema_surumu " + json.dumps(s, ensure_ascii=False)
                          + " (desteklenen: " + json.dumps(sorted(DESTEKLENEN)) + ")")
    return s


def _veri(ad: str) -> Path:
    kurulu = resources.files("iz") / "_veri" / ad
    if kurulu.is_dir():
        return Path(str(kurulu))
    depo = Path(__file__).resolve().parents[2] / ad  # depodan ya da düzenlenebilir kurulumdan çalışma
    if depo.is_dir():
        return depo
    raise FileNotFoundError(f"iz paket verisi yok: {ad}")


def sema_dizini() -> Path:
    return _veri("sema")


def sema_yolu(ad: str, surum: int = SEMA_SURUMU) -> Path:
    """ad: 'adim' ya da 'defter' -> .../iz-<ad>.v<surum>.json"""
    return sema_dizini() / f"iz-{ad}.v{surum}.json"


def testdata_dizini() -> Path:
    return _veri("testdata")
