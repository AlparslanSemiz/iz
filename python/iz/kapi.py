"""Kapı koşucusu: her kapı bir adım olarak günlüklenir, sonunda `iz kontrol` ile eksik adım aranır."""
from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from .adim import adim, kosu_dogrula, uuid7


class KapiHatasi(Exception):
    def __init__(self, kapi: str, kod: int) -> None:
        super().__init__(f"kapı başarısız: {kapi} (çıkış {kod})")
        self.kapi = kapi
        self.kod = kod


def _kos(kapilar: Sequence[str], kos: Callable[[str], int], kosu: str, kok: Path,
         nitelikler: dict[str, object]) -> int:
    for kapi in kapilar:
        try:
            with adim(kapi, nitelikler={**nitelikler, "kapi": kapi}, kok=kok, kosu=kosu):
                kod = kos(kapi)
                if kod != 0:
                    raise KapiHatasi(kapi, kod)
        except KapiHatasi as e:
            return e.kod
    return 0


def kapilari_kos(kapilar: Sequence[str], kos: Callable[[str], int], kosu: str | None = None,
                 kok: str | Path | None = None, nitelikler: dict[str, object] | None = None) -> int:
    kosu = kosu_dogrula(kosu or os.environ.get("IZ_KOSU") or uuid7())
    kok_yolu = Path(kok or os.environ.get("IZ_DIZIN") or ".iz")
    onceki = os.environ.get("IZ_KOSU")
    os.environ["IZ_KOSU"] = kosu
    try:
        kod = _kos(kapilar, kos, kosu, kok_yolu, nitelikler or {})
        if kod != 0:
            return kod
        # iz paketinin üst dizini PYTHONPATH'in başına: çağıranın cwd'sinden bağımsız `-m iz`.
        paket_ustu = str(Path(__file__).resolve().parents[1])
        yol = os.pathsep.join(p for p in (paket_ustu, os.environ.get("PYTHONPATH", "")) if p)
        r = subprocess.run([sys.executable, "-m", "iz", "--kok", str(kok_yolu), "kontrol", "--kosu", kosu,
                            "--gerekli", ",".join(kapilar)], check=False, env={**os.environ, "PYTHONPATH": yol})
        return 0 if r.returncode == 0 else 1
    finally:
        if onceki is None:
            os.environ.pop("IZ_KOSU", None)
        else:
            os.environ["IZ_KOSU"] = onceki
