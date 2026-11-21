# iz

**English summary:** `iz` is a dependency-free trace library with matching Python 3.12 (stdlib only) and strict TypeScript implementations. It provides a step log (JSONL), a tamper-evident append-only decision ledger (hash chain), an output provenance card, and a gate runner that fails when steps are unrecorded. Both languages share one data format, golden files (`testdata/`) and JSON schemas (`sema/`). Licensed under MIT. The rest of this document is in Turkish.

Bağımlılıksız iz kütüphanesi; Python 3.12 stdlib (`python/`) ve TypeScript strict (`ts/`) eş uygulamaları, aynı veri biçimi, ortak altın dosyalar `testdata/`, kayıt biçimi şemaları `sema/`. Sürüm 0.7.0; değişiklikler `CHANGELOG.md`. Lisans: MIT (`LICENSE`).

## Kurulum (tüketici)

```toml
# pyproject.toml
[project]
dependencies = ["iz"]

[tool.uv.sources]
iz = { git = "https://github.com/AlparslanSemiz/iz", rev = "<40 hex commit, v0.7.0 etiketinin>" }
```

`uv lock` kilit dosyasına çözülmüş commit'i yazar; `uv lock --upgrade-package iz` yalnız bilerek, sözleşme testleri yeşilken. Branch ile sabitleme yapılmaz.

## Sözleşme

- `sema/iz-adim.v1.json` (adım günlüğü satırı) ve `sema/iz-defter.v1.json` (defter satırı), JSON Schema 2020-12. Kurulu pakette `iz.sema_yolu("adim"|"defter")`, altın dosyalar `iz.testdata_dizini()` (`iz/_veri/` altında paket verisi).
- Her yeni kayıt `sema_surumu: 1` taşır (0.7.0'da değişmedi: iz'in yazdığı baytlar aynı, yalnız doğrulama sıkılaştı) (`iz.SEMA_SURUMU`); defterde hash'e dahildir. Alanı olmayan kayıt (0.1.x) v1 sayılır. `iz.kayit_surumu(kayit)` desteklenmeyen sürümde `SurumHatasi` verir; `defter-dogrula` satır numarasıyla bildirir, `kontrol` çıkış 2 döner.
- Semver: alan silmek ya da anlamını değiştirmek major (yeni `vN` şema dosyası), alan eklemek minor (şemalar ek alana açık), düzeltme patch. Okuyucu N ve N-1'i okur.
- Tüketici sözleşme testi önerisi: kurulu iz'in altın dosyalarını kendi yükleyicisinden geçirmek ve kendi ürettiği kayıtları `iz.sema_yolu(...)` şemasıyla doğrulamak.

## Katmanlar

1. **Adım günlüğü** (`.iz/kosular/<kosu>.jsonl`, git dışı; `IZ_DIZIN` ile taşınır). Koşu kimliği `IZ_KOSU` ya da yeni UUIDv7.
   - Python: `with iz.adim("uret", girdiler=["a.txt"]) as a: a.cikti("b.txt")`
   - TS: `await adim("uret", { girdiler: ["a.txt"] }, async (a) => { a.cikti("b.txt"); })`
   - Kayıt: `sema_surumu, kosu, adim, ust, ad, baslangic, bitis, sure_ms, sonuc (tamam|hata), hata (sınıf), girdi/cikti [{yol, sha256}], arac_surumu (git kısa commit), nitelikler (maskeli)`.
2. **Karar defteri** `iz/defter.jsonl` (git'te, append-only). Her kayıt `onceki` (öncekinin `hash`'i; ilki 64 sıfır) ve `hash` taşır; `hash` = sha256(kanonik JSON). `ekle(tur, ozne, karar, gerekce, kim, anahtar)` aynı `anahtar`'ı reddeder; `dogrula` ilk bozuk satırı numarasıyla bildirir (`satır 2: özet uyuşmuyor`).
   - **Kanonik satır kuralı (0.7.0):** her satır, kaydın kanonik serileştirmesi + `\n` ile bayt bayt aynıdır. Kanonik: anahtarlar kod noktasına göre sıralı (iç içe de), boşluksuz, ASCII dışı olduğu gibi, UTF-8; değerler yalnız metin, tam sayı (±2^53−1, I-JSON güvenli aralığı; 64 bit aralığının alt kümesi, iki dilde bayt eşliği bunu gerektirir), bool, null, dizi, nesne. CRLF, boşluklu ya da `\uXXXX` kaçışlı yeniden yazım, aynı anahtarın iki kez geçmesi (grep sahte değeri, ayrıştırıcı sonuncuyu görür), ondalık (`1.0`, `1e0`), eşsiz vekil karakter, BOM, boş satır ve satır sonu olmayan son satır `dogrula`da hatadır (`satır N: kanonik biçimde değil`, `boş satır`, `UTF-8 değil`, `yarım satır`). `sira` tam sayı olmalı (`true`, `"1"` reddedilir: `sıra tam sayı değil`). Yazarken kanonik dışı değer (vekil karakter vb.) `KanonikHatasi` (bir `DefterHatasi`) verir, dosyaya dokunulmaz. Tüm durumlar `testdata/defter_kurallar.json`'da, iki dil aynı iletiyi verir.
   - **Yalnız sona ekleme:** `iz defter-onek <eski> <yeni>` eski dosya yenisinin bayt öneki değilse çıkış 1 (`satır N (bayt B): eski içerik değişmiş` ya da `yeni defter eskisinden kısa (kuyruk kesilmiş)`), okunamazsa 2. Çapa (`.son`) yalnız kazara kesmeyi yakalar; kasıtlı yeniden yazıma karşı tüketici bu komutu git'teki önceki sürüme karşı kapı yapar (aşağıda).
   - **Yarım satır kurtarma:** yazım sırasında çökme son satırı yarım bırakırsa `dogrula` ve `ekle` reddeder. `iz defter-onar [yol]` kilit altında yalnız son satır sonundan sonraki parçayı `<yol>.yarim` dosyasının sonuna taşır (kanıt silinmez, birikir) ve defteri o noktada keser; sonra doğrular (başka bozukluk kalırsa çıkış 1). Tam satırlara dokunmaz.
   - Eşzamanlılık: okuma+ekleme tek parça kilit altında. Python `fcntl.flock(LOCK_EX)` defter dosyasının kendisinde; TS `${yol}.kilit` dosyası: içerik `{pid, makine, jeton, zaman}` geçici dosya + `link` ile atomik konur (varsa üzerine yazılmaz). Dolu ise 10-50 ms aralıkla bekler, 10 sn sonra `DefterHatasi` (`KILIT.beklemeMs`). Kilit **yalnız sahibi ölüyse ve süre (30 sn, `KILIT.eskiMs`) dolmuşsa** bayat sayılır: aynı makinede ölülük `kill(pid, 0)` = ESRCH ile kanıtlanır; yaşayan sahibin kilidi ne kadar eski olursa olsun alınmaz. Başka makinenin ya da eski biçimin (0.2.x boş içerik) kilidi yalnız süreyle bayat sayılır. Devir hakkı, bayat kilit örneğinin kimliğine (jeton; eski biçimde içerik + inode) bağlı `${yol}.kilit.devir.<kimlik>` dosyasıyla tek sürece verilir; o süreç yoldaki dosyanın hâlâ aynı örnek ve bayat olduğunu doğrulayıp siler. Bayat örnek yerinde durdukça kimse yeni kilit koyamaz, örneği de yalnız hak sahibi siler; bu yüzden hiçbir süreç başkasının taze kilidini kaldıramaz (0.7.0 öncesi taslaktaki rename+link geri koyma yöntemi bunu sağlamıyordu: 14 süreçte iki sahip ve iki `sira 1` satırı gözlendi). Devir hakkını alan süreç ölürse devir dosyası aynı kuralla kaldırılır. Kritik bölgeye girmeden ve çıkarken kilidin hâlâ kendi jetonunu taşıdığı denetlenir; elden çıkmışsa `DefterHatasi`, başkasının kilidine dokunulmaz. Sınanan: belirlenimci yarış testi ve `python3 betikler/gorev.py yuk` (14 süreç x 40 tur, her tur bayat kilitle başlar, bozulma 0). Sınır: pid yeniden kullanılırsa ölü sahip yaşıyor sanılır (güvenli yön: bekler, zaman aşımı verir). Her iki dilde ekleme `fsync` edilir; çapa geçici dosya + `fsync` + `rename` + dizin `fsync` ile yazılır. Ürünler tek dilli olduğundan Python ve TS yazarları birbirini dışlamaz (karışık dilli eşzamanlı yazma desteklenmez).
   - Kural: deterministik makine sonuçları (test, lint, derleme çıktısı) deftere yazılmaz; onlar adım günlüğündedir. Deftere yalnız insan/ajan kararı, istisna ve gerekçe girer.
3. **Köken kartı**: `python -m iz koken <dosya> [--bicim json|md]`; dosyanın sha256'sından üreten adımı ve girdilerini geriye ağaç olarak verir (Python tarafında).

Maskeleme (`testdata/maskele.json`, iki dil aynı):
- Alan adı, normalleştirildikten sonra `token/secret/password/passwd/pwd/sifre/parola/api_key/private_key/anahtar/authorization/cookie/credential` içeriyorsa değeri `***`. Normalleştirme iki dilde aynı açık dönüşüm (`alan_adi_normal` / `alanAdiNormal`): NFKC (`ſ`, Kelvin `K`, tam genişlik), Türkçe tablo (İ/I/ı/i -> i, ş -> s, ç -> c, ğ -> g, ü -> u, ö -> o), ASCII küçük harf; desen ASCII. Böylece `ŞİFRE`, `sıfre`, `apı_key`, `ſecret`, `PAROLA` iki dilde de maskelenir (önceden Python `re.I` Unicode katlıyor, JS `/i` katlamıyordu). Kural alt dize üzerinden çalışır, bilinçli olarak geniştir (`tokenizer_x` de maskelenir).
- Metinde: e-posta; `+` ya da `0` ile başlayan telefon; PEM özel anahtar bloğu (sonu kesik olsa da); `Bearer`; `Authorization:`/`Proxy-Authorization:` değeri (`Basic`, `Digest` ...); `Cookie:`/`Set-Cookie:` satırı; GitHub `ghp_`/`github_pat_`, OpenAI `sk-`, Stripe `sk_live_`/`sk_test_`/`rk_live_`, Slack `xox[abposr]-`, Google `AIza`, GitLab `glpat-`, AWS `AKIA`, JWT; TC kimlik numarası (11 hane, iki denetim hanesi tutmalı); TR IBAN (mod-97 = 1).
- Yanlış pozitif sınırı: TC kimlik ve IBAN harf ya da rakam komşusu olan diziyi almaz, sağlama tutmazsa dokunmaz. Tarih, Unix zamanı, sha256 ve ULID içindeki 11 haneli diziler maskelenmez (altın dosyada sınanır). Sır önekleri kısa kuyrukla eşleşmez.
- **Sözlük anahtarı da maskelenir** (karar): anahtar da metindir; `{"alp@example.com": 1}` gibi bir anahtar sızıntıdır ve günlük git dışı da olsa paylaşılabilir. Alan adı kuralı özgün anahtara bakar, sonra anahtar metin olarak maskelenir; çakışan anahtar `***#2`, `***#3` olur (değer kaybolmaz, sıra girdi sırasıdır). Bedeli: anahtarı sır biçiminde olan alanın adı okunmaz olur; bu kabul edildi.
- Günlük serileştirmesi: NaN/sonsuz `null`, 64 bit dışı tam sayı metin (TS `bigint` metin), eşsiz vekil karakter `\udXXX` kaçışıyla (Python artık çökmez, TS ile aynı bayt).
- Defter maskelenmez; deftere sır yazma.

## CLI

```
python -m iz [--kok .iz] kontrol --kosu <id> --gerekli a,b     # eksik adım varsa çıkış 1
python -m iz defter-dogrula [iz/defter.jsonl]                   # bozuksa çıkış 1
python -m iz defter-onek <eski> <yeni>                          # eski, yeninin bayt öneki değilse çıkış 1
python -m iz defter-onar [iz/defter.jsonl]                      # son yarım satırı <yol>.yarim'e taşır
node ts/src/cli.ts [--kok .iz] kontrol --kosu <id> --gerekli a,b   # aynı çıktı ve çıkış kodları (Node 24, derleme yok)
node ts/src/cli.ts defter-dogrula [iz/defter.jsonl]
node ts/src/cli.ts defter-onek <eski> <yeni>
node ts/src/cli.ts defter-onar [iz/defter.jsonl]
```

`kontrol` adım günlüğünde bozuk satırı (yarım yazım, elle bozma) atlar ve satır numarasıyla bildirir (`iz kontrol: satır 4: JSON değil`, sonda `iz kontrol: N bozuk satır atlandı`); çıkış kodları: 0 tamam, 1 eksik adım, 2 bozuk satır ya da desteklenmeyen sürüm (bozuk satır eksik adımdan önce gelir). `koken` aynı biçimde atlar (`iz koken: <dosya> satır N: ...`), kartı yine basar, çıkış 2. Satırlar yalnız `\n` ile bölünür (U+2028 satır sonu sayılmaz). Yeni günlük kaydı, önceki satır yarım kaldıysa yeni satırda başlar.

### Tüketici kapısı: defter yalnız sona eklenir

Ürün deposunun `betikler/gorev.py`'sinde (Python; CI’da tek satır çağrı) bir kapı olarak; önceki sürüm ana daldaki dosyadır:

```python
import subprocess, sys, tempfile


def defter_onek(yol: str = "iz/defter.jsonl", taban: str = "origin/main") -> int:
    """0 yalnız sona eklenmiş ve zincir sağlam; 1 değişmiş/kesilmiş ya da bozuk; 2 taban ref'i yok."""
    git = lambda *a: subprocess.run(["git", *a], capture_output=True)
    if git("rev-parse", "--verify", "--quiet", f"{taban}^{{commit}}").returncode != 0:
        print(f"defter-onek: taban yok: {taban} (fetch-depth / dal adı?)", file=sys.stderr)
        return 2  # ref yoksa açık yönde geçme: kapı kırmızı
    if git("cat-file", "-e", f"{taban}:./{yol}").returncode != 0:
        print(f"defter-onek: {taban} tabanında {yol} yok, ilk kayıt sayıldı", file=sys.stderr)
        eski = b""
    else:
        eski = subprocess.run(["git", "show", f"{taban}:./{yol}"], capture_output=True, check=True).stdout
    with tempfile.NamedTemporaryFile(suffix=".jsonl") as f:
        f.write(eski)
        f.flush()
        onek = subprocess.run([sys.executable, "-m", "iz", "defter-onek", f.name, yol]).returncode
    return onek or subprocess.run([sys.executable, "-m", "iz", "defter-dogrula", yol]).returncode
```

Taban ref'i yoksa (yanlış dal adı, sığ klon) çıkış 2: kapı açık yönde geçmez. Ref var ama dosya tabanda yoksa (ilk kayıt) eski boş sayılır ve bu stderr'e yazılır. CI'da `fetch-depth` tabanı içermeli. Önek kapısı kuyruk kesmeyi ve geçmişi yeniden yazmayı yakalar; `defter-dogrula` zinciri ve satır kuralını. Bu blok `python/tests/test_sertlestirme.py` içinde README'den okunup gerçek git deposunda sınanır.

`koken` yalnız Python CLI'sındadır.

## Kapı koşucusu

`kapilari_kos(kapilar, kos, kosu=None, kok=None, nitelikler=None) -> int` (Python) ve `await kapilariKos(kapilar, { kos, kosu?, kok?, nitelikler?, yaz? })` (TS): her kapı `{...nitelikler, kapi}` ile bir adım olarak günlüklenir; kapı sıfır dışı kod dönerse `KapiHatasi` (`kod`) ile adım `hata` yazılır, koşu durur ve o kod döner. Hepsi geçince eksik adım kontrolü (Python: `python -m iz kontrol` alt süreci; TS: `eksikAdimlar`); eksik varsa `iz kontrol: eksik adım: ...` ve 1. Koşu kimliği `kosu`, yoksa `IZ_KOSU`, yoksa UUIDv7; koşu süresince `IZ_KOSU` ortamda ayarlıdır (alt süreçler devralır), sonra eski değeri geri gelir.

TS kaynakları Node 24 tür soyma ile doğrudan çalışır: göreli içe aktarmalar `.ts` uzantılıdır; enum, namespace, parametre özelliği yok.

## OpenTelemetry eşlemesi

| iz | OTel |
|---|---|
| `kosu` (UUID, tireler atılmış 32 hex) | `trace_id` |
| `adim` (16 hex) | `span_id` |
| `ust` | `parent_span_id` |
| `ad` / `baslangic` / `bitis` | span name / start / end |
| `sonuc`, `hata` | status (OK/ERROR), `exception.type` |
| `nitelikler`, `girdi`, `cikti`, `arac_surumu` | attributes |

## Test

```
python3 betikler/gorev.py test       # pytest + vitest
python3 betikler/gorev.py kontrol    # + pyright strict, tsc, wheel kurulup paket verisi okunur
```

Her kapı iz'in kendisiyle `.iz/kosular/` altına günlüklenir; eksik adım kırmızıdır. Python araçları `uv.lock`'ta sabit (`--group dev`), TS `ts/package-lock.json`'da.

Çapraz doğrulama: `testdata/defter_altin.jsonl` Python ile üretildi (0.2.0 biçimi; 0.1.x baytları `defter_altin_v1_alansiz.jsonl`); iki dil de `defter_girdi.json`'dan bayt bayt aynısını üretir ve doğrular. Bozuk örnek `defter_bozuk.jsonl`, beklenen çıktı `defter_bozuk.beklenen`.

Kapsam notu: TS tarafında köken yok (adım günlüğü, defter, maskeleme, kontrol, CLI, kapı var). Python paketi pyright strict altında 0 hata verir.
