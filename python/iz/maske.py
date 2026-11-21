"""Maskeleme: gizli alan adları, e-posta/telefon, kişisel veri ve bilinen sır biçimleri -> ***.

Sözlük anahtarı da metin olarak maskelenir (anahtarı e-posta olan alan sızmasın). Alan adı kuralı
(ALAN) özgün anahtara bakar; maskelenen anahtar başka bir anahtarla çakışırsa `***#2`, `***#3` olur.
TS `maske.ts` ile aynı desenler ve aynı sıra. Metin desenleri `re.ASCII` ile derlenir (`\\b`, `\\w`, `\\d`
JS'teki gibi yalnız ASCII; "çBearer ..." iki dilde de maskelenir), `\\s` yerine açık `[\\t\\n\\v\\f\\r ]` yazılır
(JS `\\s` Unicode boşlukları da sayar, Python farklı küme; açık sınıf iki dilde aynıdır).
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from typing import cast

MASKE = "***"
INT64_ALT, INT64_UST = -(2**63), 2**63 - 1
# Alan adı deseni ASCII, normalleştirilmiş ada uygulanır (TS ile aynı). `re.I` Unicode harf katladığı, JS `/i`
# katlamadığı için iki dilde ayrışıyordu (ŞİFRE, sıfre, ſecret, Kelvin işaretli toKen TS'de sızıyordu).
ALAN = re.compile(r"(token|secret|password|passwd|pwd|sifre|parola|api[_-]?key|private[_-]?key|anahtar"
                  r"|authorization|cookie|credential)", re.A)
# Türkçe harfler açık tabloyla (NFKC'den sonra): İ/I/ı/i -> i, ş -> s, ç -> c, ğ -> g, ü -> u, ö -> o.
TR_TABLO = str.maketrans({"İ": "i", "I": "i", "ı": "i", "Ş": "s", "ş": "s", "Ç": "c", "ç": "c", "Ğ": "g", "ğ": "g",
                          "Ü": "u", "ü": "u", "Ö": "o", "ö": "o"})
_ASCII_KUCUK = str.maketrans({chr(c): chr(c + 32) for c in range(ord("A"), ord("Z") + 1)})


def alan_adi_normal(k: str) -> str:
    """NFKC (ſ -> s, Kelvin K -> K, tam genişlik -> ASCII), Türkçe tablo, ASCII küçük harf. TS `alanAdiNormal` ile aynı."""
    return unicodedata.normalize("NFKC", k).translate(TR_TABLO).translate(_ASCII_KUCUK)


def gizli_alan(k: str) -> bool:
    return ALAN.search(alan_adi_normal(k)) is not None
EPOSTA = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_ON = r"(?<![A-Za-z0-9_])"  # sol sınır: harf, rakam ya da _ değil
# Sıra önemli: PEM blok önce (içi base64), Bearer jetondan önce, telefon en sonda.
SIRLAR = (
    re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|(?![\s\S]))", re.A),
    re.compile(r"\bBearer[\t\n\v\f\r ]+[A-Za-z0-9._~+/=-]{8,}", re.I | re.A),
    re.compile(_ON + r"github_pat_[A-Za-z0-9_]{20,}", re.A),
    re.compile(_ON + r"gh[pousr]_[A-Za-z0-9]{20,}", re.A),
    re.compile(_ON + r"sk-[A-Za-z0-9_-]{16,}", re.A),
    re.compile(_ON + r"[sr]k_(?:live|test)_[A-Za-z0-9]{10,}", re.A),
    re.compile(_ON + r"xox[abposr]-[A-Za-z0-9-]{10,}", re.A),
    re.compile(_ON + r"AIza[0-9A-Za-z_-]{35}", re.A),
    re.compile(_ON + r"glpat-[0-9A-Za-z_-]{20,}", re.A),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b", re.A),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}", re.A),
)
# Başlık biçimi: adı kalır, değeri gider ("Authorization: Basic xxx" -> "Authorization: ***").
BASLIKLAR = (
    re.compile(r"(\b(?:proxy-)?authorization[\t\n\v\f\r ]*[:=][\t\n\v\f\r ]*)(?:(?:basic|digest|token|negotiate)[\t\n\v\f\r ]+)?[^\t\n\v\f\r ,;]+", re.I | re.A),
    re.compile(r"(\b(?:set-)?cookie[\t\n\v\f\r ]*:[\t\n\v\f\r ]*)[^\r\n]+", re.I | re.A),
)
# TC kimlik: 11 hane, ilk hane 0 değil, iki denetim hanesi tutmalı; harf/rakam komşusu olmamalı (sha256, ULID).
TCKN = re.compile(r"(?<![0-9A-Za-z])[1-9][0-9]{10}(?![0-9A-Za-z])", re.A)
# TR IBAN: TR + 24 hane (dörtlü gruplar arası tek boşluk olabilir); mod-97 = 1 olmalı.
IBAN = re.compile(r"(?<![0-9A-Za-z])TR[0-9]{2}(?: ?[0-9]{4}){5} ?[0-9]{2}(?![0-9A-Za-z])", re.I | re.A)
# Telefon: + ile ya da başında 0 ile başlar; tarih (2026-11-19, 19.11.2026, 01-02-2026) ve uzun sayı/özet değildir.
TELEFON = re.compile(
    r"(?<![\w.:+/-])(?!\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d\d-\d\d)"
    r"(?:\+\d{1,3}|0)[\t\n\v\f\r \-()]*\d[\d\t\n\v\f\r \-()]{5,}\d(?!\w)",
    re.A,
)


def tckn_gecerli(s: str) -> bool:
    if len(s) != 11 or not s.isascii() or not s.isdigit() or s[0] == "0":
        return False
    d = [int(c) for c in s]
    return (sum(d[0:9:2]) * 7 - sum(d[1:8:2])) % 10 == d[9] and sum(d[:10]) % 10 == d[10]


def iban_gecerli(s: str) -> bool:
    s = s.replace(" ", "").upper()
    if len(s) < 5 or not s.isascii() or not s.isalnum():
        return False
    duzen = s[4:] + s[:4]
    return int("".join(str(int(c, 36)) for c in duzen)) % 97 == 1


def _denetimli(desen: re.Pattern[str], gecerli: Callable[[str], bool], s: str) -> str:
    return desen.sub(lambda m: MASKE if gecerli(m.group(0)) else m.group(0), s)


def maskele_metin(s: str) -> str:
    for d in SIRLAR:
        s = d.sub(MASKE, s)
    for b in BASLIKLAR:
        s = b.sub(lambda m: m.group(1) + MASKE, s)
    s = _denetimli(IBAN, iban_gecerli, s)
    s = _denetimli(TCKN, tckn_gecerli, s)
    return TELEFON.sub(MASKE, EPOSTA.sub(MASKE, s))


def _anahtar(k: str, kullanilan: set[str]) -> str:
    m = maskele_metin(k)
    if m in kullanilan:
        i = 2
        while f"{m}#{i}" in kullanilan:
            i += 1
        m = f"{m}#{i}"
    kullanilan.add(m)
    return m


def maskele(v: object) -> object:
    if isinstance(v, dict):
        d = cast("dict[object, object]", v)
        out: dict[str, object] = {}
        kullanilan = set[str]()
        for k, x in d.items():
            ks = str(k)
            out[_anahtar(ks, kullanilan)] = MASKE if gizli_alan(ks) else maskele(x)
        return out
    if isinstance(v, (list, tuple)):
        return [maskele(x) for x in cast("list[object]", v)]
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        # 64 bit dışı tam sayı metne çevrilir (TS: bigint -> metin); okuyucular taşmasın.
        return v if INT64_ALT <= v <= INT64_UST else str(v)
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None  # TS JSON.stringify: NaN -> null
    return maskele_metin(v if isinstance(v, str) else str(v))
