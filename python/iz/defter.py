"""Karar defteri: append-only JSONL, her kayıt öncekinin sha256'sını taşır.

Satır kuralı: her satır, kaydın kanonik serileştirmesi + "\\n" ile bayt bayt aynıdır. CRLF, boşluklu ya da
yeniden biçimlenmiş satır, aynı anahtarın iki kez geçmesi, ondalık ya da güvenli aralık dışı sayı reddedilir.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NoReturn, cast

from .sozlesme import SEMA_SURUMU, SurumHatasi, kayit_surumu

Yol = str | os.PathLike[str]
SIFIR = "0" * 64
ALANLAR = ("sira", "onceki", "tur", "ozne", "karar", "gerekce", "kim", "anahtar", "zaman")
# İki dilde bayt eşliği için I-JSON (RFC 7493) güvenli tam sayı aralığı; 64 bit aralığının alt kümesi.
GUVENLI_TAM = 2**53 - 1
_VEKIL = re.compile(r"[\ud800-\udfff]")
# Şema (sema/iz-defter.v1.json) ile aynı: metin alanlar, boş olamayanlar, biçimler.
_BOS_OLMAZ = frozenset({"tur", "kim", "anahtar"})
_BICIM = {"onceki": re.compile(r"[0-9a-f]{64}"), "hash": re.compile(r"[0-9a-f]{64}"),
          "zaman": re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z")}


def alan_hatasi(k: dict[str, Any]) -> str | None:
    """İlk tür/biçim hatası (ALANLAR sırası, sonra hash); yoksa None. TS `alanHatasi` ile aynı ileti."""
    for a in (*ALANLAR, "hash"):
        v = k[a]
        if a == "sira":
            if type(v) is not int:
                return "sıra tam sayı değil"
            continue
        if not isinstance(v, str):
            return f"alan {a} metin değil"
        if a in _BOS_OLMAZ and v == "":
            return f"alan {a} boş"
        b = _BICIM.get(a)
        if b is not None and not b.fullmatch(v):
            return f"alan {a} biçimi geçersiz"
    return None


class DefterHatasi(Exception):
    pass


class KanonikHatasi(DefterHatasi, ValueError):
    """Değer kanonik biçimde yazılamaz (ondalık, aralık dışı tam sayı, eşsiz vekil karakter, bilinmeyen tür)."""


def _sina(v: object) -> None:
    if v is None or isinstance(v, bool):
        return
    if isinstance(v, int):
        if not -GUVENLI_TAM <= v <= GUVENLI_TAM:
            raise KanonikHatasi(f"tam sayı güvenli aralık dışında: {v}")
        return
    if isinstance(v, str):
        if _VEKIL.search(v):
            raise KanonikHatasi("eşsiz vekil karakter (U+D800-U+DFFF) kanonik biçimde yazılamaz")
        return
    if isinstance(v, list):
        for x in cast("list[object]", v):
            _sina(x)
        return
    if isinstance(v, dict):
        for k, x in cast("dict[object, object]", v).items():
            if not isinstance(k, str):
                raise KanonikHatasi(f"anahtar metin değil: {k!r}")
            _sina(k)
            _sina(x)
        return
    if isinstance(v, float):
        raise KanonikHatasi(f"ondalık sayı kanonik biçimde desteklenmez: {v!r}")
    raise KanonikHatasi(f"desteklenmeyen tür: {type(v).__name__}")


def kanonik(kayit: dict[str, Any]) -> str:
    """Anahtarlar kod noktasına göre sıralı, boşluksuz, ASCII dışı olduğu gibi; yalnız metin, tam sayı, bool, null."""
    _sina(kayit)
    return json.dumps(kayit, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def ozet(kayit: dict[str, Any]) -> str:
    govde = {k: v for k, v in kayit.items() if k != "hash"}
    return hashlib.sha256(kanonik(govde).encode("utf-8")).hexdigest()


def _sabit_yok(ad: str) -> NoReturn:
    raise ValueError(f"JSON dışı sabit: {ad}")


def satir_coz(ham: bytes) -> dict[str, Any] | str:
    """Ham satırı (satır sonu hariç) çözer; kural dışıysa hata metni (satır numarasız) döner."""
    if ham == b"":
        return "boş satır"
    try:
        metin = ham.decode("utf-8")
    except UnicodeDecodeError:
        return "UTF-8 değil"
    try:
        j: object = json.loads(metin, parse_constant=_sabit_yok)
    except (ValueError, RecursionError):
        return "JSON değil"
    if not isinstance(j, dict):
        return "JSON değil"
    k = cast("dict[str, Any]", j)
    try:
        if kanonik(k).encode("utf-8") != ham:
            return "kanonik biçimde değil"
    except (KanonikHatasi, RecursionError):
        return "kanonik biçimde değil"
    return k


def _bol(veri: bytes) -> tuple[list[bytes], bytes]:
    """Tam satırlar ve son satır sonundan sonra kalan yarım parça."""
    parcalar = veri.split(b"\n")
    return parcalar[:-1], parcalar[-1]


def oku(yol: Yol) -> list[str]:
    p = Path(yol)
    return [s for s in p.read_text(encoding="utf-8").split("\n") if s != ""] if p.exists() else []


def capa_yolu(yol: Yol) -> Path:
    return Path(yol).with_suffix(".son")


def _dizin_fsync(d: Path) -> None:
    fd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def capa_yaz(yol: Yol, hash_: str) -> None:
    """Son kaydın hash'i ayrı dosyada: kuyruk kesmeyi dogrula() yakalar. Geçici dosya + fsync + rename."""
    c = capa_yolu(yol)
    gecici = c.with_name(c.name + ".tmp")
    with gecici.open("w", encoding="utf-8") as f:
        f.write(hash_ + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(gecici, c)
    _dizin_fsync(c.parent)


def _incele(yol: Yol) -> tuple[list[str], list[dict[str, Any]]]:
    """(hatalar, kayıtlar); ilk bozuk satırda durur."""
    p = Path(yol)
    tam, yarim = _bol(p.read_bytes()) if p.exists() else ([], b"")
    onceki, gorulen, gorulen_hash = SIFIR, set[str](), set[str]()
    kayitlar: list[dict[str, Any]] = []
    for n, ham in enumerate(tam, 1):
        k = satir_coz(ham)
        if isinstance(k, str):
            return [f"satır {n}: {k}"], kayitlar
        eksik = [a for a in (*ALANLAR, "hash") if a not in k]
        if eksik:
            return [f"satır {n}: eksik alan {','.join(eksik)}"], kayitlar
        try:
            kayit_surumu(k)
        except SurumHatasi as e:
            return [f"satır {n}: {e}"], kayitlar
        if (h := alan_hatasi(k)) is not None:
            return [f"satır {n}: {h}"], kayitlar
        if k["sira"] != n:
            return [f"satır {n}: sıra {k['sira']} beklenen {n}"], kayitlar
        if k["onceki"] != onceki:
            return [f"satır {n}: önceki özet uyuşmuyor"], kayitlar
        if k["hash"] != ozet(k):
            return [f"satır {n}: özet uyuşmuyor"], kayitlar
        if k["anahtar"] in gorulen:
            return [f"satır {n}: anahtar tekrarı {k['anahtar']}"], kayitlar
        gorulen.add(str(k["anahtar"]))
        onceki = str(k["hash"])
        gorulen_hash.add(onceki)
        kayitlar.append(k)
    if yarim:
        return [f"satır {len(tam) + 1}: yarım satır (satır sonu yok; kurtarma: iz defter-onar)"], kayitlar
    c = capa_yolu(yol)
    if c.exists():
        son = c.read_text(encoding="utf-8").strip()
        # Çapa zincirde olmalı (yazım çökmesinde defter çapadan en çok bir kayıt ileride olabilir).
        if son not in gorulen_hash:
            return [f"çapa uyuşmuyor: son kayıt {son[:12]} defterde yok (kuyruk kesilmiş olabilir)"], kayitlar
    return [], kayitlar


def dogrula(yol: Yol) -> list[str]:
    """Hata listesi döner (ilk bozuk satırda durur); boşsa zincir sağlam."""
    return _incele(yol)[0]


def ekle(yol: Yol, tur: str, ozne: str, karar: str, gerekce: str, kim: str, anahtar: str,
         zaman: str | None = None) -> dict[str, Any]:
    """Kilit altında okuyup ekler: süreçler arası okuma+yazma tek parça (flock)."""
    p = Path(yol)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("ab") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            hatalar, kayitlar = _incele(p)
            if hatalar:
                raise DefterHatasi(f"defter bozuk, ekleme reddedildi: {hatalar[0]}")
            if any(k["anahtar"] == anahtar for k in kayitlar):
                raise DefterHatasi(f"anahtar zaten var: {anahtar}")
            onceki = str(kayitlar[-1]["hash"]) if kayitlar else SIFIR
            zaman = zaman or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            kayit: dict[str, Any] = dict(sema_surumu=SEMA_SURUMU, sira=len(kayitlar) + 1, onceki=onceki, tur=tur,
                                         ozne=ozne, karar=karar, gerekce=gerekce, kim=kim, anahtar=anahtar, zaman=zaman)
            if (h := alan_hatasi({**kayit, "hash": SIFIR})) is not None:
                raise DefterHatasi(f"geçersiz kayıt: {h}")
            kayit["hash"] = ozet(kayit)  # kanonik değilse (vekil, ondalık) burada KanonikHatasi, dosyaya dokunulmaz
            f.write((kanonik(kayit) + "\n").encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
            capa_yaz(p, kayit["hash"])
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    return kayit


def onek_denetle(eski: bytes, yeni: bytes) -> str | None:
    """Yalnız sona ekleme: eski, yeninin bayt öneki olmalı. Değilse hata metni."""
    if yeni.startswith(eski):
        return None
    i = 0
    sinir = min(len(eski), len(yeni))
    while i < sinir and eski[i] == yeni[i]:
        i += 1
    satir = eski[:i].count(b"\n") + 1
    if i == len(yeni):
        return f"satır {satir}: yeni defter eskisinden kısa (kuyruk kesilmiş); defter yalnız sona eklenebilir"
    return f"satır {satir} (bayt {i}): eski içerik değişmiş; defter yalnız sona eklenebilir"


def yarim_yolu(yol: Yol) -> Path:
    return Path(str(yol) + ".yarim")


def onar(yol: Yol) -> tuple[int, Path | None]:
    """Son yarım satırı (son satır sonundan sonrası) `<yol>.yarim` dosyasının sonuna taşır, defteri keser.

    Yalnız yarım parçaya dokunur; tam satırlar olduğu gibi kalır. (taşınan bayt, .yarim yolu) döner.
    """
    p = Path(yol)
    with p.open("r+b") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            veri = f.read()
            _, yarim = _bol(veri)
            if not yarim:
                return 0, None
            y = yarim_yolu(p)
            with y.open("ab") as yf:  # kanıt: önceki .yarim içeriği silinmez
                yf.write(yarim + b"\n")
                yf.flush()
                os.fsync(yf.fileno())
            f.truncate(len(veri) - len(yarim))
            f.flush()
            os.fsync(f.fileno())
            _dizin_fsync(p.parent)
            return len(yarim), y
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
