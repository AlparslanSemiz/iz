"""Adım günlüğü okuma ve eksik adım kontrolü. Bozuk satır atlanır, satır numarasıyla bildirilir."""
from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, cast

from .adim import kosu_dogrula
from .sozlesme import kayit_surumu


LISTE_ALANLARI = frozenset({"girdi", "cikti"})
"""Gerekli alanlardan liste olanlar; geri kalan gerekli alanlar metin olmalı."""


class GunlukHatasi(ValueError):
    """Günlükte bozuk satır var (yarım yazım, elle bozulma)."""


def gunluk_oku(yol: str | Path, gerekli_alanlar: Sequence[str] = ("ad", "sonuc"),
               onek: str = "", denetle: Callable[[dict[str, Any]], str | None] | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    """(kayıtlar, hatalar). Satırlar yalnız "\\n" ile bölünür (U+2028 satır sonu değildir), sondaki "\\r" ve
    boş satır yok sayılır. JSON nesnesi olmayan ya da gerekli alanı eksik satır atlanıp hataya yazılır;
    desteklenmeyen `sema_surumu` SurumHatasi ile durur (bilinmeyen biçim atlanmaz)."""
    p = Path(yol)
    kayitlar: list[dict[str, Any]] = []
    hatalar: list[str] = []
    if not p.exists():
        return kayitlar, hatalar
    for n, s in enumerate(p.read_bytes().decode("utf-8", errors="replace").split("\n"), 1):
        s = s.removesuffix("\r")
        if s.strip() == "":
            continue
        try:
            j: object = json.loads(s)
        except (ValueError, RecursionError):
            j = None
        if not isinstance(j, dict):
            hatalar.append(f"{onek}satır {n}: JSON değil")
            continue
        k = cast("dict[str, Any]", j)
        kayit_surumu(k)
        eksik = [a for a in gerekli_alanlar if a not in k]
        if eksik:
            hatalar.append(f"{onek}satır {n}: eksik alan {','.join(eksik)}")
            continue
        if (yanlis := next((a for a in gerekli_alanlar if a not in LISTE_ALANLARI and not isinstance(k[a], str)), None)):
            hatalar.append(f"{onek}satır {n}: alan {yanlis} metin değil")
            continue
        if denetle is not None and (h := denetle(k)) is not None:
            hatalar.append(f"{onek}satır {n}: {h}")
            continue
        kayitlar.append(k)
    return kayitlar, hatalar


def kosu_yolu(kok: str | Path, kosu: str) -> Path:
    return Path(kok) / "kosular" / f"{kosu_dogrula(kosu)}.jsonl"


def kosu_durumu(kok: str | Path, kosu: str, gerekli: list[str]) -> tuple[list[str], list[str]]:
    """(eksik adımlar, bozuk satır hataları)."""
    kayitlar, hatalar = gunluk_oku(kosu_yolu(kok, kosu))
    tamam = {k["ad"] for k in kayitlar if k["sonuc"] == "tamam"}
    return [g for g in gerekli if g not in tamam], hatalar


def eksik_adimlar(kok: str | Path, kosu: str, gerekli: list[str]) -> list[str]:
    """Bozuk satır varsa GunlukHatasi (ilk satır numarası ve atlanan sayısıyla)."""
    eksik, hatalar = kosu_durumu(kok, kosu, gerekli)
    if hatalar:
        raise GunlukHatasi(f"{hatalar[0]} ({len(hatalar)} bozuk satır atlandı)")
    return eksik
