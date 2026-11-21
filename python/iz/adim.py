"""Adım günlüğü: .iz/kosular/<kosu>.jsonl (git dışı)."""
from __future__ import annotations

import contextvars
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Self

from .maske import maskele, maskele_metin
from .sozlesme import SEMA_SURUMU

KOSU_DESEN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_ust: contextvars.ContextVar[str | None] = contextvars.ContextVar("iz_ust", default=None)


_uuid_kilit = threading.Lock()
_uuid_son_ms = -1
_uuid_sayac = 0


def uuid7(simdi_ms: int | None = None) -> str:
    """RFC 9562 UUIDv7, süreç içinde kesin artan (yöntem 1: 12 bit rand_a sayaç).

    Aynı milisaniyede sayaç bir artar; saat geri giderse son zaman damgası kullanılır; sayaç taşarsa
    zaman damgası bir milisaniye ileri alınır. Yeni milisaniyede sayaç 0-2047 arası rastgele başlar.
    """
    global _uuid_son_ms, _uuid_sayac
    with _uuid_kilit:
        ms = time.time_ns() // 1_000_000 if simdi_ms is None else simdi_ms
        if ms > _uuid_son_ms:
            _uuid_son_ms, _uuid_sayac = ms, secrets.randbits(11)
        else:
            _uuid_sayac += 1
            if _uuid_sayac > 0xFFF:
                _uuid_son_ms, _uuid_sayac = _uuid_son_ms + 1, secrets.randbits(11)
        ms, sayac = _uuid_son_ms, _uuid_sayac
    b = bytearray(ms.to_bytes(6, "big") + sayac.to_bytes(2, "big") + secrets.token_bytes(8))
    b[6] = (b[6] & 0x0F) | 0x70
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


_VEKIL = re.compile(r"[\ud800-\udfff]")


def guvenli_json(v: object) -> str:
    """Günlük satırı: NaN/sonsuz yok (allow_nan=False), bilinmeyen tür metin, eşsiz vekil karakter
    TS JSON.stringify gibi `\\udXXX` kaçışıyla (geçerli UTF-8, çökme yok)."""
    s = json.dumps(v, ensure_ascii=False, allow_nan=False, default=str)
    return _VEKIL.sub(lambda m: f"\\u{ord(m.group(0)):04x}", s)


def dosya_sha256(yol: str | os.PathLike[str]) -> str | None:
    p = Path(yol)
    if not p.is_file():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for blok in iter(lambda: f.read(1 << 20), b""):
            h.update(blok)
    return h.hexdigest()


def arac_surumu() -> str | None:
    try:
        r = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, timeout=5)
        return (r.stdout.strip() or None) if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def kosu_dogrula(kosu: str) -> str:
    """Koşu kimliği dosya adı olur: yol kaçışına (../, /, boş) izin yok."""
    if not isinstance(kosu, str) or not KOSU_DESEN.fullmatch(kosu):  # pyright: ignore[reportUnnecessaryIsInstance] -- tipsiz çağıran
        raise ValueError("geçersiz koşu kimliği (izinli: A-Z a-z 0-9 _ -, 1-64 karakter): " + repr(kosu))
    return kosu


def kosu_kimligi() -> str:
    return kosu_dogrula(os.environ.get("IZ_KOSU") or uuid7())


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class adim:
    def __init__(self, ad: str, girdiler: Iterable[str | os.PathLike[str]] = (),
                 nitelikler: dict[str, object] | None = None,
                 kok: str | os.PathLike[str] | None = None, kosu: str | None = None) -> None:
        self.ad = ad
        self.girdiler: list[str | os.PathLike[str]] = list(girdiler)
        self.nitelikler: dict[str, object] = nitelikler or {}
        self.kok = Path(kok or os.environ.get("IZ_DIZIN") or ".iz")
        self.kosu = kosu_dogrula(kosu) if kosu is not None else kosu_kimligi()
        self.id = secrets.token_hex(8)
        self.ciktilar: list[str | os.PathLike[str]] = []
        self.ust: str | None = None
        self.t0: float = 0.0  # duvar saati (yalnız zaman damgası)
        self.m0: int = 0  # monoton saat (yalnız süre)
        self._tok: contextvars.Token[str | None] | None = None

    def cikti(self, yol: str | os.PathLike[str]) -> None:
        self.ciktilar.append(yol)

    def __enter__(self) -> Self:
        self.ust = _ust.get()
        self._tok = _ust.set(self.id)
        self.t0 = time.time()
        self.m0 = time.monotonic_ns()
        return self

    def __exit__(self, tur: type[BaseException] | None, deger: BaseException | None,
                 tb: TracebackType | None) -> bool:
        if self._tok is not None:
            _ust.reset(self._tok)
        try:
            self._yaz(tur)
        except Exception as e:  # günlük hatası asıl istisnayı ezmemeli
            if tur is None:
                raise
            print(f"iz: günlük yazılamadı ({type(e).__name__}: {e}); asıl hata korunuyor", file=sys.stderr)
        return False

    def _yaz(self, tur: type[BaseException] | None) -> None:
        sure_ns = max(0, time.monotonic_ns() - self.m0)
        t1 = self.t0 + sure_ns / 1e9  # bitis = baslangic + monoton süre: saat geri gitse de sıra bozulmaz
        kayit = {
            "sema_surumu": SEMA_SURUMU,
            "kosu": self.kosu, "adim": self.id, "ust": self.ust, "ad": self.ad,
            "baslangic": _iso(self.t0), "bitis": _iso(t1), "sure_ms": sure_ns // 1_000_000,
            "sonuc": "hata" if tur else "tamam", "hata": maskele_metin(tur.__name__) if tur else None,
            "girdi": [{"yol": maskele_metin(str(y)), "sha256": dosya_sha256(y)} for y in self.girdiler],
            "cikti": [{"yol": maskele_metin(str(y)), "sha256": dosya_sha256(y)} for y in self.ciktilar],
            "arac_surumu": arac_surumu(), "nitelikler": maskele(self.nitelikler),
        }
        d = self.kok / "kosular"
        d.mkdir(parents=True, exist_ok=True)
        satir = guvenli_json(kayit) + "\n"
        with (d / f"{self.kosu}.jsonl").open("ab+") as f:
            # Önceki yazım yarım kaldıysa yeni kayıt onun sonuna yapışmasın: önce satır sonu.
            if f.seek(0, os.SEEK_END) > 0:
                f.seek(-1, os.SEEK_END)
                if f.read(1) != b"\n":
                    satir = "\n" + satir
            f.write(satir.encode("utf-8"))
