"""Köken kartı: dosyanın sha256'sından üreten adım ve girdileri geriye doğru."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .adim import dosya_sha256
from .kontrol import gunluk_oku

KOKEN_ALANLARI = ("kosu", "adim", "ad", "bitis", "sonuc", "girdi", "cikti")


def _dosya_listesi(v: object) -> bool:
    return isinstance(v, list) and all(isinstance(x, dict) and "sha256" in x and "yol" in x for x in v)  # pyright: ignore[reportUnknownVariableType]


def _denetle(k: dict[str, Any]) -> str | None:
    return None if _dosya_listesi(k["girdi"]) and _dosya_listesi(k["cikti"]) else "girdi/cikti biçimi bozuk"


def kayitlar(kok: str | Path, hatalar: list[str] | None = None) -> list[dict[str, Any]]:
    """Tüm koşu günlükleri; bozuk satırlar atlanır, `hatalar` verilirse `<dosya> satır n: ...` eklenir."""
    out: list[dict[str, Any]] = []
    for p in sorted((Path(kok) / "kosular").glob("*.jsonl")):
        kay, h = gunluk_oku(p, KOKEN_ALANLARI, onek=f"{p.name} ", denetle=_denetle)
        out += kay
        if hatalar is not None:
            hatalar.extend(h)
    return out


def agac(sha: str | None, yol: str | None, tum: list[dict[str, Any]],
         gorulen: frozenset[str] = frozenset()) -> dict[str, Any]:
    dugum: dict[str, Any] = {"sha256": sha, "dosya": yol, "uretici": None}
    if sha is None or sha in gorulen:
        return dugum
    uretenler = [k for k in tum if any(c["sha256"] == sha for c in k["cikti"])]
    if uretenler:
        k = max(uretenler, key=lambda x: str(x["bitis"]))
        dugum["uretici"] = {
            "ad": k["ad"], "kosu": k["kosu"], "adim": k["adim"], "bitis": k["bitis"],
            "sonuc": k["sonuc"], "arac_surumu": k.get("arac_surumu"),
            "girdiler": [agac(g["sha256"], g["yol"], tum, gorulen | {sha}) for g in k["girdi"]],
        }
    return dugum


def koken(dosya: str | Path, kok: str | Path = ".iz", hatalar: list[str] | None = None) -> dict[str, Any]:
    sha = dosya_sha256(dosya)
    if sha is None:
        raise FileNotFoundError(dosya)
    return agac(sha, str(dosya), kayitlar(kok, hatalar))


def markdown(d: dict[str, Any], girinti: int = 0) -> str:
    pad = "  " * girinti
    satir = f"{pad}- `{d['dosya'] or '?'}` sha256 `{(d['sha256'] or 'yok')[:12]}`"
    u = d["uretici"]
    if not u:
        return satir + " (üretici kayıtlı değil)\n"
    satir += f" <- adım **{u['ad']}** (koşu {u['kosu']}, {u['sonuc']}, araç {u['arac_surumu'] or '-'})\n"
    return satir + "".join(markdown(g, girinti + 1) for g in u["girdiler"])
