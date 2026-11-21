// 0.3.0 sertleştirme: Python ile aynı altın dosyalar (testdata/defter_kurallar.json, maskele.json).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import {
  appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, unlinkSync, utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adim, bayatKilidiDevral, cliMain, DefterHatasi, dogrula, ekle, eksikAdimlar, GunlukHatasi, gunlukOku, ibanGecerli,
  kanonik, KanonikHatasi, kapilariKos, KILIT, kilitAl, maskele, kilitBayatMi, kilitBirak, kilitOku, kosuDurumu, onar, onekDenetle, satirCoz, tcknGecerli, uuid7,
} from "../src/index.ts";

const TD = join(import.meta.dirname, "..", "..", "testdata");
const KURAL = JSON.parse(readFileSync(join(TD, "defter_kurallar.json"), "utf8")) as {
  satir_red: { ad: string; icerik?: string; icerik_b64?: string; beklenen: string }[];
  kanonik: { deger: Record<string, unknown>; kanonik: string }[];
  kanonik_red: Record<string, unknown>[];
  onek: { ad: string; eski: string; yeni: string; beklenen: string | null }[];
};
const ALTIN = readFileSync(join(TD, "defter_altin.jsonl"));
const gecici = () => mkdtempSync(join(tmpdir(), "iz-s-"));
const icerik = (d: { icerik?: string; icerik_b64?: string }) =>
  d.icerik_b64 !== undefined ? Buffer.from(d.icerik_b64, "base64") : Buffer.from(d.icerik!, "utf8");

function cikti() {
  const o = { out: "", err: "" };
  return { o, c: { out: (s: string) => { o.out += s; }, err: (s: string) => { o.err += s; } } };
}

describe("kanonik satır kuralı (altın)", () => {
  it.each(KURAL.satir_red.map((d) => [d.ad, d] as const))("%s", (_ad, d) => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(p, icerik(d));
    expect(dogrula(p)).toEqual([d.beklenen]);
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "yeni-anahtar")).toThrow(/ekleme reddedildi/);
    const t = cikti();
    expect(cliMain(["defter-dogrula", p], t.c)).toBe(1);
    expect(t.o.err.trim()).toBe(d.beklenen);
  });
  it.each(KURAL.kanonik.map((d) => [d.kanonik.slice(0, 20), d] as const))("kanonik %s", (_ad, d) => {
    expect(kanonik(d.deger)).toBe(d.kanonik);
  });
  it.each(KURAL.kanonik_red.map((d) => [JSON.stringify(d), d] as const))("kanonik red %s", (_ad, d) => {
    expect(() => kanonik(d)).toThrow(KanonikHatasi);
  });
  it("TS'ye özgü türler reddedilir", () => {
    for (const v of [Number.NaN, Infinity, undefined, () => 1, 1n]) expect(() => kanonik({ a: v })).toThrow(KanonikHatasi);
    expect(kanonik({ a: -0 })).toBe('{"a":0}');
  });
  it("eşsiz vekil karakterli kayıt eklenmez, dosyaya dokunulmaz", () => {
    const p = join(gecici(), "d.jsonl");
    ekle(p, "t", "o", "k", "g", "kim", "a1");
    const once = readFileSync(p);
    expect(() => ekle(p, "t", "o", "kötü \ud800", "g", "kim", "a2")).toThrow(/vekil/);
    expect(readFileSync(p).equals(once)).toBe(true);
    expect(dogrula(p)).toEqual([]);
  });
  it("satirCoz kanonik satırı nesneye çevirir", () => {
    const ilk = ALTIN.subarray(0, ALTIN.indexOf(10));
    expect((satirCoz(ilk) as Record<string, unknown>).anahtar).toBe("k-001");
  });
});

describe("yalnız sona ekleme (defter-onek)", () => {
  it.each(KURAL.onek.map((d) => [d.ad, d] as const))("%s", (_ad, d) => {
    const e = Buffer.from(d.eski, "utf8");
    const y = Buffer.from(d.yeni, "utf8");
    expect(onekDenetle(e, y)).toBe(d.beklenen);
    const dz = gecici();
    writeFileSync(join(dz, "e"), e);
    writeFileSync(join(dz, "y"), y);
    const t = cikti();
    const kod = cliMain(["defter-onek", join(dz, "e"), join(dz, "y")], t.c);
    if (d.beklenen === null) {
      expect(kod).toBe(0);
      expect(t.o.out).toMatch(/tamam/);
    } else {
      expect(kod).toBe(1);
      expect(t.o.err.trim()).toBe("defter-onek: " + d.beklenen);
    }
  });
  it("dosya yoksa ve argüman eksikse çıkış 2", () => {
    const t = cikti();
    expect(cliMain(["defter-onek", join(gecici(), "yok"), join(TD, "defter_altin.jsonl")], t.c)).toBe(2);
    expect(t.o.err).toMatch(/okunamadı/);
    expect(cliMain(["defter-onek", "a"], cikti().c)).toBe(2);
  });
});

describe("defter-onar", () => {
  it("yalnız son yarım parçayı .yarim dosyasına taşır, kanıt birikir", () => {
    const d = gecici();
    const p = join(d, "d.jsonl");
    const yarim = Buffer.from('{"anahtar":"k-004","gerek');
    writeFileSync(p, Buffer.concat([ALTIN, yarim]));
    expect(dogrula(p)[0]).toMatch(/yarım satır/);
    let t = cikti();
    expect(cliMain(["defter-onar", p], t.c)).toBe(0);
    expect(t.o.out).toContain(`(${yarim.length} bayt)`);
    expect(readFileSync(p).equals(ALTIN)).toBe(true);
    expect(readFileSync(`${p}.yarim`, "utf8")).toBe(yarim.toString() + "\n");
    t = cikti();
    expect(cliMain(["defter-onar", p], t.c)).toBe(0);
    expect(t.o.out).toMatch(/yarım satır yok/);
    appendFileSync(p, "ikinci");
    expect(onar(p)).toEqual({ bayt: 6, yarim: `${p}.yarim` });
    expect(readFileSync(`${p}.yarim`, "utf8")).toBe(yarim.toString() + "\nikinci\n");
    expect(existsSync(`${p}.kilit`)).toBe(false);
  });
  it("başka bozukluk kalırsa 1, dosya yoksa 2", () => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(p, Buffer.concat([Buffer.from(ALTIN.toString().replace("REST", "SOAP")), Buffer.from("yarim")]));
    const t = cikti();
    expect(cliMain(["defter-onar", p], t.c)).toBe(1);
    expect(t.o.err).toMatch(/özet uyuşmuyor/);
    expect(cliMain(["defter-onar", join(gecici(), "yok")], cikti().c)).toBe(2);
  });
});

async function kosu(kosuAdi: string, ...ekler: string[]): Promise<string> {
  const kok = join(gecici(), ".iz");
  await adim("a", { kok, kosu: kosuAdi }, () => undefined);
  for (const e of ekler) appendFileSync(join(kok, "kosular", `${kosuAdi}.jsonl`), e);
  return kok;
}

describe("bozuk günlük satırı", () => {
  it("kontrol numaralı hata verir, atlanan sayısını söyler (Python ile aynı)", async () => {
    const kok = await kosu("KB", "[1]\n", '{"ad":"x"}\n', '{"ad":"b","sonuc":"tam');
    let t = cikti();
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "KB", "--gerekli", "a"], t.c)).toBe(2);
    expect(t.o.err.trim().split("\n")).toEqual([
      "iz kontrol: satır 2: JSON değil", "iz kontrol: satır 3: eksik alan sonuc", "iz kontrol: satır 4: JSON değil",
      "iz kontrol: 3 bozuk satır atlandı",
    ]);
    expect(() => eksikAdimlar(kok, "KB", ["a"])).toThrow(GunlukHatasi);
    expect(() => eksikAdimlar(kok, "KB", ["a"])).toThrow("satır 2: JSON değil (3 bozuk satır atlandı)");
    t = cikti();
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "KB", "--gerekli", "a,z"], t.c)).toBe(2);
    expect(t.o.err).toContain("eksik adım: z");
  });
  it("yarım satırdan sonra yeni kayıt yeni satırda başlar", async () => {
    const kok = await kosu("KY", '{"ad":"yarim');
    await adim("b", { kok, kosu: "KY" }, () => undefined);
    const { kayitlar, hatalar } = gunlukOku(join(kok, "kosular", "KY.jsonl"));
    expect(kayitlar.map((k) => k.ad)).toEqual(["a", "b"]);
    expect(hatalar).toEqual(["satır 2: JSON değil"]);
  });
  it("U+2028 ve CRLF kontrolü bozmaz", async () => {
    const kok = join(gecici(), ".iz");
    await adim("a", { kok, kosu: "KU", nitelikler: { m: "x y\u0085z\x1cw" } }, () => undefined);
    expect(kosuDurumu(kok, "KU", ["a"])).toEqual({ eksik: [], hatalar: [] });
    const p = join(kok, "kosular", "KU.jsonl");
    writeFileSync(p, readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
    expect(kosuDurumu(kok, "KU", ["a"])).toEqual({ eksik: [], hatalar: [] });
  });
  it("kapilariKos bozuk günlükte 1 döner", async () => {
    const kok = await kosu("KZ");
    const t = cikti();
    const kod = await kapilariKos(["a"], {
      kos: () => { appendFileSync(join(kok, "kosular", "KZ.jsonl"), "{bozuk\n"); return 0; }, kosu: "KZ", kok, yaz: t.c.err,
    });
    expect(kod).toBe(1);
    expect(t.o.err).toMatch(/satır 2: JSON değil/);
  });
});

describe("kilit", () => {
  const onceki = { ...KILIT };
  afterEach(() => Object.assign(KILIT, onceki));
  const eski = () => new Date(Date.now() - 60_000);
  const bayatYap = (yol: string) => utimesSync(yol, eski(), eski());
  const oluPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number;
  const bilgi = (pid: number, zaman = Date.now() - 60_000) =>
    JSON.stringify({ pid, makine: hostname(), jeton: `t.${pid}.${zaman}`, zaman });

  it("taze kilit dolu kalırsa zaman aşımında DefterHatasi, başkasının kilidine dokunulmaz", () => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(`${p}.kilit`, "baskasi");
    KILIT.beklemeMs = 120;
    const t0 = Date.now();
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "a")).toThrow(DefterHatasi);
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "a")).toThrow(/kilit alınamadı/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(readFileSync(`${p}.kilit`, "utf8")).toBe("baskasi");
    expect(existsSync(p)).toBe(false);
  });
  it("yaşayan sahibin kilidi ne kadar eski olsa da devralınmaz", () => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(`${p}.kilit`, bilgi(process.pid));
    bayatYap(`${p}.kilit`);
    expect(kilitBayatMi(kilitOku(`${p}.kilit`)!)).toBe(false);
    KILIT.beklemeMs = 100;
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "a")).toThrow(/kilit alınamadı/);
  });
  it("ölü sahibin kilidi süre dolunca devralınır, dolmadan devralınmaz", () => {
    const p = join(gecici(), "d.jsonl");
    const pid = oluPid();
    writeFileSync(`${p}.kilit`, bilgi(pid, Date.now()));
    expect(kilitBayatMi(kilitOku(`${p}.kilit`)!)).toBe(false); // ölü ama taze
    writeFileSync(`${p}.kilit`, bilgi(pid));
    bayatYap(`${p}.kilit`);
    expect(kilitBayatMi(kilitOku(`${p}.kilit`)!)).toBe(true);
    ekle(p, "t", "o", "k", "g", "kim", "a");
    expect(dogrula(p)).toEqual([]);
    expect(existsSync(`${p}.kilit`)).toBe(false);
  });
  it("başka makinenin kilidi yalnız süreyle bayat sayılır", () => {
    const k = { bilgi: { pid: process.pid, makine: "baska-makine", jeton: "x", zaman: Date.now() - 60_000 }, mtimeMs: Date.now() - 60_000 };
    expect(kilitBayatMi(k)).toBe(true);
    expect(kilitBayatMi({ ...k, mtimeMs: Date.now() })).toBe(false);
  });
  it("belirlenimci yarış: A devralıp kilidi alır, aynı bayatı gören B A'nın kilidini kaldıramaz, C giremez", () => {
    const p = join(gecici(), "d.jsonl");
    const kilit = `${p}.kilit`;
    writeFileSync(kilit, "olu");
    bayatYap(kilit);
    const gorulen = kilitOku(kilit)!; // A ve B ikisi de bayat görür
    expect(bayatKilidiDevral(kilit, gorulen)).toBe(true); // A devraldı
    const a = kilitAl(p); // A kritik bölgede
    expect(bayatKilidiDevral(kilit, gorulen)).toBe(false); // B: aynı örnek artık yok
    expect(kilitOku(kilit)!.bilgi!.jeton).toBe(a.jeton);
    KILIT.beklemeMs = 80;
    expect(() => kilitAl(p)).toThrow(/kilit alınamadı/); // C giremez
    expect(kilitOku(kilit)!.bilgi!.jeton).toBe(a.jeton);
    kilitBirak(a);
    expect(existsSync(kilit)).toBe(false);
    expect(readdirSync(dirname(kilit)).filter((x) => x.includes(".devir.") || x.endsWith(".tmp"))).toEqual([]);
  });
  it("devir hakkını alan süreç ölürse devir dosyası da bayat sayılıp kaldırılır", () => {
    const p = join(gecici(), "d.jsonl");
    const kilit = `${p}.kilit`;
    writeFileSync(kilit, "olu");
    bayatYap(kilit);
    // Devralan da öldü: önce B'nin devir dosyasının adını öğren (aynı kimlik), sonra ölü pid ile koy.
    const gorulen = kilitOku(kilit)!;
    expect(bayatKilidiDevral(kilit, { ...gorulen, ham: "baska" })).toBe(false); // kimlik uymaz, dokunmaz
    const devirAdi = readdirSync(dirname(kilit)).find((x) => x.includes(".devir."));
    expect(devirAdi).toBeUndefined();
    const sahte = `${kilit}.devir.` + createHash("sha256").update(`${gorulen.ino}\0${gorulen.ham}`).digest("hex").slice(0, 32);
    writeFileSync(sahte, bilgi(oluPid()));
    bayatYap(sahte);
    ekle(p, "t", "o", "k", "g", "kim", "a");
    expect(dogrula(p)).toEqual([]);
    expect(existsSync(sahte)).toBe(false);
  });
  it("bırakırken yalnız kendi jetonu silinir; elden çıkmışsa hata", () => {
    const p = join(gecici(), "d.jsonl");
    const k = kilitAl(p);
    writeFileSync(k.kilit, bilgi(process.pid, Date.now()));
    expect(() => kilitBirak(k)).toThrow(/elden çıkmış/);
    expect(existsSync(k.kilit)).toBe(true);
    unlinkSync(k.kilit);
  });
  it("ekleme ve çapa fsync edilir", () => {
    const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
    const asil = fs.fsyncSync;
    const cagrilar: string[] = [];
    fs.fsyncSync = (fd: number) => {
      cagrilar.push(readlinkSync(`/proc/self/fd/${fd}`));
      asil(fd);
    };
    syncBuiltinESMExports();
    const d = gecici();
    const p = join(d, "d.jsonl");
    try {
      ekle(p, "t", "o", "k", "g", "kim", "a");
    } finally {
      fs.fsyncSync = asil;
      syncBuiltinESMExports();
    }
    const gercek = realpathSync(d);
    expect(cagrilar).toEqual([join(gercek, "d.jsonl"), join(gercek, "d.son.tmp"), gercek]);
  });
  it("bayat kilit varken 6 süreç aynı anda yazar, zincir sağlam", async () => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(`${p}.kilit`, "olu-surec");
    bayatYap(`${p}.kilit`);
    const isci = join(import.meta.dirname, "ekle_isci.ts");
    const calis = (no: number) => new Promise<number>((coz) => {
      spawn(process.execPath, [isci, p, String(no), "4"], { stdio: "inherit" }).on("close", (k) => coz(k ?? -1));
    });
    expect(await Promise.all(Array.from({ length: 6 }, (_, n) => calis(n)))).toEqual(Array(6).fill(0));
    expect(readFileSync(p, "utf8").trim().split("\n")).toHaveLength(24);
    expect(dogrula(p)).toEqual([]);
    expect(existsSync(`${p}.kilit`)).toBe(false);
  }, 60_000);
});

describe("monoton süre ve UUIDv7", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("duvar saati geri gitse de süre eksi olmaz, bitis başlangıçtan önce olmaz", async () => {
    const kok = join(gecici(), ".iz");
    const gercek = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(gercek).mockReturnValue(gercek - 3_600_000);
    await adim("a", { kok, kosu: "KM" }, () => new Promise((r) => setTimeout(r, 20)));
    const k = JSON.parse(readFileSync(join(kok, "kosular", "KM.jsonl"), "utf8")) as Record<string, string | number>;
    expect(k.sure_ms as number).toBeGreaterThanOrEqual(15);
    expect(k.sure_ms as number).toBeLessThan(5000);
    expect((k.bitis as string) >= (k.baslangic as string)).toBe(true);
  });
  it("20000 kimlik kesin artan", () => {
    const ids = Array.from({ length: 20000 }, () => uuid7());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("sayaç taşması ve geri saat", () => {
    const sabit = Date.now() + 10_000_000;
    const ids = Array.from({ length: 5000 }, () => uuid7(sabit));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5000);
    expect(parseInt(ids.at(-1)!.replace(/-/g, "").slice(0, 12), 16)).toBeGreaterThan(sabit);
    const geri = uuid7(sabit - 60_000);
    expect(geri > ids.at(-1)!).toBe(true);
    expect(geri[14]).toBe("7");
    expect("89ab").toContain(geri[19]);
  });
});

describe("serileştirme ve maske", () => {
  it("günlük satırı: eşsiz vekil kaçışlı, NaN null, bigint metin", async () => {
    const kok = join(gecici(), ".iz");
    await adim("a", { kok, kosu: "KS", nitelikler: { v: "a\ud800b", nan: Number.NaN, buyuk: 2n ** 64n } }, () => undefined);
    const ham = readFileSync(join(kok, "kosular", "KS.jsonl"));
    new TextDecoder("utf-8", { fatal: true }).decode(ham);
    expect(ham.toString()).toContain('"a\\ud800b"');
    const n = (JSON.parse(ham.toString()) as { nitelikler: Record<string, unknown> }).nitelikler;
    expect(n.nan).toBeNull();
    expect(n.buyuk).toBe(String(2n ** 64n));
  });
  it("kimlik doğrulayıcıları", () => {
    expect(tcknGecerli("10000000146")).toBe(true);
    expect(tcknGecerli("10000000147")).toBe(false);
    expect(tcknGecerli("01234567890")).toBe(false);
    expect(ibanGecerli("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(ibanGecerli("TR330006100519786457841327")).toBe(false);
    expect(ibanGecerli("TR3")).toBe(false);
    expect(ibanGecerli("TR33-0006")).toBe(false);
  });
});

describe("denetim düzeltmeleri: alan türleri, __proto__", () => {
  it.each([
    [{ tur: "" }, "alan tur boş"], [{ anahtar: ["x"] }, "alan anahtar metin değil"],
    [{ karar: { a: 1 } }, "alan karar metin değil"], [{ zaman: "dün" }, "alan zaman biçimi geçersiz"],
    [{ kim: null }, "alan kim metin değil"],
  ] as [Record<string, unknown>, string][])("ekle %j -> %s", (deg, ileti) => {
    const p = join(gecici(), "d.jsonl");
    const a = { tur: "t", ozne: "o", karar: "k", gerekce: "g", kim: "kim", anahtar: "a1", zaman: undefined, ...deg } as unknown as Record<string, string>;
    expect(() => ekle(p, a.tur!, a.ozne!, a.karar!, a.gerekce!, a.kim!, a.anahtar!, a.zaman)).toThrow(`geçersiz kayıt: ${ileti}`);
    expect(existsSync(p) ? readFileSync(p).length : 0).toBe(0);
  });
  it("günlükte ad liste ya da sonuc nesne bozuk satır sayılır (Python ile aynı)", async () => {
    const kok = await kosu("KL", '{"ad":["a"],"sonuc":"tamam"}\n', '{"ad":"b","sonuc":{"x":1}}\n');
    const t = cikti();
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "KL", "--gerekli", "a"], t.c)).toBe(2);
    expect(t.o.err.trim().split("\n")).toEqual([
      "iz kontrol: satır 2: alan ad metin değil", "iz kontrol: satır 3: alan sonuc metin değil", "iz kontrol: 2 bozuk satır atlandı",
    ]);
  });
  it("__proto__ anahtarı prototipe yazılmaz, değer kaybolmaz", () => {
    const r = maskele(JSON.parse('{"__proto__":{"token":"s","x":"a@b.co"},"a":2}')) as Record<string, unknown>;
    expect(JSON.stringify(r)).toBe('{"__proto__":{"token":"***","x":"***"},"a":2}');
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(Object.hasOwn(r, "__proto__")).toBe(true);
  });
});
