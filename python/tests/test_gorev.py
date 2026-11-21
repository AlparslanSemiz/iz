from betikler import gorev

import iz


def test_bilinmeyen_gorev_2(capsys):
    assert gorev.main(["yok"], kos=lambda k: 0) == 2
    assert gorev.main([], kos=lambda k: 0) == 2
    assert "kullanım" in capsys.readouterr().err


def test_kontrol_kapilari_sirayla_gunluklenir(tmp_path, monkeypatch):
    monkeypatch.setenv("IZ_KOSU", "GK")
    gorulen: list[str] = []
    assert gorev.main(["kontrol"], kos=lambda k: gorulen.append(k) or 0, kok=tmp_path) == 0
    assert gorulen == gorev.GOREVLER["kontrol"]
    assert iz.eksik_adimlar(tmp_path, "GK", gorulen) == []


def test_kirmizi_kapi_kodu_doner(tmp_path, monkeypatch):
    monkeypatch.setenv("IZ_KOSU", "GH")
    assert gorev.main(["test"], kos=lambda k: 5 if k == "vitest" else 0, kok=tmp_path) == 5


def test_wheel_eksikleri():
    tam = [*gorev.WHEEL_GEREKEN, "iz-0.7.0.dist-info/licenses/LICENSE"]
    assert gorev.wheel_eksikleri(tam) == []
    assert gorev.wheel_eksikleri(tam[1:-1]) == [gorev.WHEEL_GEREKEN[0], "*.dist-info/licenses/LICENSE"]
