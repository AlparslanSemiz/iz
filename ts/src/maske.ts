// Maskeleme: gizli alan adları, e-posta/telefon, kişisel veri ve bilinen sır biçimleri -> ***
// Python `maske.py` ile aynı desenler ve sıra. Sözlük anahtarı da metin olarak maskelenir; çakışırsa `***#2`.
export const MASKE = "***";
// Alan adı deseni ASCII, normalleştirilmiş ada uygulanır (Python ile aynı; `/i` Unicode katlamaz, Python `re.I` katlar).
const ALAN =
  /(token|secret|password|passwd|pwd|sifre|parola|api[_-]?key|private[_-]?key|anahtar|authorization|cookie|credential)/;
// Türkçe harfler açık tabloyla (NFKC'den sonra): İ/I/ı/i -> i, ş -> s, ç -> c, ğ -> g, ü -> u, ö -> o.
const TR_TABLO: Record<string, string> = {
  "İ": "i", I: "i", "ı": "i", "Ş": "s", "ş": "s", "Ç": "c", "ç": "c", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u", "Ö": "o", "ö": "o",
};

/** NFKC (ſ -> s, Kelvin K -> K, tam genişlik -> ASCII), Türkçe tablo, ASCII küçük harf. Python `alan_adi_normal` ile aynı. */
export function alanAdiNormal(k: string): string {
  return k.normalize("NFKC").replace(/[İIıŞşÇçĞğÜüÖö]/g, (c) => TR_TABLO[c] as string)
    .replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function gizliAlan(k: string): boolean {
  return ALAN.test(alanAdiNormal(k));
}
const EPOSTA = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ON = String.raw`(?<![A-Za-z0-9_])`;
// Sıra önemli: PEM blok önce, Bearer jetondan önce, telefon en sonda.
const SIRLAR: RegExp[] = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|(?![\s\S]))/g,
  /\bBearer[\t\n\v\f\r ]+[A-Za-z0-9._~+/=-]{8,}/gi,
  new RegExp(ON + String.raw`github_pat_[A-Za-z0-9_]{20,}`, "g"),
  new RegExp(ON + String.raw`gh[pousr]_[A-Za-z0-9]{20,}`, "g"),
  new RegExp(ON + String.raw`sk-[A-Za-z0-9_-]{16,}`, "g"),
  new RegExp(ON + String.raw`[sr]k_(?:live|test)_[A-Za-z0-9]{10,}`, "g"),
  new RegExp(ON + String.raw`xox[abposr]-[A-Za-z0-9-]{10,}`, "g"),
  new RegExp(ON + String.raw`AIza[0-9A-Za-z_-]{35}`, "g"),
  new RegExp(ON + String.raw`glpat-[0-9A-Za-z_-]{20,}`, "g"),
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g,
];
// Başlık biçimi: adı kalır, değeri gider.
const BASLIKLAR: RegExp[] = [
  /(\b(?:proxy-)?authorization[\t\n\v\f\r ]*[:=][\t\n\v\f\r ]*)(?:(?:basic|digest|token|negotiate)[\t\n\v\f\r ]+)?[^\t\n\v\f\r ,;]+/gi,
  /(\b(?:set-)?cookie[\t\n\v\f\r ]*:[\t\n\v\f\r ]*)[^\r\n]+/gi,
];
// TC kimlik: 11 hane, ilk hane 0 değil, iki denetim hanesi; harf/rakam komşusu yok (sha256, ULID).
const TCKN = /(?<![0-9A-Za-z])[1-9][0-9]{10}(?![0-9A-Za-z])/g;
// TR IBAN: TR + 24 hane (dörtlü gruplar arası tek boşluk olabilir); mod-97 = 1.
const IBAN = /(?<![0-9A-Za-z])TR[0-9]{2}(?: ?[0-9]{4}){5} ?[0-9]{2}(?![0-9A-Za-z])/gi;
// Telefon: + ile ya da başında 0 ile başlar; tarih (2026-11-19, 19.11.2026, 01-02-2026) ve uzun sayı/özet değildir.
const TELEFON = new RegExp(
  String.raw`(?<![\w.:+/-])(?!\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d\d-\d\d)` +
    String.raw`(?:\+\d{1,3}|0)[\t\n\v\f\r \-()]*\d[\d\t\n\v\f\r \-()]{5,}\d(?!\w)`,
  "g",
);

export function tcknGecerli(s: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(s)) return false;
  const d = [...s].map(Number) as number[];
  const t = (i: number) => d[i] as number;
  const tek = t(0) + t(2) + t(4) + t(6) + t(8);
  const cift = t(1) + t(3) + t(5) + t(7);
  const ilk10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return (((tek * 7 - cift) % 10) + 10) % 10 === t(9) && ilk10 % 10 === t(10);
}

export function ibanGecerli(s: string): boolean {
  const z = s.replace(/ /g, "").toUpperCase();
  if (z.length < 5 || !/^[0-9A-Z]+$/.test(z)) return false;
  let kalan = 0;
  for (const c of z.slice(4) + z.slice(0, 4)) {
    for (const r of String(parseInt(c, 36))) kalan = (kalan * 10 + Number(r)) % 97;
  }
  return kalan === 1;
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function maskeleMetin(s: string): string {
  let r = s;
  for (const d of SIRLAR) r = r.replace(d, MASKE);
  for (const b of BASLIKLAR) r = r.replace(b, (_m, ad: string) => ad + MASKE);
  r = r.replace(IBAN, (m) => (ibanGecerli(m) ? MASKE : m));
  r = r.replace(TCKN, (m) => (tcknGecerli(m) ? MASKE : m));
  return r.replace(EPOSTA, MASKE).replace(TELEFON, MASKE);
}

function anahtar(k: string, kullanilan: Set<string>): string {
  let m = maskeleMetin(k);
  if (kullanilan.has(m)) {
    let i = 2;
    while (kullanilan.has(`${m}#${i}`)) i++;
    m = `${m}#${i}`;
  }
  kullanilan.add(m);
  return m;
}

// Girdi Json tipli ama çalışma anında bigint/Date/Error/Map gelebilir: metne çevrilip maskelenir.
export function maskele(v: unknown, goruldu: WeakSet<object> = new WeakSet()): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return maskeleMetin(v);
  if (typeof v === "object") {
    if (goruldu.has(v)) return "[döngü]";
    if (Array.isArray(v)) {
      goruldu.add(v);
      return v.map((x) => maskele(x, goruldu));
    }
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      goruldu.add(v);
      const o: { [k: string]: Json } = {};
      const kullanilan = new Set<string>();
      for (const [k, x] of Object.entries(v)) {
        // Düz atama `__proto__` anahtarını prototipe yazar (veri kaybı, prototip kirlenmesi): kendi özelliği olarak tanımla.
        Object.defineProperty(o, anahtar(k, kullanilan), {
          value: gizliAlan(k) ? MASKE : maskele(x, goruldu), enumerable: true, writable: true, configurable: true,
        });
      }
      return o;
    }
  }
  try {
    return maskeleMetin(v instanceof Date ? v.toISOString() : String(v));
  } catch {
    return "[serileştirilemedi]";
  }
}
