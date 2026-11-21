// Adım günlüğü: .iz/kosular/<kosu>.jsonl (git dışı). Python ile aynı kayıt biçimi.
import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { maskele, maskeleMetin } from "./maske.ts";
import { SEMA_SURUMU } from "./sozlesme.ts";

const KOSU_DESEN = /^[A-Za-z0-9_-]{1,64}$/;

/** Koşu kimliği dosya adı olur: yol kaçışına (../, /, boş) izin yok. */
export function kosuDogrula(kosu: string): string {
  if (typeof kosu !== "string" || !KOSU_DESEN.test(kosu)) {
    throw new Error("geçersiz koşu kimliği (izinli: A-Z a-z 0-9 _ -, 1-64 karakter): " + JSON.stringify(kosu));
  }
  return kosu;
}

// Serileştirilemeyen değer (bigint, döngü) günlüğü çökertmesin (Python: default=str).
export function guvenliJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
  } catch {
    return JSON.stringify({ hata: "serileştirilemedi" });
  }
}

const ust = new AsyncLocalStorage<string>();

let uuidSonMs = -1;
let uuidSayac = 0;

/**
 * RFC 9562 UUIDv7, süreç içinde kesin artan (yöntem 1: 12 bit rand_a sayaç). Aynı milisaniyede sayaç artar; saat
 * geri giderse son zaman damgası kullanılır; sayaç taşarsa zaman damgası bir ms ileri alınır (Python ile aynı).
 */
export function uuid7(simdiMs?: number): string {
  const ms = simdiMs ?? Date.now();
  if (ms > uuidSonMs) {
    uuidSonMs = ms;
    uuidSayac = randomBytes(2).readUInt16BE(0) & 0x7ff;
  } else if (++uuidSayac > 0xfff) {
    uuidSonMs += 1;
    uuidSayac = randomBytes(2).readUInt16BE(0) & 0x7ff;
  }
  const b = randomBytes(16);
  b.writeUIntBE(uuidSonMs, 0, 6);
  b.writeUInt16BE(uuidSayac, 6);
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function dosyaSha256(yol: string): string | null {
  try {
    if (!statSync(yol).isFile()) return null;
  } catch {
    return null;
  }
  return createHash("sha256").update(readFileSync(yol)).digest("hex");
}

function aracSurumu(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

export interface AdimSecenek {
  girdiler?: string[];
  nitelikler?: unknown;
  kok?: string;
  kosu?: string;
}

export class AdimBaglami {
  readonly ciktilar: string[] = [];
  cikti(yol: string): void {
    this.ciktilar.push(yol);
  }
}

const iso = (t: number) => new Date(t).toISOString();

export async function adim<T>(ad: string, sec: AdimSecenek, f: (a: AdimBaglami) => Promise<T> | T): Promise<T> {
  const kok = sec.kok ?? process.env.IZ_DIZIN ?? ".iz";
  const kosu = kosuDogrula(sec.kosu ?? (process.env.IZ_KOSU || uuid7()));
  const id = randomBytes(8).toString("hex");
  const ustId = ust.getStore() ?? null;
  const a = new AdimBaglami();
  const t0 = Date.now(); // duvar saati: yalnız zaman damgası
  const m0 = performance.now(); // monoton saat: yalnız süre
  let hata: string | null = null;
  try {
    return await ust.run(id, () => f(a));
  } catch (e) {
    hata = e instanceof Error ? e.constructor.name : "Error";
    throw e;
  } finally {
    try {
      yaz(kok, kosu, id, ustId, ad, t0, m0, a, sec, hata);
    } catch (e) {
      // Asıl hata varsa günlük hatası ikincil (stderr); yoksa yükselir.
      if (hata === null) throw e; // eslint-disable-line no-unsafe-finally
      process.stderr.write(`iz: günlük yazılamadı (${e instanceof Error ? e.message : String(e)}); asıl hata korunuyor\n`);
    }
  }
}

function yaz(
  kok: string, kosu: string, id: string, ustId: string | null, ad: string, t0: number, m0: number,
  a: AdimBaglami, sec: AdimSecenek, hata: string | null,
): void {
  const sure = Math.max(0, performance.now() - m0);
  // bitis = baslangic + monoton süre: saat geri gitse de bitis baslangictan önce olmaz.
  const kayit = {
    sema_surumu: SEMA_SURUMU, kosu, adim: id, ust: ustId, ad, baslangic: iso(t0), bitis: iso(t0 + sure),
    sure_ms: Math.floor(sure),
    sonuc: hata ? "hata" : "tamam", hata: hata === null ? null : maskeleMetin(hata),
    girdi: (sec.girdiler ?? []).map((yol) => ({ yol: maskeleMetin(yol), sha256: dosyaSha256(yol) })),
    cikti: a.ciktilar.map((yol) => ({ yol: maskeleMetin(yol), sha256: dosyaSha256(yol) })),
    arac_surumu: aracSurumu(), nitelikler: maskele(sec.nitelikler ?? {}),
  };
  mkdirSync(join(kok, "kosular"), { recursive: true });
  sonaSatir(join(kok, "kosular", `${kosu}.jsonl`), guvenliJson(kayit) + "\n");
}

// Önceki yazım yarım kaldıysa yeni kayıt onun sonuna yapışmasın: önce satır sonu (Python ile aynı).
function sonaSatir(yol: string, satir: string): void {
  const fd = openSync(yol, "a+");
  try {
    const boy = fstatSync(fd).size;
    let s = satir;
    if (boy > 0) {
      const son = Buffer.alloc(1);
      readSync(fd, son, 0, 1, boy - 1);
      if (son[0] !== 10) s = "\n" + s;
    }
    writeSync(fd, Buffer.from(s, "utf8"));
  } finally {
    closeSync(fd);
  }
}
