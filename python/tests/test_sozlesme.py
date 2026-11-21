"""Sözleşme: altın dosyalar ve iki dilin ürettiği kayıtlar sema/ şemalarına uyar; sema_surumu geriye uyumlu."""
import json
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

import iz
from iz import defter

KOK = Path(__file__).resolve().parents[2]
TD = KOK / "testdata"
DEFTER_DOSYALARI = ["defter_altin.jsonl", "defter_altin_v1_alansiz.jsonl", "defter_bozuk.jsonl",
                    "defter_surum_ileri.jsonl"]


def denetci(ad: str) -> Draft202012Validator:
    sema = json.loads(iz.sema_yolu(ad).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(sema)
    return Draft202012Validator(sema)


def satirlar(p: Path) -> list[dict]:
    return [json.loads(s) for s in p.read_text(encoding="utf-8").splitlines() if s.strip()]


def hatalar(d: Draft202012Validator, kayit: dict) -> list[str]:
    return [f"{list(h.absolute_path)}: {h.message}" for h in d.iter_errors(kayit)]


def test_semalar_paketin_verdigi_yerde_ve_gecerli():
    assert iz.sema_yolu("adim") == KOK / "sema" / "iz-adim.v1.json"
    assert iz.testdata_dizini() == TD
    for ad in ("adim", "defter"):
        denetci(ad)


@pytest.mark.parametrize("dosya", DEFTER_DOSYALARI)
def test_altin_defter_dosyalari_semaya_uyar(dosya):
    d = denetci("defter")
    for n, k in enumerate(satirlar(TD / dosya), 1):
        if dosya == "defter_surum_ileri.jsonl":
            assert hatalar(d, k), "ileri sürüm v1 şemasından geçmemeli"
        else:
            assert hatalar(d, k) == [], f"{dosya} satır {n}"


def test_altin_adim_dosyasi_semaya_uyar():
    d = denetci("adim")
    kay = satirlar(TD / "adim_altin.jsonl")
    assert any("sema_surumu" not in k for k in kay) and any(k.get("sema_surumu") == 1 for k in kay)
    for n, k in enumerate(kay, 1):
        assert hatalar(d, k) == [], f"satır {n}"
        assert iz.kayit_surumu(k) == 1


def test_sema_tutarsiz_kaydi_yakalar():
    d = denetci("adim")
    k = satirlar(TD / "adim_altin.jsonl")[0]
    assert hatalar(d, {**k, "sonuc": "tamam", "hata": "X"})
    assert hatalar(d, {**k, "sema_surumu": 2})
    assert hatalar(d, {x: v for x, v in k.items() if x != "ad"})
    assert hatalar(d, {**k, "yeni_alan": 1}) == []  # alan eklemek minor: v1 okuyucu kabul eder


def test_python_kayitlari_semaya_uyar(tmp_path):
    kok = tmp_path / ".iz"
    g = tmp_path / "g.txt"
    g.write_text("x")
    with iz.adim("uret", girdiler=[g, tmp_path / "yok"], nitelikler={"sifre": "s"}, kok=kok, kosu="PS1") as a:
        a.cikti(g)
    with pytest.raises(KeyError):
        with iz.adim("hata", kok=kok, kosu="PS1"):
            raise KeyError("x")
    da = denetci("adim")
    for k in satirlar(kok / "kosular/PS1.jsonl"):
        assert k["sema_surumu"] == iz.SEMA_SURUMU == 1
        assert hatalar(da, k) == []
    defter.ekle(tmp_path / "d.jsonl", "karar", "o", "k", "g", "kim", "a1")
    for k in satirlar(tmp_path / "d.jsonl"):
        assert k["sema_surumu"] == 1 and hatalar(denetci("defter"), k) == []


def test_ts_kayitlari_semaya_uyar(tmp_path):
    node = shutil.which("node")
    assert node, "node yok (Node 24 gerekli)"
    subprocess.run([node, str(KOK / "ts/test/kayit_uret.ts"), str(tmp_path)], check=True)
    da, dd = denetci("adim"), denetci("defter")
    adimlar = satirlar(tmp_path / ".iz/kosular/TS1.jsonl")
    assert len(adimlar) == 2
    for k in adimlar:
        assert k["sema_surumu"] == 1 and hatalar(da, k) == []
    assert next(k for k in adimlar if k["ad"] == "ts_uret")["nitelikler"]["parola"] == "***"
    for k in satirlar(tmp_path / "defter.jsonl"):
        assert k["sema_surumu"] == 1 and hatalar(dd, k) == []
    assert defter.dogrula(tmp_path / "defter.jsonl") == []


def test_alansiz_eski_defter_dogrulanir_ve_uzerine_eklenir(tmp_path):
    assert defter.dogrula(TD / "defter_altin_v1_alansiz.jsonl") == []
    p = tmp_path / "d.jsonl"
    shutil.copy(TD / "defter_altin_v1_alansiz.jsonl", p)
    k = defter.ekle(p, "karar", "o", "k", "g", "kim", "k-yeni", "2026-11-19T11:00:00Z")
    assert k["sema_surumu"] == 1 and k["sira"] == 4
    assert defter.dogrula(p) == []


def test_ileri_surum_reddedilir():
    beklenen = (TD / "defter_surum_ileri.beklenen").read_text(encoding="utf-8").strip()
    assert defter.dogrula(TD / "defter_surum_ileri.jsonl") == [beklenen]
    for s in (2, 0, "1", True, None, 1.5):
        with pytest.raises(iz.SurumHatasi):
            iz.kayit_surumu({"sema_surumu": s})
    assert iz.kayit_surumu({}) == 1


def test_kontrol_ileri_surumu_reddeder(tmp_path):
    kok = tmp_path / ".iz"
    (kok / "kosular").mkdir(parents=True)
    k = {**satirlar(TD / "adim_altin.jsonl")[0], "kosu": "KV", "sema_surumu": 2}
    (kok / "kosular/KV.jsonl").write_text(json.dumps(k) + "\n")
    with pytest.raises(iz.SurumHatasi):
        iz.eksik_adimlar(kok, "KV", ["uret"])
    r = subprocess.run([sys.executable, "-m", "iz", "--kok", str(kok), "kontrol", "--kosu", "KV", "--gerekli", "uret"],
                       capture_output=True, text=True, cwd=KOK / "python")
    assert r.returncode == 2 and "sema_surumu" in r.stderr


def test_surumler_ayni():
    py = tomllib.loads((KOK / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    ts = json.loads((KOK / "ts/package.json").read_text(encoding="utf-8"))["version"]
    assert py == ts == iz.__version__
    assert f"## {py}" in (KOK / "CHANGELOG.md").read_text(encoding="utf-8")
