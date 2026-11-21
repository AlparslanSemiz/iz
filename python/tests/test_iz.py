import json
import subprocess
import sys
from pathlib import Path

import pytest

import iz
from iz import defter

PAKET_KOKU = Path(iz.__file__).resolve().parents[1]  # `python -m iz` buradan çalışır
TD = Path(__file__).resolve().parents[2] / "testdata"
GIRDILER = json.loads((TD / "defter_girdi.json").read_text(encoding="utf-8"))


def uret(yol):
    for g in GIRDILER:
        defter.ekle(yol, g["tur"], g["ozne"], g["karar"], g["gerekce"], g["kim"], g["anahtar"], g["zaman"])


def test_altin_defter_ayni_bayt(tmp_path):
    uret(tmp_path / "d.jsonl")
    assert (tmp_path / "d.jsonl").read_bytes() == (TD / "defter_altin.jsonl").read_bytes()


def test_altin_dogrulanir():
    assert defter.dogrula(TD / "defter_altin.jsonl") == []


def test_bozuk_satir_numarasi():
    beklenen = (TD / "defter_bozuk.beklenen").read_text().strip()
    assert defter.dogrula(TD / "defter_bozuk.jsonl") == [beklenen]


def test_anahtar_tekrari_reddedilir(tmp_path):
    uret(tmp_path / "d.jsonl")
    with pytest.raises(defter.DefterHatasi):
        defter.ekle(tmp_path / "d.jsonl", "t", "o", "k", "g", "kim", GIRDILER[0]["anahtar"])


def test_zincir_kirilirsa(tmp_path):
    p = tmp_path / "d.jsonl"
    uret(p)
    s = p.read_text(encoding="utf-8").split("\n")
    del s[1]
    p.write_text("\n".join(s), encoding="utf-8")
    assert defter.dogrula(p)[0].startswith("satır 2")


def test_maskeleme():
    # sahte sır örnekleri dosyada <~> ile bölünmüş (sır tarayıcıları için); yüklerken birleştirilir
    for c in json.loads((TD / "maskele.json").read_text(encoding="utf-8").replace("<~>", "")):
        assert iz.maskele(c["girdi"]) == c["beklenen"]


def test_adim_koken_kontrol(tmp_path):
    g, c = tmp_path / "g.txt", tmp_path / "c.txt"
    g.write_text("girdi")
    kok = tmp_path / ".iz"
    with iz.adim("uret", girdiler=[g], nitelikler={"token": "abc"}, kok=kok, kosu="K1") as a:
        with iz.adim("ic", kok=kok, kosu="K1"):
            pass
        c.write_text("cikti")
        a.cikti(c)
    with pytest.raises(ValueError):
        with iz.adim("bozuk", kok=kok, kosu="K1"):
            raise ValueError("x")
    kay = [json.loads(s) for s in (kok / "kosular/K1.jsonl").read_text().splitlines()]
    ic = next(k for k in kay if k["ad"] == "ic")
    ana = next(k for k in kay if k["ad"] == "uret")
    assert ic["ust"] == ana["adim"] and ana["ust"] is None
    assert ana["nitelikler"]["token"] == "***" and ana["cikti"][0]["sha256"]
    assert next(k for k in kay if k["ad"] == "bozuk")["hata"] == "ValueError"
    agac = iz.koken(c, kok)
    assert agac["uretici"]["ad"] == "uret"
    assert agac["uretici"]["girdiler"][0]["dosya"] == str(g)
    assert "uret" in iz.markdown(agac)
    assert iz.eksik_adimlar(kok, "K1", ["uret", "bozuk", "yok"]) == ["bozuk", "yok"]


def test_cli_kontrol(tmp_path):
    kok = tmp_path / ".iz"
    with iz.adim("a", kok=kok, kosu="K2"):
        pass

    def calis(gerekli):
        return subprocess.run(
            [sys.executable, "-m", "iz", "--kok", str(kok), "kontrol", "--kosu", "K2", "--gerekli", gerekli],
            capture_output=True, text=True, cwd=PAKET_KOKU).returncode

    assert calis("a") == 0
    assert calis("a,b") == 1


def test_uuid7():
    u = iz.uuid7()
    assert u[14] == "7" and len(u) == 36


def test_cli_koken(tmp_path):
    # Paket koken fonksiyonu koken modülünü gölgeler; CLI fonksiyonu doğrudan almalı.
    kok, c = tmp_path / ".iz", tmp_path / "c.txt"
    with iz.adim("uret", kok=kok, kosu="K3") as a:
        c.write_text("cikti")
        a.cikti(c)
    r = subprocess.run([sys.executable, "-m", "iz", "--kok", str(kok), "koken", str(c), "--bicim", "md"],
                       capture_output=True, text=True, cwd=PAKET_KOKU)
    assert r.returncode == 0, r.stderr
    assert "uret" in r.stdout


def _ekle_isci(args):
    yol, n = args
    for i in range(5):
        defter.ekle(yol, "t", "o", "k", "g", "kim", f"p{n}-{i}")


def test_es_zamanli_ekle_zinciri_bozmaz(tmp_path):
    import multiprocessing

    p = str(tmp_path / "d.jsonl")
    with multiprocessing.get_context("spawn").Pool(8) as havuz:
        havuz.map(_ekle_isci, [(p, n) for n in range(8)], chunksize=1)
    assert len(Path(p).read_text(encoding="utf-8").splitlines()) == 40
    assert defter.dogrula(p) == []


def test_kapilari_kos_gecer(tmp_path):
    kok = tmp_path / ".iz"
    assert iz.kapilari_kos(["a", "b"], lambda k: 0, kosu="KG", kok=kok) == 0
    assert iz.eksik_adimlar(kok, "KG", ["a", "b"]) == []


def test_kapilari_kos_hata_durdurur_ve_hata_yazar(tmp_path):
    kok = tmp_path / ".iz"
    gorulen = []

    def kos(k):
        gorulen.append(k)
        return 3 if k == "b" else 0

    assert iz.kapilari_kos(["a", "b", "c"], kos, kosu="KH", kok=kok) == 3
    assert gorulen == ["a", "b"]
    kay = [json.loads(s) for s in (kok / "kosular/KH.jsonl").read_text().splitlines()]
    b = next(k for k in kay if k["ad"] == "b")
    assert b["sonuc"] == "hata" and b["hata"] == "KapiHatasi" and b["nitelikler"]["kapi"] == "b"


def test_kapilari_kos_eksik_adim_yakalanir(tmp_path, capfd):
    kok = tmp_path / ".iz"

    def kos(k):
        if k == "b":  # günlük kapı sürerken siliniyor: "a" kaydı kaybolur
            (kok / "kosular/KE.jsonl").unlink()
        return 0

    assert iz.kapilari_kos(["a", "b"], kos, kosu="KE", kok=kok) == 1
    assert "eksik adım: a" in capfd.readouterr().err


def test_kapilari_kos_iz_kosu_ortami(tmp_path, monkeypatch):
    monkeypatch.delenv("IZ_KOSU", raising=False)
    import os
    gorulen = []
    iz.kapilari_kos(["a"], lambda k: gorulen.append(os.environ["IZ_KOSU"]) or 0, kosu="KO", kok=tmp_path / ".iz")
    assert gorulen == ["KO"] and "IZ_KOSU" not in os.environ


def test_nitelikte_serilestirilemeyen_deger_asil_istisnayi_ezmez(tmp_path):
    kok = tmp_path / ".iz"
    with pytest.raises(ValueError, match="asil"):
        with iz.adim("x", nitelikler={"p": Path("a/b"), "k": {1, 2}}, kok=kok, kosu="K2"):
            raise ValueError("asil")
    kay = json.loads((kok / "kosular/K2.jsonl").read_text())
    assert kay["hata"] == "ValueError" and kay["nitelikler"]["p"] == "a/b"


def test_gunluk_yazim_hatasi_asil_istisnayi_ezmez(tmp_path, capsys):
    kok = tmp_path / ".iz"
    kok.write_text("dosya, dizin degil")
    with pytest.raises(ValueError, match="asil"):
        with iz.adim("x", kok=kok, kosu="K3"):
            raise ValueError("asil")
    assert "günlük yazılamadı" in capsys.readouterr().err
    with pytest.raises(OSError):  # asıl hata yoksa günlük hatası yükselir
        with iz.adim("x", kok=kok, kosu="K3"):
            pass


@pytest.mark.parametrize("kosu", ["", "../x", "a/b", "..", "a b", "x" * 65, "a\n", "é"])
def test_kosu_yol_kacisi_reddedilir(tmp_path, kosu):
    with pytest.raises(ValueError, match="koşu"):
        iz.adim("x", kok=tmp_path, kosu=kosu)
    with pytest.raises(ValueError, match="koşu"):
        iz.eksik_adimlar(tmp_path, kosu, ["x"])


def test_iz_kosu_ortami_dogrulanir(tmp_path, monkeypatch):
    monkeypatch.setenv("IZ_KOSU", "../../etc/x")
    with pytest.raises(ValueError, match="koşu"):
        iz.adim("x", kok=tmp_path)


def test_yol_ve_hata_alani_maskelenir(tmp_path):
    kok = tmp_path / ".iz"
    g = tmp_path / "alp@example.com.txt"
    g.write_text("x")
    with iz.adim("x", girdiler=[g], kok=kok, kosu="K4"):
        pass
    kay = json.loads((kok / "kosular/K4.jsonl").read_text())
    assert "alp@example.com" not in json.dumps(kay) and "***" in kay["girdi"][0]["yol"]


def test_ekle_bozuk_zincire_eklemez(tmp_path):
    p = tmp_path / "d.jsonl"
    uret(p)
    s = p.read_text().split("\n")
    del s[1]
    p.write_text("\n".join(s))
    with pytest.raises(defter.DefterHatasi, match="bozuk"):
        defter.ekle(p, "t", "o", "k", "g", "kim", "yeni")
    p.write_text("{yarim\n")
    with pytest.raises(defter.DefterHatasi, match="JSON değil"):
        defter.ekle(p, "t", "o", "k", "g", "kim", "yeni")


def test_capa_kuyruk_kesmeyi_yakalar(tmp_path):
    p = tmp_path / "d.jsonl"
    uret(p)
    assert (tmp_path / "d.son").read_text().strip() == json.loads(p.read_text().splitlines()[-1])["hash"]
    assert defter.dogrula(p) == []
    s = p.read_text().splitlines()
    p.write_text("\n".join(s[:-1]) + "\n")
    assert "çapa" in defter.dogrula(p)[0]
    with pytest.raises(defter.DefterHatasi, match="çapa"):
        defter.ekle(p, "t", "o", "k", "g", "kim", "yeni")
    p.write_text("")
    assert "çapa" in defter.dogrula(p)[0]
