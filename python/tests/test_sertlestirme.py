"""0.3.0 sertleştirme: kanonik satır kuralı, yalnız sona ekleme, bozuk satır, monoton süre, serileştirme, maske."""
import base64
import importlib
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

import iz
adim_mod = importlib.import_module("iz.adim")  # paketteki `adim` sınıfı modülü gölgeler
from iz import defter

KOK = Path(__file__).resolve().parents[2]
TD = KOK / "testdata"
KURAL = json.loads((TD / "defter_kurallar.json").read_text(encoding="utf-8"))
ALTIN = (TD / "defter_altin.jsonl").read_bytes()


def cli(*arg: str, cwd: Path = KOK / "python") -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", "iz", *arg], capture_output=True, text=True, cwd=cwd)


def icerik(d: dict) -> bytes:
    return base64.b64decode(d["icerik_b64"]) if "icerik_b64" in d else d["icerik"].encode("utf-8", "surrogatepass")


# --- 1. kanonik satır kuralı ---

@pytest.mark.parametrize("durum", KURAL["satir_red"], ids=lambda d: d["ad"])
def test_satir_kurali_altin(tmp_path, durum):
    p = tmp_path / "d.jsonl"
    p.write_bytes(icerik(durum))
    assert defter.dogrula(p) == [durum["beklenen"]]
    with pytest.raises(defter.DefterHatasi, match="ekleme reddedildi"):
        defter.ekle(p, "t", "o", "k", "g", "kim", "yeni-anahtar")
    r = cli("defter-dogrula", str(p))
    assert r.returncode == 1 and r.stderr.strip() == durum["beklenen"]


@pytest.mark.parametrize("durum", KURAL["kanonik"], ids=lambda d: d["kanonik"][:20])
def test_kanonik_altin(durum):
    assert defter.kanonik(durum["deger"]) == durum["kanonik"]


@pytest.mark.parametrize("deger", KURAL["kanonik_red"], ids=repr)
def test_kanonik_red(deger):
    with pytest.raises(defter.KanonikHatasi):
        defter.kanonik(deger)


@pytest.mark.parametrize("deger", [float("nan"), float("inf"), {1: "a"}, {"a": object()}, (1, 2), 2**64])
def test_kanonik_red_python_turleri(deger):
    with pytest.raises(iz.KanonikHatasi):
        defter.kanonik({"a": deger} if not isinstance(deger, dict) else deger)


def test_ekle_essiz_vekili_cokmeden_reddeder_dosyaya_dokunmaz(tmp_path):
    p = tmp_path / "d.jsonl"
    defter.ekle(p, "t", "o", "k", "g", "kim", "a1")
    once = p.read_bytes()
    with pytest.raises(defter.KanonikHatasi, match="vekil"):
        defter.ekle(p, "t", "o", "kötü \ud800", "g", "kim", "a2")
    assert p.read_bytes() == once and defter.dogrula(p) == []


def test_altin_hala_gecerli_ve_ayni_bayt(tmp_path):
    assert defter.dogrula(TD / "defter_altin.jsonl") == []
    assert defter.dogrula(TD / "defter_altin_v1_alansiz.jsonl") == []


# --- 2. yalnız sona ekleme ---

@pytest.mark.parametrize("durum", KURAL["onek"], ids=lambda d: d["ad"])
def test_onek_altin(tmp_path, durum):
    e, y = durum["eski"].encode(), durum["yeni"].encode()
    assert defter.onek_denetle(e, y) == durum["beklenen"]
    (tmp_path / "e").write_bytes(e)
    (tmp_path / "y").write_bytes(y)
    r = cli("defter-onek", str(tmp_path / "e"), str(tmp_path / "y"))
    if durum["beklenen"] is None:
        assert r.returncode == 0 and "tamam" in r.stdout
    else:
        assert r.returncode == 1 and r.stderr.strip() == "defter-onek: " + durum["beklenen"]


def test_onek_dosya_yok(tmp_path):
    r = cli("defter-onek", str(tmp_path / "yok"), str(TD / "defter_altin.jsonl"))
    assert r.returncode == 2 and "okunamadı" in r.stderr


# --- 3. bozuk satır, defter-onar ---

def test_defter_onar_yalniz_yarim_parcayi_tasir(tmp_path):
    p = tmp_path / "d.jsonl"
    yarim = b'{"anahtar":"k-004","gerek'
    p.write_bytes(ALTIN + yarim)
    assert "yarım satır" in defter.dogrula(p)[0]
    r = cli("defter-onar", str(p))
    assert r.returncode == 0, r.stderr
    assert f"({len(yarim)} bayt)" in r.stdout
    assert p.read_bytes() == ALTIN and defter.dogrula(p) == []
    assert (tmp_path / "d.jsonl.yarim").read_bytes() == yarim + b"\n"
    r = cli("defter-onar", str(p))
    assert r.returncode == 0 and "yarım satır yok" in r.stdout
    p.write_bytes(ALTIN + b"ikinci")  # kanıt birikir, ezilmez
    assert defter.onar(p) == (6, tmp_path / "d.jsonl.yarim")
    assert (tmp_path / "d.jsonl.yarim").read_bytes() == yarim + b"\nikinci\n"


def test_defter_onar_baska_bozukluk_kalirsa_kirmizi(tmp_path):
    p = tmp_path / "d.jsonl"
    p.write_bytes(ALTIN.replace(b"REST", b"SOAP") + b"yarim")
    r = cli("defter-onar", str(p))
    assert r.returncode == 1 and "özet uyuşmuyor" in r.stderr
    assert cli("defter-onar", str(tmp_path / "yok")).returncode == 2


def _kosu(tmp_path: Path, kosu: str, *ekler: bytes) -> Path:
    kok = tmp_path / ".iz"
    with iz.adim("a", kok=kok, kosu=kosu):
        pass
    p = kok / "kosular" / f"{kosu}.jsonl"
    with p.open("ab") as f:
        for e in ekler:
            f.write(e)
    return kok


def test_kontrol_bozuk_satirda_numarali_hata(tmp_path):
    kok = _kosu(tmp_path, "KB", b"[1]\n", b'{"ad":"x"}\n', b'{"ad":"b","sonuc":"tam')
    r = cli("--kok", str(kok), "kontrol", "--kosu", "KB", "--gerekli", "a")
    assert r.returncode == 2
    assert r.stderr.splitlines() == ["iz kontrol: satır 2: JSON değil", "iz kontrol: satır 3: eksik alan sonuc",
                                     "iz kontrol: satır 4: JSON değil", "iz kontrol: 3 bozuk satır atlandı"]
    assert "Traceback" not in r.stderr
    with pytest.raises(iz.GunlukHatasi, match=r"satır 2: JSON değil \(3 bozuk satır atlandı\)"):
        iz.eksik_adimlar(kok, "KB", ["a"])
    r = cli("--kok", str(kok), "kontrol", "--kosu", "KB", "--gerekli", "a,z")
    assert r.returncode == 2 and "eksik adım: z" in r.stderr


def test_yarim_satirdan_sonra_yeni_kayit_yeni_satirda(tmp_path):
    kok = _kosu(tmp_path, "KY", b'{"ad":"yarim')
    with iz.adim("b", kok=kok, kosu="KY"):
        pass
    kayitlar, hatalar = iz.gunluk_oku(kok / "kosular/KY.jsonl")
    assert [k["ad"] for k in kayitlar] == ["a", "b"] and hatalar == ["satır 2: JSON değil"]


def test_u2028_iceren_nitelik_kontrolu_bozmaz(tmp_path):
    kok = tmp_path / ".iz"
    with iz.adim("a", kok=kok, kosu="KU", nitelikler={"m": "x y\u0085z\x1cw"}):
        pass
    assert iz.kosu_durumu(kok, "KU", ["a"]) == ([], [])
    (kok / "kosular/KU.jsonl").write_bytes((kok / "kosular/KU.jsonl").read_bytes().replace(b"\n", b"\r\n"))
    assert iz.kosu_durumu(kok, "KU", ["a"]) == ([], [])


def test_koken_bozuk_satirda_kart_verir_hata_bildirir(tmp_path):
    kok, c = tmp_path / ".iz", tmp_path / "c.txt"
    with iz.adim("uret", kok=kok, kosu="KK") as a:
        c.write_text("cikti")
        a.cikti(c)
    with (kok / "kosular/KK.jsonl").open("ab") as f:
        f.write(b'{"kosu":"KK","adim":"x","ad":"y","bitis":"z","sonuc":"tamam","girdi":[1],"cikti":[]}\n{"yarim')
    r = cli("--kok", str(kok), "koken", str(c), "--bicim", "md")
    assert r.returncode == 2 and "uret" in r.stdout and "Traceback" not in r.stderr
    assert r.stderr.splitlines() == ["iz koken: KK.jsonl satır 2: girdi/cikti biçimi bozuk",
                                     "iz koken: KK.jsonl satır 3: JSON değil", "iz koken: 2 bozuk satır atlandı"]
    hatalar: list[str] = []
    assert iz.koken(c, kok, hatalar)["uretici"]["ad"] == "uret" and len(hatalar) == 2


def test_koken_ileri_surum_cikis_2(tmp_path):
    kok, c = tmp_path / ".iz", tmp_path / "c.txt"
    c.write_text("x")
    (kok / "kosular").mkdir(parents=True)
    (kok / "kosular/KV.jsonl").write_text('{"sema_surumu":9}\n')
    r = cli("--kok", str(kok), "koken", str(c))
    assert r.returncode == 2 and "sema_surumu" in r.stderr


def test_kapi_kosucusu_bozuk_gunlukte_kirmizi(tmp_path, capfd):
    kok = tmp_path / ".iz"

    def kos(k):
        with (kok / "kosular/KZ.jsonl").open("ab") as f:
            f.write(b"{bozuk\n")
        return 0

    with iz.adim("hazirlik", kok=kok, kosu="KZ"):
        pass
    assert iz.kapilari_kos(["a"], kos, kosu="KZ", kok=kok) == 1
    assert "satır 2: JSON değil" in capfd.readouterr().err


# --- 4. monoton süre, UUIDv7 ---

def test_saat_geri_gitse_de_sure_eksi_olmaz(tmp_path, monkeypatch):
    kok = tmp_path / ".iz"
    gercek = time.time
    with iz.adim("a", kok=kok, kosu="KM"):
        monkeypatch.setattr(adim_mod.time, "time", lambda: gercek() - 3600)  # duvar saati bir saat geri
        time.sleep(0.02)
    k = json.loads((kok / "kosular/KM.jsonl").read_text())
    assert 15 <= k["sure_ms"] < 5000
    assert k["bitis"] >= k["baslangic"]


def test_uuid7_ayni_milisaniyede_sirali():
    ids = [iz.uuid7() for _ in range(20000)]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)


def test_uuid7_sayac_tasmasi_ve_geri_saat():
    sabit = int(time.time() * 1000) + 10_000_000  # gelecekte: önceki çağrılardan büyük
    ids = [adim_mod.uuid7(sabit) for _ in range(5000)]  # 4096'yı aşar: zaman damgası ileri alınır
    assert ids == sorted(ids) and len(set(ids)) == 5000
    assert int(ids[-1].replace("-", "")[:12], 16) > sabit
    geri = adim_mod.uuid7(sabit - 60_000)  # saat geri: yine de artan
    assert geri > ids[-1] and geri[14] == "7" and geri[19] in "89ab"


# --- 5. serileştirme güvenliği ---

def test_gunluk_serilestirme_guvenli(tmp_path):
    kok = tmp_path / ".iz"
    with iz.adim("a", kok=kok, kosu="KS", nitelikler={"v": "a\ud800b", "nan": float("nan"), "inf": float("-inf"),
                                                        "buyuk": 2**64, "int64": 2**63 - 1, "kucuk": -(2**63)}):
        pass
    ham = (kok / "kosular/KS.jsonl").read_bytes()
    ham.decode("utf-8")  # geçerli UTF-8
    assert b'"a\\ud800b"' in ham
    n = json.loads(ham)["nitelikler"]
    assert n["nan"] is None and n["inf"] is None
    assert n["buyuk"] == str(2**64) and n["int64"] == 2**63 - 1 and n["kucuk"] == -(2**63)
    assert iz.kosu_durumu(kok, "KS", ["a"]) == ([], [])


# --- 6. maske ---

def test_maske_kimlik_dogrulayicilari():
    from iz.maske import iban_gecerli, tckn_gecerli
    assert tckn_gecerli("10000000146") and not tckn_gecerli("10000000147") and not tckn_gecerli("01234567890")
    assert not tckn_gecerli("１0000000146")  # tam genişlik rakam
    assert iban_gecerli("TR33 0006 1005 1978 6457 8413 26") and not iban_gecerli("TR330006100519786457841327")
    assert not iban_gecerli("TR3") and not iban_gecerli("TR33-0006")


# --- denetim düzeltmeleri: alan türleri, README kapısı, __proto__ ---

@pytest.mark.parametrize("deg, ileti", [
    ({"tur": ""}, "alan tur boş"), ({"anahtar": ["x"]}, "alan anahtar metin değil"),
    ({"karar": {"a": 1}}, "alan karar metin değil"), ({"zaman": "dün"}, "alan zaman biçimi geçersiz"),
    ({"kim": None}, "alan kim metin değil"),
])
def test_ekle_alan_turunu_denetler(tmp_path, deg, ileti):
    p = tmp_path / "d.jsonl"
    a = {"tur": "t", "ozne": "o", "karar": "k", "gerekce": "g", "kim": "kim", "anahtar": "a1", "zaman": None, **deg}
    with pytest.raises(defter.DefterHatasi, match=f"geçersiz kayıt: {ileti}"):
        defter.ekle(p, a["tur"], a["ozne"], a["karar"], a["gerekce"], a["kim"], a["anahtar"], a["zaman"])
    assert not p.exists() or p.read_bytes() == b""


def test_gunlukte_ad_liste_traceback_vermez(tmp_path):
    kok = _kosu(tmp_path, "KL", b'{"ad":["a"],"sonuc":"tamam"}\n', b'{"ad":"b","sonuc":{"x":1}}\n')
    r = cli("--kok", str(kok), "kontrol", "--kosu", "KL", "--gerekli", "a")
    assert r.returncode == 2 and "Traceback" not in r.stderr
    assert r.stderr.splitlines() == ["iz kontrol: satır 2: alan ad metin değil", "iz kontrol: satır 3: alan sonuc metin değil",
                                     "iz kontrol: 2 bozuk satır atlandı"]


def test_maske_proto_anahtari():
    assert iz.maskele({"__proto__": {"token": "s", "x": "a@b.co"}, "a": 2}) == {"__proto__": {"token": "***", "x": "***"}, "a": 2}


def _readme_kapisi():
    kod = (KOK / "README.md").read_text(encoding="utf-8").split("```python\n", 1)[1].split("```", 1)[0]
    ns: dict = {}
    exec(compile(kod, "README.md", "exec"), ns)
    return ns["defter_onek"]


def test_readme_tuketici_kapisi_gercek_git(tmp_path, monkeypatch, capfd):
    defter_onek = _readme_kapisi()
    g = tmp_path / "depo"
    (g / "iz").mkdir(parents=True)

    def git(*a):
        subprocess.run(["git", "-C", str(g), *a], capture_output=True, check=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (g / "README").write_text("x")
    git("add", "README")
    git("commit", "-q", "-m", "ilk")
    monkeypatch.chdir(g)
    monkeypatch.setenv("PYTHONPATH", str(KOK / "python"))
    d = g / "iz/defter.jsonl"
    d.write_bytes(ALTIN)
    assert defter_onek(taban="main") == 0  # ref var, dosya tabanda yok: ilk kayıt
    assert "ilk kayıt" in capfd.readouterr().err
    assert defter_onek(taban="origin/main") == 2  # ref yok: açık yönde geçmez
    assert "taban yok: origin/main" in capfd.readouterr().err
    git("add", "iz/defter.jsonl")
    git("commit", "-q", "-m", "defter")
    assert defter_onek(taban="main") == 0
    d.write_bytes(ALTIN + b"\n".join(ALTIN.split(b"\n")[:1]) + b"\n")  # sona ekleme ama zincir bozuk
    assert defter_onek(taban="main") == 1
    d.write_bytes(ALTIN.replace(b"REST", b"SOAP", 1))  # geçmiş yeniden yazıldı
    assert defter_onek(taban="main") == 1
    assert "eski içerik değişmiş" in capfd.readouterr().err
    d.write_bytes(b"\n".join(ALTIN.split(b"\n")[:2]) + b"\n")  # kuyruk kesildi
    assert defter_onek(taban="main") == 1
