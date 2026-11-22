# Değişiklik günlüğü

Sürümleme semver'e uyar ve kayıt biçimi sözleşmesine bağlıdır:
- alan silmek ya da bir alanın anlamını değiştirmek: **major** (yeni `sema/iz-*.vN.json`, `SEMA_SURUMU` artar);
- yeni alan eklemek: **minor** (aynı şema dosyası, `additionalProperties` açık olduğu için eski okuyucu kabul eder);
- davranışı değiştirmeyen düzeltme: **patch**.

Okuyucu N ve N-1 biçimini okur, daha eskisini ve bilmediği ileri sürümü reddeder.

## Yayımlanmamış

- vitest 4.1.12'ye yükseltildi (tinypool/@vitest/mocker güvenlik açıkları; yalnız geliştirme bağımlılığı).

## 0.7.0 (2026-11-21)

İlk public sürüm. MIT lisansı (`LICENSE`); geçmiş sürümlerin (0.1.0-0.3.0) notları aşağıda korunur. Kayıt biçimi değişmedi (`sema_surumu: 1`). Önceki özel dağıtımdaki 0.2.1 düzeltmesi (NaN/Infinity ile standart dışı JSON yazılmaması) 0.3.0'dan beri daha güçlü karşılanır: NaN/sonsuz günlükte `null` yazılır.

## 0.3.0 (2026-11-20)

Sürüm gerekçesi: kanonik satır kuralı, 0.2.0'ın kabul ettiği bazı dosyaları (CRLF, yeniden biçimlenmiş, yinelenen anahtarlı, `sira` bool ya da ondalık) artık reddediyor; bu doğrulama davranışında geriye uyumsuz bir değişikliktir. 1.x olsaydı major olurdu; semver 0.y.z'de uyumsuz değişiklik minor ile işaretlenir, bu yüzden 0.3.0. Kayıt biçimi değişmedi (`SEMA_SURUMU` 1, şemalar aynı); iz'in kendi yazdığı her defter geçerli kalır (altın dosyalar bayt bayt aynı). Yeni komut ve API'ler eklemedir.

- Defter: kanonik satır kuralı. Satır, kaydın kanonik serileştirmesi + `\n` ile bayt bayt eşit olmalı; CRLF, yeniden biçim, yinelenen anahtar, ondalık sayı, eşsiz vekil, BOM, boş satır ve yarım son satır `dogrula`da hata. `sira` tam sayı (bool, metin reddedilir). Python ve TS aynı ileti; ortak altın `testdata/defter_kurallar.json`.
- Kanonik serileştirici: iç içe nesnelerde de kod noktası sırası (TS önceden yalnız üst düzeyi ve UTF-16 sırasıyla sıralıyordu), değer alanı metin/tam sayı (±2^53−1)/bool/null; Python `allow_nan=False`; eşsiz vekil karakter Python'da çökme yerine, TS'de sessiz kabul yerine iki dilde `KanonikHatasi`.
- `iz defter-onek <eski> <yeni>`: yalnız sona ekleme kapısı (bayt öneki). README'de git tabanlı tüketici kapısı.
- `iz defter-onar [yol]`: son yarım satırı `<yol>.yarim`'e taşır (kanıt birikir), defteri keser.
- Adım günlüğü: `kontrol` ve `koken` bozuk satırda traceback yerine satır numarası ve atlanan sayısı, çıkış 2; satırlar yalnız `\n` ile bölünür (U+2028 artık satırı kırmıyor); yarım satırdan sonra yeni kayıt yeni satırda başlar. Yeni API: `gunluk_oku`/`gunlukOku`, `kosu_durumu`/`kosuDurumu`, `GunlukHatasi`; `eksik_adimlar` bozuk satırda `GunlukHatasi` (ValueError) verir.
- Süre: `sure_ms` monoton saatten (Python `monotonic_ns`, TS `performance.now`), `bitis` = `baslangic` + monoton süre; saat geri gitse de eksi süre ya da başlangıçtan önceki bitiş yok.
- UUIDv7: süreç içinde kesin artan (RFC 9562 yöntem 1, 12 bit sayaç, taşmada zaman damgası ilerler, geri saatte son damga).
- Günlük serileştirme: NaN/sonsuz `null`, 64 bit dışı tam sayı metin, eşsiz vekil `\udXXX` (Python TS ile aynı bayt).
- Maskeleme: Stripe, Slack, Google, GitLab, PEM özel anahtar, `Authorization`/`Cookie` başlıkları; alan adları `authorization`, `cookie`, `pwd`, `credential`; TC kimlik (sağlamalı), TR IBAN (mod-97). Sözlük anahtarı da maskelenir, çakışan anahtar `***#2`. Yanlış pozitif testleri (tarih, sha256, ULID, Unix zamanı).
- TS defter: ekleme ve çapa `fsync` (çapa için dizin de); Python çapası da `fsync`.
- TS kilit devri yeniden tasarlandı. Kilit içeriği `{pid, makine, jeton, zaman}`, `link` ile atomik konuyor. Kilit yalnız sahibi ölüyse (`kill(pid,0)` = ESRCH) ve süre dolmuşsa bayat sayılıyor. Devir hakkı, bayat örneğin kimliğine bağlı tek bir `.devir.<kimlik>` dosyasıyla tek sürece veriliyor; o süreç silmeden önce örneği yeniden doğruluyor. Kritik bölgeye girerken ve çıkarken jeton denetleniyor. 0.2.0'daki stat+unlink ve bu dalın ilk taslağındaki rename+link geri koyma yöntemi iki sahibe izin veriyordu (14 süreçte iki `sira 1`). Sınanan: belirlenimci yarış testi, `gorev.py yuk` (14 süreç x 40 tur: 0 bozulma; eski uygulama aynı testte 15 turda 1 bozulma).
- Alan türleri şemayla tutarlı denetleniyor: metin, `tur`/`kim`/`anahtar` boş olamaz, `onceki`/`hash` hex64, `zaman` biçimi. Hata iletileri `alan X metin değil`, `alan X boş`, `alan X biçimi geçersiz`. `ekle` girdiyi de denetliyor. Önceden `anahtar` liste olunca Python traceback veriyor, TS geçerli sayıyordu. Günlükte `ad`/`sonuc` metin değilse bozuk satır sayılıyor.
- Python maske desenleri `re.ASCII` ile derleniyor, `\s` yerine açık boşluk sınıfı kullanılıyor (iki dilde aynı küme; `çBearer ...` Python'da sızıyordu). TS maskede `__proto__` anahtarı artık prototipe yazılmıyor. Alan adı eşleşmesi iki dilde aynı açık normalleştirmeden sonra yapılıyor (NFKC, Türkçe tablo, ASCII küçük harf; desen ASCII): `ŞİFRE`, `sıfre`, `apı_key`, `ſecret`, Kelvin işaretli `toKen` TS'de sızıyordu.
- README tüketici kapısında taban ref'i yoksa çıkış 2 (önceden açık yönde geçiyordu); README bloğu testte gerçek git deposunda sınanıyor.
- Testler: defter sıra/önceki özet/eksik alan, TS bayat kilit, kilit zaman aşımı ve yarış yolları. Dal kapsaması: Python %95,8 (alt süreçler dahil, satır+dal %98), TS %89,2 (önce %77).

## 0.2.0 (2026-11-19)

- Kendi deposuna ayrıldı (önceden iç şablon deposunun bir alt dizinindeydi).
- Paketleme: kökte `pyproject.toml` (hatchling, bağımlılıksız, paket adı `iz`, `iz` komutu); uv git kaynağı alt dizinsiz kurulur.
- Sözleşme: `sema/iz-adim.v1.json`, `sema/iz-defter.v1.json` (JSON Schema 2020-12), paket verisi olarak `iz/_veri/sema` ve `iz/_veri/testdata` altında dağıtılır (`iz.sema_yolu`, `iz.testdata_dizini`).
- Her yeni adım ve defter kaydı `sema_surumu: 1` taşır (defterde hash'e dahildir). Alanı olmayan 0.1.x kayıtları v1 sayılır; desteklenmeyen sürümü `defter-dogrula` satır numarasıyla, `kontrol` çıkış 2 ile reddeder. Python ve TS aynı ileti.
- Altın dosyalar: `defter_altin.jsonl` yeni biçimle yeniden üretildi; eski bayt dizisi `defter_altin_v1_alansiz.jsonl` olarak geriye uyum testi için kaldı; `adim_altin.jsonl`, `defter_surum_ileri.jsonl` eklendi.
- `betikler/gorev.py test|kontrol`: pytest, vitest, pyright strict, tsc, wheel kurulum denemesi; her kapı iz ile günlüklenir.
- Geçici lisans notu (`LISANS`); 0.7.0'da MIT ile değişti.

## 0.1.0

- İç şablon deposunda ilk sürüm: adım günlüğü, karar defteri, köken kartı, kapı koşucusu (Python + TS).
