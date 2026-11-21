"""Depo görevleri: `python3 betikler/gorev.py test|kontrol|yuk`.

`yuk`: TS kilit yarışı, 14 süreç x 40 tur (IZ_YARIS_TUR, IZ_YARIS_SUREC ile değişir); bozulma 0 olmalı.

Her kapı iz'in kendisiyle bir adım olarak `.iz/kosular/` altına günlüklenir; sonunda eksik adım
kontrolü yapılır. Çıkış kodu ilk başarısız kapınınkidir.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Callable, Sequence
from pathlib import Path

KOK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KOK / "python"))

from iz import kapilari_kos  # noqa: E402

TS = KOK / "ts"
UV = ["uv", "run", "--locked", "--group", "dev"]

GOREVLER: dict[str, list[str]] = {
    "test": ["pytest", "vitest"],
    "kontrol": ["pytest", "vitest", "pyright", "tsc", "paket"],
    "yuk": ["yaris"],
}

WHEEL_GEREKEN = (
    "iz/__init__.py",
    "iz/sozlesme.py",
    "iz/_veri/sema/iz-adim.v1.json",
    "iz/_veri/sema/iz-defter.v1.json",
    "iz/_veri/testdata/defter_altin.jsonl",
    "iz/_veri/testdata/adim_altin.jsonl",
)


def calistir(komut: Sequence[str], cwd: Path = KOK) -> int:
    print("$ " + " ".join(komut), flush=True)
    return subprocess.run(list(komut), cwd=cwd, check=False).returncode


def ts_hazirla() -> int:
    if (TS / "node_modules").is_dir():
        return 0
    return calistir(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], TS)


def wheel_eksikleri(adlar: Sequence[str]) -> list[str]:
    eksik = [g for g in WHEEL_GEREKEN if g not in adlar]
    if not any(a.endswith(".dist-info/licenses/LICENSE") for a in adlar):
        eksik.append("*.dist-info/licenses/LICENSE")
    return eksik


def paket() -> int:
    """Wheel'i kurar, paket verisini (şema, altın dosya) kurulu paketten okur."""
    with tempfile.TemporaryDirectory(prefix="iz-paket-") as t:
        d = Path(t)
        if (kod := calistir(["uv", "build", "--wheel", "--out-dir", str(d / "dist")])) != 0:
            return kod
        wheel = next((d / "dist").glob("iz-*.whl"))
        with zipfile.ZipFile(wheel) as z:
            eksik = wheel_eksikleri(z.namelist())
        if eksik:
            print("paket: wheel'de eksik: " + ", ".join(eksik), file=sys.stderr)
            return 1
        if (kod := calistir(["uv", "venv", "--quiet", str(d / "v")])) != 0:
            return kod
        py = str(d / "v" / "bin" / "python")
        if (kod := calistir(["uv", "pip", "install", "--quiet", "--python", py, str(wheel)])) != 0:
            return kod
        betik = ("import iz,subprocess,sys;"
                 "p=iz.sema_yolu('defter');assert p.is_file() and '_veri' in str(p),p;"
                 "t=iz.testdata_dizini()/'defter_altin.jsonl';assert iz.dogrula(t)==[];"
                 "sys.exit(subprocess.run([sys.executable,'-m','iz','defter-dogrula',str(t)]).returncode)")
        return calistir([py, "-I", "-c", betik], d)


def kapi_kos(kapi: str) -> int:
    if kapi == "pytest":
        return calistir([*UV, "pytest", "-q"])
    if kapi == "pyright":
        return calistir([*UV, "pyright"])
    if kapi in ("vitest", "tsc"):
        if (kod := ts_hazirla()) != 0:
            return kod
        return calistir(["npx", "vitest", "run"] if kapi == "vitest" else ["npx", "tsc", "--noEmit"], TS)
    if kapi == "paket":
        return paket()
    if kapi == "yaris":
        if (kod := ts_hazirla()) != 0:
            return kod
        os.environ.setdefault("IZ_YARIS_TUR", "40")
        return calistir(["npx", "vitest", "run", "test/yaris.test.ts"], TS)
    raise ValueError(f"bilinmeyen kapı: {kapi}")


def main(argv: Sequence[str] | None = None, kos: Callable[[str], int] = kapi_kos,
         kok: Path | None = None) -> int:
    arg = list(sys.argv[1:] if argv is None else argv)
    if len(arg) != 1 or arg[0] not in GOREVLER:
        print(f"kullanım: gorev.py {{{','.join(GOREVLER)}}}", file=sys.stderr)
        return 2
    if shutil.which("uv") is None:
        print("gorev: uv yok", file=sys.stderr)
        return 4
    kod = kapilari_kos(GOREVLER[arg[0]], kos, kok=kok or Path(os.environ.get("IZ_DIZIN") or KOK / ".iz"),
                       nitelikler={"gorev": arg[0]})
    print(f"gorev {arg[0]}: " + ("tamam" if kod == 0 else f"kırmızı (çıkış {kod})"), flush=True)
    return kod


if __name__ == "__main__":
    sys.exit(main())
