import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adim, cliMain, dogrula, ekle, eksikAdimlar, kapilariKos, kayitSurumu, maskele, SEMA_SURUMU, SurumHatasi, uuid7, type Json,
} from "../src/index.ts";

const TD = join(import.meta.dirname, "..", "..", "testdata");
const oku = (ad: string) => readFileSync(join(TD, ad), "utf8");
const girdiler = JSON.parse(oku("defter_girdi.json")) as Record<string, string>[];
const gecici = () => mkdtempSync(join(tmpdir(), "iz-"));

function uret(yol: string) {
  for (const g of girdiler) ekle(yol, g.tur!, g.ozne!, g.karar!, g.gerekce!, g.kim!, g.anahtar!, g.zaman);
}

describe("defter", () => {
  it("Python altın dosyasıyla bayt bayt aynı üretir", () => {
    const p = join(gecici(), "d.jsonl");
    uret(p);
    expect(readFileSync(p, "utf8")).toBe(oku("defter_altin.jsonl"));
  });
  it("Python'un yazdığı altın defteri doğrular", () => {
    expect(dogrula(join(TD, "defter_altin.jsonl"))).toEqual([]);
  });
  it("bozuk satırı numarasıyla söyler", () => {
    expect(dogrula(join(TD, "defter_bozuk.jsonl"))).toEqual([oku("defter_bozuk.beklenen").trim()]);
  });
  it("aynı anahtarı reddeder", () => {
    const p = join(gecici(), "d.jsonl");
    uret(p);
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "k-001")).toThrow(/anahtar zaten var/);
  });
  it("silinen satır zinciri kırar", () => {
    const p = join(gecici(), "d.jsonl");
    uret(p);
    const s = readFileSync(p, "utf8").split("\n");
    s.splice(1, 1);
    writeFileSync(p, s.join("\n"));
    expect(dogrula(p)[0]).toMatch(/^satır 2/);
  });
});

describe("maske", () => {
  it("altın durumlar", () => {
    const durumlar = JSON.parse(oku("maskele.json").replaceAll("<~>", "")) /* sahte sır örnekleri <~> ile bölünmüş */ as { girdi: Json; beklenen: Json }[];
    for (const d of durumlar) expect(maskele(d.girdi)).toEqual(d.beklenen);
  });
});

describe("adim", () => {
  it("iç içe adım, üst kimliği, hata sınıfı, maskeleme", async () => {
    const kok = join(gecici(), ".iz");
    const g = join(gecici(), "g.txt");
    writeFileSync(g, "girdi");
    await adim("uret", { girdiler: [g], nitelikler: { token: "abc" }, kok, kosu: "K1" }, async (a) => {
      await adim("ic", { kok, kosu: "K1" }, () => undefined);
      a.cikti(g);
    });
    await expect(adim("bozuk", { kok, kosu: "K1" }, () => { throw new TypeError("x"); })).rejects.toThrow();
    const kay = readFileSync(join(kok, "kosular", "K1.jsonl"), "utf8").trim().split("\n")
      .map((s) => JSON.parse(s) as Record<string, any>);
    const ana = kay.find((k) => k.ad === "uret")!;
    expect(kay.find((k) => k.ad === "ic")!.ust).toBe(ana.adim);
    expect(ana.nitelikler.token).toBe("***");
    expect(ana.cikti[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(kay.find((k) => k.ad === "bozuk")!.hata).toBe("TypeError");
  });
  it("uuid7", () => {
    expect(uuid7()[14]).toBe("7");
  });
});

describe("eşzamanlılık", () => {
  it("8 süreç aynı deftere yazar, zincir sağlam kalır", async () => {
    const p = join(gecici(), "d.jsonl");
    const isci = join(import.meta.dirname, "ekle_isci.ts");
    const calis = (no: number) => new Promise<number>((coz) => {
      const c = spawn(process.execPath, [isci, p, String(no), "5"], { stdio: "inherit" });
      c.on("close", (kod) => coz(kod ?? -1));
    });
    const kodlar = await Promise.all(Array.from({ length: 8 }, (_, n) => calis(n)));
    expect(kodlar).toEqual(Array(8).fill(0));
    expect(readFileSync(p, "utf8").trim().split("\n")).toHaveLength(40);
    expect(dogrula(p)).toEqual([]);
    expect(existsSync(`${p}.kilit`)).toBe(false);
  }, 60_000);
  it("eski (30 sn+) kilit silinir", () => {
    const p = join(gecici(), "d.jsonl");
    writeFileSync(`${p}.kilit`, "");
    const eski = new Date(Date.now() - 60_000);
    utimesSync(`${p}.kilit`, eski, eski);
    ekle(p, "t", "o", "k", "g", "kim", "a");
    expect(dogrula(p)).toEqual([]);
  });
});

describe("kontrol, cli, kapı", () => {
  const cikti = () => {
    const o = { out: "", err: "" };
    return { o, c: { out: (s: string) => { o.out += s; }, err: (s: string) => { o.err += s; } } };
  };
  it("eksikAdimlar yalnız tamam sayar, gerekli sırasını korur", async () => {
    const kok = join(gecici(), ".iz");
    await adim("a", { kok, kosu: "K" }, () => undefined);
    await expect(adim("b", { kok, kosu: "K" }, () => { throw new Error("x"); })).rejects.toThrow();
    expect(eksikAdimlar(kok, "K", ["c", "b", "a"])).toEqual(["c", "b"]);
    expect(eksikAdimlar(kok, "yok", ["a"])).toEqual(["a"]);
  });
  it("cli kontrol ve defter-dogrula", async () => {
    const kok = join(gecici(), ".iz");
    await adim("a", { kok, kosu: "K2" }, () => undefined);
    let t = cikti();
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "K2", "--gerekli", "a"], t.c)).toBe(0);
    expect(t.o.out).toBe("tamam\n");
    t = cikti();
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "K2", "--gerekli", "a,b"], t.c)).toBe(1);
    expect(t.o.err).toBe("eksik adım: b\n");
    t = cikti();
    expect(cliMain(["defter-dogrula", join(TD, "defter_altin.jsonl")], t.c)).toBe(0);
    t = cikti();
    expect(cliMain(["defter-dogrula", join(TD, "defter_bozuk.jsonl")], t.c)).toBe(1);
    expect(t.o.err.trim()).toBe(oku("defter_bozuk.beklenen").trim());
  });
  it("node cli.ts doğrudan çalışır", () => {
    const cli = join(import.meta.dirname, "..", "src", "cli.ts");
    const r = spawnSync(process.execPath, [cli, "defter-dogrula", join(TD, "defter_altin.jsonl")]);
    expect(r.status).toBe(0);
    const b = spawnSync(process.execPath, [cli, "defter-dogrula", join(TD, "defter_bozuk.jsonl")], { encoding: "utf8" });
    expect(b.status).toBe(1);
  });
  it("kapilariKos geçer", async () => {
    const kok = join(gecici(), ".iz");
    expect(await kapilariKos(["a", "b"], { kos: () => 0, kosu: "KG", kok })).toBe(0);
    expect(eksikAdimlar(kok, "KG", ["a", "b"])).toEqual([]);
  });
  it("kapilariKos ilk hatada durur, hata kaydı yazar", async () => {
    const kok = join(gecici(), ".iz");
    const gorulen: string[] = [];
    const kod = await kapilariKos(["a", "b", "c"], {
      kos: (k) => { gorulen.push(k); return k === "b" ? 3 : 0; }, kosu: "KH", kok, nitelikler: { x: 1 },
    });
    expect(kod).toBe(3);
    expect(gorulen).toEqual(["a", "b"]);
    const kay = readFileSync(join(kok, "kosular", "KH.jsonl"), "utf8").trim().split("\n")
      .map((s) => JSON.parse(s) as Record<string, any>);
    const b = kay.find((k) => k.ad === "b")!;
    expect(b.sonuc).toBe("hata");
    expect(b.hata).toBe("KapiHatasi");
    expect(b.nitelikler).toEqual({ x: 1, kapi: "b" });
  });
  it("kapilariKos eksik adımı yakalar ve IZ_KOSU'yu geri koyar", async () => {
    const kok = join(gecici(), ".iz");
    const t = cikti();
    delete process.env.IZ_KOSU;
    const kod = await kapilariKos(["a", "b"], {
      kos: (k) => {
        expect(process.env.IZ_KOSU).toBe("KE");
        if (k === "b") writeFileSync(join(kok, "kosular", "KE.jsonl"), "");
        return 0;
      }, kosu: "KE", kok, yaz: t.c.err,
    });
    expect(kod).toBe(1);
    expect(t.o.err).toBe("iz kontrol: eksik adım: a\n");
    expect(process.env.IZ_KOSU).toBeUndefined();
  });
});

describe("sertleştirme", () => {
  it("serileştirilemeyen nitelik (bigint, döngü, Date) asıl istisnayı ezmez", async () => {
    const kok = join(gecici(), ".iz");
    const dongu: Record<string, unknown> = {};
    dongu.kendi = dongu;
    await expect(adim("x", { kok, kosu: "K2", nitelikler: { b: 5n, d: dongu, t: new Date(0) } }, () => {
      throw new RangeError("asil");
    })).rejects.toThrow("asil");
    const kay = JSON.parse(readFileSync(join(kok, "kosular", "K2.jsonl"), "utf8")) as Record<string, any>;
    expect(kay.hata).toBe("RangeError");
    expect(kay.nitelikler.b).toBe("5");
    expect(kay.nitelikler.d.kendi).toBe("[döngü]");
  });
  it("günlük yazım hatası asıl istisnayı ezmez, asıl hata yoksa yükselir", async () => {
    const kok = join(gecici(), ".iz");
    writeFileSync(kok, "dosya, dizin değil");
    await expect(adim("x", { kok, kosu: "K3" }, () => {
      throw new RangeError("asil");
    })).rejects.toThrow("asil");
    await expect(adim("x", { kok, kosu: "K3" }, () => undefined)).rejects.toThrow();
  });
  it.each(["", "../x", "a/b", "..", "a b", "x".repeat(65), "a\n", "é"])("koşu %j reddedilir", async (kosu) => {
    await expect(adim("x", { kok: gecici(), kosu }, () => undefined)).rejects.toThrow(/koşu/);
    expect(() => eksikAdimlar(gecici(), kosu, ["x"])).toThrow(/koşu/);
  });
  it("IZ_KOSU ortamı doğrulanır", async () => {
    const onceki = process.env.IZ_KOSU;
    process.env.IZ_KOSU = "../../etc/x";
    try {
      await expect(adim("x", { kok: gecici() }, () => undefined)).rejects.toThrow(/koşu/);
    } finally {
      if (onceki === undefined) delete process.env.IZ_KOSU;
      else process.env.IZ_KOSU = onceki;
    }
  });
  it("yol alanı maskelenir", async () => {
    const kok = join(gecici(), ".iz");
    const g = join(gecici(), "alp@example.com.txt");
    writeFileSync(g, "x");
    await adim("x", { girdiler: [g], kok, kosu: "K4" }, () => undefined);
    const s = readFileSync(join(kok, "kosular", "K4.jsonl"), "utf8");
    expect(s).not.toContain("alp@example.com");
  });
  it("ekle bozuk zincire eklemez", () => {
    const p = join(gecici(), "d.jsonl");
    uret(p);
    const s = readFileSync(p, "utf8").split("\n");
    s.splice(1, 1);
    writeFileSync(p, s.join("\n"));
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "yeni")).toThrow(/bozuk/);
    writeFileSync(p, "{yarim\n");
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "yeni")).toThrow(/JSON değil/);
  });
  it("çapa kuyruk kesmeyi yakalar", () => {
    const d = gecici();
    const p = join(d, "d.jsonl");
    uret(p);
    const sat = readFileSync(p, "utf8").split("\n").filter((x) => x !== "");
    expect(readFileSync(join(d, "d.son"), "utf8").trim()).toBe((JSON.parse(sat.at(-1)!) as { hash: string }).hash);
    expect(dogrula(p)).toEqual([]);
    writeFileSync(p, sat.slice(0, -1).join("\n") + "\n");
    expect(dogrula(p)[0]).toMatch(/çapa/);
    expect(() => ekle(p, "t", "o", "k", "g", "kim", "yeni")).toThrow(/çapa/);
    writeFileSync(p, "");
    expect(dogrula(p)[0]).toMatch(/çapa/);
  });
});

describe("sözleşme (sema_surumu)", () => {
  it("alanı olmayan 0.1.x defteri doğrular ve üzerine v1 kayıt ekler", () => {
    expect(dogrula(join(TD, "defter_altin_v1_alansiz.jsonl"))).toEqual([]);
    const p = join(gecici(), "d.jsonl");
    writeFileSync(p, oku("defter_altin_v1_alansiz.jsonl"));
    const k = ekle(p, "karar", "o", "k", "g", "kim", "k-yeni", "2026-11-19T11:00:00Z");
    expect(k.sema_surumu).toBe(SEMA_SURUMU);
    expect(k.sira).toBe(4);
    expect(dogrula(p)).toEqual([]);
  });
  it("ileri sürümü Python ile aynı iletiyle reddeder", () => {
    expect(dogrula(join(TD, "defter_surum_ileri.jsonl"))).toEqual([oku("defter_surum_ileri.beklenen").trim()]);
    for (const s of [2, 0, "1", true, null, 1.5]) expect(() => kayitSurumu({ sema_surumu: s })).toThrow(SurumHatasi);
    expect(kayitSurumu({})).toBe(1);
  });
  it("adım kaydı sema_surumu taşır", async () => {
    const kok = join(gecici(), ".iz");
    await adim("s", { kok, kosu: "KS" }, () => undefined);
    const k = JSON.parse(readFileSync(join(kok, "kosular", "KS.jsonl"), "utf8")) as Record<string, unknown>;
    expect(k.sema_surumu).toBe(1);
  });
  it("kontrol ileri sürümde çıkış 2 verir", () => {
    const kok = join(gecici(), ".iz");
    const kay = { ...(JSON.parse(oku("adim_altin.jsonl").split("\n")[0]!) as object), kosu: "KV", sema_surumu: 2 };
    mkdirSync(join(kok, "kosular"), { recursive: true });
    writeFileSync(join(kok, "kosular", "KV.jsonl"), JSON.stringify(kay) + "\n");
    const err: string[] = [];
    expect(cliMain(["--kok", kok, "kontrol", "--kosu", "KV", "--gerekli", "uret"], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join("")).toMatch(/sema_surumu/);
  });
});
