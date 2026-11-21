// Karar defteri: append-only JSONL, her kayıt öncekinin sha256'sını taşır (Python ile aynı biçim).
// Satır kuralı: her satır kanonik(kayıt) + "\n" ile bayt bayt aynı; CRLF, yeniden biçim, yinelenen anahtar reddedilir.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, ftruncateSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync,
  unlinkSync, writeFileSync, writeSync, type Stats,
} from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { SEMA_SURUMU, SurumHatasi, kayitSurumu } from "./sozlesme.ts";

export const SIFIR = "0".repeat(64);
const ALANLAR = ["sira", "onceki", "tur", "ozne", "karar", "gerekce", "kim", "anahtar", "zaman"] as const;

export class DefterHatasi extends Error {}
/** Değer kanonik biçimde yazılamaz (ondalık, aralık dışı tam sayı, eşsiz vekil karakter, bilinmeyen tür). */
export class KanonikHatasi extends DefterHatasi {}

export interface Kayit {
  /** Yoksa 1 (0.1.x kayıtları). */
  sema_surumu?: number;
  sira: number;
  onceki: string;
  tur: string;
  ozne: string;
  karar: string;
  gerekce: string;
  kim: string;
  anahtar: string;
  zaman: string;
  hash: string;
}

// Şema (sema/iz-defter.v1.json) ile aynı: metin alanlar, boş olamayanlar, biçimler (Python alan_hatasi).
const BOS_OLMAZ = new Set(["tur", "kim", "anahtar"]);
const BICIM: Record<string, RegExp> = {
  onceki: /^[0-9a-f]{64}$/, hash: /^[0-9a-f]{64}$/, zaman: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/,
};

/** İlk tür/biçim hatası (ALANLAR sırası, sonra hash); yoksa null. */
export function alanHatasi(k: Record<string, unknown>): string | null {
  for (const a of [...ALANLAR, "hash"]) {
    const v = k[a];
    if (a === "sira") {
      if (typeof v !== "number" || !Number.isInteger(v)) return "sıra tam sayı değil";
      continue;
    }
    if (typeof v !== "string") return `alan ${a} metin değil`;
    if (BOS_OLMAZ.has(a) && v === "") return `alan ${a} boş`;
    const b = BICIM[a];
    if (b !== undefined && !b.test(v)) return `alan ${a} biçimi geçersiz`;
  }
  return null;
}

const VEKIL = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Python sort_keys kod noktasına göre sıralar; JS varsayılanı UTF-16 birimine göre (U+FFFF > U+10000 ayrışır).
function kodNoktasiKarsilastir(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function yaz(v: unknown): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) {
      throw new KanonikHatasi(Number.isInteger(v)
        ? `tam sayı güvenli aralık dışında: ${v}` : `ondalık sayı kanonik biçimde desteklenmez: ${v}`);
    }
    return Object.is(v, -0) ? "0" : String(v);
  }
  if (typeof v === "string") {
    if (VEKIL.test(v)) throw new KanonikHatasi("eşsiz vekil karakter (U+D800-U+DFFF) kanonik biçimde yazılamaz");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(yaz).join(",") + "]";
  if (typeof v === "object" && v !== undefined) {
    const o = v as Record<string, unknown>;
    const parca = Object.keys(o).sort(kodNoktasiKarsilastir).map((k) => yaz(k) + ":" + yaz(o[k]));
    return "{" + parca.join(",") + "}";
  }
  throw new KanonikHatasi(`desteklenmeyen tür: ${typeof v}`);
}

/** Anahtarlar kod noktasına göre sıralı (iç içe de), boşluksuz, ASCII dışı olduğu gibi (Python ile bayt bayt aynı). */
export function kanonik(o: Record<string, unknown>): string {
  return yaz(o);
}

export function ozet(k: Record<string, unknown>): string {
  const { hash: _h, ...govde } = k;
  return createHash("sha256").update(kanonik(govde), "utf8").digest("hex");
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Ham satırı (satır sonu hariç) çözer; kural dışıysa hata metni (satır numarasız) döner. */
export function satirCoz(ham: Buffer): Record<string, unknown> | string {
  if (ham.length === 0) return "boş satır";
  let metin: string;
  try {
    metin = utf8.decode(ham);
  } catch {
    return "UTF-8 değil";
  }
  let j: unknown;
  try {
    j = JSON.parse(metin);
  } catch {
    return "JSON değil";
  }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return "JSON değil";
  const k = j as Record<string, unknown>;
  try {
    if (!Buffer.from(kanonik(k), "utf8").equals(ham)) return "kanonik biçimde değil";
  } catch {
    return "kanonik biçimde değil";
  }
  return k;
}

/** Tam satırlar ve son satır sonundan sonra kalan yarım parça. */
function bol(veri: Buffer): { tam: Buffer[]; yarim: Buffer } {
  const tam: Buffer[] = [];
  let bas = 0;
  for (let i = veri.indexOf(10); i >= 0; i = veri.indexOf(10, bas)) {
    tam.push(veri.subarray(bas, i));
    bas = i + 1;
  }
  return { tam, yarim: veri.subarray(bas) };
}

/** Bekleme ve bayatlık süreleri (testte kısaltılabilir). */
export const KILIT = { beklemeMs: 10_000, eskiMs: 30_000 };

function uyu(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Kilit dosyasının içeriği: sahibin pid'i, makinesi, tekil jetonu, alınma zamanı. Dosya oluşturulduktan sonra değişmez. */
export interface KilitBilgisi {
  pid: number;
  makine: string;
  jeton: string;
  zaman: number;
}

export interface Kilit {
  kilit: string;
  jeton: string;
}

/** İçeriği tam yazılmış dosyayı `yol`a atomik koyar: geçici dosya + link (varsa EEXIST, üzerine yazmaz). */
function atomikOlustur(yol: string, icerik: string): boolean {
  const gecici = `${yol}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(gecici, icerik, { flag: "wx" });
  try {
    linkSync(gecici, yol);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return false;
  } finally {
    unlinkSync(gecici);
  }
}

function yeniBilgi(): KilitBilgisi {
  return { pid: process.pid, makine: hostname(), jeton: `${process.pid}.${randomBytes(12).toString("hex")}`, zaman: Date.now() };
}

/** Kilit dosyasını oku: ham içerik, ayrıştırılmış bilgi (eski biçim ya da bozuksa null), inode, mtime. Yoksa null. */
export function kilitOku(yol: string): { ham: string; bilgi: KilitBilgisi | null; ino: number; mtimeMs: number } | null {
  let ham: string;
  let s: Stats;
  try {
    s = statSync(yol);
    ham = readFileSync(yol, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let bilgi: KilitBilgisi | null = null;
  try {
    const j = JSON.parse(ham) as Partial<KilitBilgisi>;
    if (typeof j.pid === "number" && typeof j.jeton === "string" && typeof j.makine === "string" && typeof j.zaman === "number") {
      bilgi = j as KilitBilgisi;
    }
  } catch {
    bilgi = null;
  }
  return { ham, bilgi, ino: s.ino, mtimeMs: s.mtimeMs };
}

function surecYasiyor(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH"; // EPERM: yaşıyor, başka kullanıcının
  }
}

/**
 * Bayat mı: süre dolmuş VE sahibi ölü. Sahip aynı makinedeyse ölülük `kill(pid, 0)` = ESRCH ile kanıtlanır; yaşayan
 * sahibin kilidi ne kadar eski olursa olsun bayat sayılmaz (yavaş sahip elinden alınmaz). Başka makine ya da eski
 * biçim (0.2.x boş içerik, bozuk içerik) yalnız süreyle bayat sayılır.
 */
export function kilitBayatMi(k: { bilgi: KilitBilgisi | null; mtimeMs: number }, simdi = Date.now()): boolean {
  const zaman = k.bilgi?.zaman ?? k.mtimeMs;
  if (simdi - Math.max(zaman, k.mtimeMs) <= KILIT.eskiMs) return false;
  if (k.bilgi !== null && k.bilgi.makine === hostname()) return !surecYasiyor(k.bilgi.pid);
  return true;
}

/** Bir kilit örneğinin değişmez kimliği: jeton; eski biçimde içerik + inode özeti. */
function kimlik(k: { ham: string; bilgi: KilitBilgisi | null; ino: number }): string {
  return createHash("sha256").update(k.bilgi?.jeton ?? `${k.ino}\0${k.ham}`).digest("hex").slice(0, 32);
}

/**
 * Bayat kilit örneğini kaldır. Devir hakkı, o örneğin kimliğine bağlı `${kilit}.devir.<kimlik>` dosyasıyla tek
 * sürece verilir (O_EXCL; aynı örnek için ikinci kez alınamaz, çünkü kimlik tekil ve örnek bir kez silinir).
 * Hakkı alan, yoldaki dosyanın hâlâ aynı örnek olduğunu (kimlik) doğrulayıp siler. Arada başka süreç yeni kilit
 * koyamaz: bayat örnek yerinde durduğu sürece O_EXCL/link başarısız olur ve örneği yalnız hak sahibi siler. Yaşayan
 * sahibin kilidi bayat sayılmadığından hiçbir süreç başkasının taze kilidini kaldıramaz. Devir hakkını alan süreç
 * ölürse devir dosyasının kendisi aynı kuralla (özyinelemeli) bayat sayılıp kaldırılır. Bayat örnek kaldırıldıysa true.
 */
export function bayatKilidiDevral(kilit: string, gorulen: { ham: string; bilgi: KilitBilgisi | null; ino: number }): boolean {
  const devir = `${kilit}.devir.${kimlik(gorulen)}`;
  if (!atomikOlustur(devir, JSON.stringify(yeniBilgi()))) {
    const d = kilitOku(devir);
    if (d !== null && kilitBayatMi(d)) bayatKilidiDevral(devir, d);
    return false;
  }
  try {
    const simdi = kilitOku(kilit);
    if (simdi === null || kimlik(simdi) !== kimlik(gorulen) || !kilitBayatMi(simdi)) return false;
    unlinkSync(kilit);
    return true;
  } finally {
    unlinkSync(devir);
  }
}

function sahibiMiyim(k: Kilit): boolean {
  return kilitOku(k.kilit)?.bilgi?.jeton === k.jeton;
}

/** `${yol}.kilit`; içerik KilitBilgisi (JSON). Python tarafı flock kullanır; iki dil birbirini dışlamaz. */
export function kilitAl(yol: string): Kilit {
  const kilit = `${yol}.kilit`;
  const son = Date.now() + KILIT.beklemeMs;
  for (let deneme = 0; ; deneme++) {
    const b = yeniBilgi();
    if (atomikOlustur(kilit, JSON.stringify(b))) {
      const k = { kilit, jeton: b.jeton };
      if (!sahibiMiyim(k)) throw new DefterHatasi(`kilit alındıktan hemen sonra elden çıktı: ${kilit}`);
      return k;
    }
    const mevcut = kilitOku(kilit);
    if (mevcut !== null && kilitBayatMi(mevcut) && bayatKilidiDevral(kilit, mevcut)) continue;
    if (Date.now() > son) throw new DefterHatasi(`kilit alınamadı: ${kilit}`);
    uyu(Math.min(50, 10 + deneme * 5));
  }
}

/** Yalnız kendi jetonunu taşıyan kilidi siler; değilse (elden çıkmışsa) DefterHatasi, başkasının kilidine dokunmaz. */
export function kilitBirak(k: Kilit): void {
  if (!sahibiMiyim(k)) throw new DefterHatasi(`kilit elden çıkmış, bırakılmadı: ${k.kilit}`);
  unlinkSync(k.kilit);
}

/** Çapa dosyası: son kaydın hash'i (defter.jsonl -> defter.son); kuyruk kesmeyi dogrula() yakalar. */
export function capaYolu(yol: string): string {
  return yol.replace(/\.[^./\\]*$/, "") + ".son";
}

function dizinFsync(d: string): void {
  const fd = openSync(d, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sonaYaz(yol: string, veri: Buffer | string): void {
  const fd = openSync(yol, "a");
  try {
    writeSync(fd, typeof veri === "string" ? Buffer.from(veri, "utf8") : veri);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function capaYaz(yol: string, hash: string): void {
  const c = capaYolu(yol);
  const fd = openSync(`${c}.tmp`, "w");
  try {
    writeSync(fd, hash + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(`${c}.tmp`, c);
  dizinFsync(dirname(c));
}

/** Hatalar ve geçerli kayıtlar; ilk bozuk satırda durur. */
function incele(yol: string): { hatalar: string[]; kayitlar: Kayit[] } {
  const { tam, yarim } = bol(existsSync(yol) ? readFileSync(yol) : Buffer.alloc(0));
  let onceki = SIFIR;
  const gorulen = new Set<string>();
  const gorulenHash = new Set<string>();
  const kayitlar: Kayit[] = [];
  const dur = (h: string) => ({ hatalar: [h], kayitlar });
  for (let i = 0; i < tam.length; i++) {
    const n = i + 1;
    const k = satirCoz(tam[i] as Buffer);
    if (typeof k === "string") return dur(`satır ${n}: ${k}`);
    const eksik = [...ALANLAR, "hash"].filter((a) => !(a in k));
    if (eksik.length) return dur(`satır ${n}: eksik alan ${eksik.join(",")}`);
    try {
      kayitSurumu(k);
    } catch (e) {
      if (e instanceof SurumHatasi) return dur(`satır ${n}: ${e.message}`);
      throw e;
    }
    const ah = alanHatasi(k);
    if (ah !== null) return dur(`satır ${n}: ${ah}`);
    if (k.sira !== n) return dur(`satır ${n}: sıra ${String(k.sira)} beklenen ${n}`);
    if (k.onceki !== onceki) return dur(`satır ${n}: önceki özet uyuşmuyor`);
    if (k.hash !== ozet(k)) return dur(`satır ${n}: özet uyuşmuyor`);
    if (gorulen.has(k.anahtar as string)) return dur(`satır ${n}: anahtar tekrarı ${String(k.anahtar)}`);
    gorulen.add(k.anahtar as string);
    onceki = k.hash as string;
    gorulenHash.add(onceki);
    kayitlar.push(k as unknown as Kayit);
  }
  if (yarim.length) return dur(`satır ${tam.length + 1}: yarım satır (satır sonu yok; kurtarma: iz defter-onar)`);
  const c = capaYolu(yol);
  if (existsSync(c)) {
    const son = readFileSync(c, "utf8").trim();
    // Çapa zincirde olmalı (yazım çökmesinde defter çapadan en çok bir kayıt ileride olabilir).
    if (!gorulenHash.has(son)) return dur(`çapa uyuşmuyor: son kayıt ${son.slice(0, 12)} defterde yok (kuyruk kesilmiş olabilir)`);
  }
  return { hatalar: [], kayitlar };
}

/** Hata listesi (ilk bozuk satırda durur); boşsa zincir sağlam. */
export function dogrula(yol: string): string[] {
  return incele(yol).hatalar;
}

function ekleKilitli(
  yol: string, tur: string, ozne: string, karar: string, gerekce: string, kim: string, anahtar: string, zaman?: string,
): Kayit {
  const { hatalar, kayitlar } = incele(yol);
  if (hatalar.length) throw new DefterHatasi(`defter bozuk, ekleme reddedildi: ${hatalar[0]}`);
  if (kayitlar.some((k) => k.anahtar === anahtar)) throw new DefterHatasi(`anahtar zaten var: ${anahtar}`);
  const govde = {
    sema_surumu: SEMA_SURUMU, sira: kayitlar.length + 1, onceki: kayitlar.at(-1)?.hash ?? SIFIR, tur, ozne, karar,
    gerekce, kim, anahtar, zaman: zaman ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const ah = alanHatasi({ ...govde, hash: SIFIR });
  if (ah !== null) throw new DefterHatasi(`geçersiz kayıt: ${ah}`);
  const kayit: Kayit = { ...govde, hash: ozet(govde) }; // kanonik değilse burada KanonikHatasi, dosyaya dokunulmaz
  sonaYaz(yol, kanonik({ ...kayit }) + "\n");
  capaYaz(yol, kayit.hash);
  return kayit;
}

function kilitli<T>(yol: string, f: () => T): T {
  mkdirSync(dirname(yol), { recursive: true });
  const k = kilitAl(yol);
  let sonuc: T;
  try {
    // Kritik bölgeden önce yeniden: kilit hâlâ bizim mi.
    if (!sahibiMiyim(k)) throw new DefterHatasi(`kilit elden çıkmış, işlem yapılmadı: ${k.kilit}`);
    sonuc = f();
  } catch (e) {
    try {
      kilitBirak(k);
    } catch {
      // asıl hata öncelikli
    }
    throw e;
  }
  kilitBirak(k); // çıkışta da denetler: elden çıkmışsa hata
  return sonuc;
}

export function ekle(
  yol: string, tur: string, ozne: string, karar: string, gerekce: string, kim: string, anahtar: string, zaman?: string,
): Kayit {
  return kilitli(yol, () => ekleKilitli(yol, tur, ozne, karar, gerekce, kim, anahtar, zaman));
}

/** Yalnız sona ekleme: eski, yeninin bayt öneki olmalı. Değilse hata metni (Python ile aynı). */
export function onekDenetle(eski: Buffer, yeni: Buffer): string | null {
  if (yeni.length >= eski.length && yeni.subarray(0, eski.length).equals(eski)) return null;
  const sinir = Math.min(eski.length, yeni.length);
  let i = 0;
  while (i < sinir && eski[i] === yeni[i]) i++;
  let satir = 1;
  for (let j = 0; j < i; j++) if (eski[j] === 10) satir++;
  if (i === yeni.length) return `satır ${satir}: yeni defter eskisinden kısa (kuyruk kesilmiş); defter yalnız sona eklenebilir`;
  return `satır ${satir} (bayt ${i}): eski içerik değişmiş; defter yalnız sona eklenebilir`;
}

export function yarimYolu(yol: string): string {
  return `${yol}.yarim`;
}

/** Son yarım satırı `<yol>.yarim` sonuna taşır (kanıt silinmez), defteri keser. Taşınan bayt ve yol; yoksa null. */
export function onar(yol: string): { bayt: number; yarim: string } | null {
  if (!existsSync(yol)) throw Object.assign(new Error(`dosya yok: ${yol}`), { code: "ENOENT" });
  return kilitli(yol, () => {
    const veri = readFileSync(yol);
    const { yarim } = bol(veri);
    if (yarim.length === 0) return null;
    const y = yarimYolu(yol);
    sonaYaz(y, Buffer.concat([yarim, Buffer.from("\n")]));
    const fd = openSync(yol, "r+");
    try {
      ftruncateSync(fd, veri.length - yarim.length);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    dizinFsync(dirname(yol));
    return { bayt: yarim.length, yarim: y };
  });
}
