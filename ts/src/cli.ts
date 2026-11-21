// CLI: node cli.ts [--kok .iz] kontrol --kosu <id> --gerekli a,b | defter-dogrula [yol] | defter-onek <eski> <yeni>
//      | defter-onar [yol]
// Çıktı ve çıkış kodları Python `python -m iz` ile aynıdır (koken yalnız Python'da).
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dogrula, onar, onekDenetle } from "./defter.ts";
import { kosuDurumu } from "./kontrol.ts";

export interface Cikti {
  out: (s: string) => void;
  err: (s: string) => void;
}

const varsayilan: Cikti = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
};

function kullanim(c: Cikti, mesaj: string): number {
  c.err("kullanım: iz [--kok KOK] {kontrol,defter-dogrula,defter-onek,defter-onar} ...\n" + `iz: hata: ${mesaj}\n`);
  return 2;
}

function secenek(arg: string[], ad: string): string | undefined {
  const i = arg.indexOf(ad);
  return i >= 0 ? arg[i + 1] : undefined;
}

export function main(argv: string[], c: Cikti = varsayilan): number {
  let kok = ".iz";
  let i = 0;
  if (argv[0] === "--kok") {
    if (argv[1] === undefined) return kullanim(c, "argument --kok: beklenen bir değer");
    kok = argv[1];
    i = 2;
  }
  const komut = argv[i];
  const arg = argv.slice(i + 1);
  if (komut === "kontrol") {
    const kosu = secenek(arg, "--kosu");
    const gerekli = secenek(arg, "--gerekli");
    if (kosu === undefined || gerekli === undefined) return kullanim(c, "gerekli argümanlar: --kosu, --gerekli");
    let d: { eksik: string[]; hatalar: string[] };
    try {
      d = kosuDurumu(kok, kosu, gerekli.split(",").filter((x) => x !== ""));
    } catch (e) {
      c.err(`iz kontrol: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
    for (const h of d.hatalar) c.err(`iz kontrol: ${h}\n`);
    if (d.hatalar.length) c.err(`iz kontrol: ${d.hatalar.length} bozuk satır atlandı\n`);
    if (d.eksik.length) c.err("eksik adım: " + d.eksik.join(", ") + "\n");
    if (d.hatalar.length) return 2;
    if (d.eksik.length) return 1;
    c.out("tamam\n");
    return 0;
  }
  if (komut === "defter-onek") {
    if (arg[0] === undefined || arg[1] === undefined) return kullanim(c, "gerekli argümanlar: eski, yeni");
    let eski: Buffer;
    let yeni: Buffer;
    try {
      eski = readFileSync(arg[0]);
      yeni = readFileSync(arg[1]);
    } catch (e) {
      c.err(`defter-onek: okunamadı: ${(e as NodeJS.ErrnoException).path ?? String(e)}\n`);
      return 2;
    }
    const hata = onekDenetle(eski, yeni);
    if (hata) {
      c.err(`defter-onek: ${hata}\n`);
      return 1;
    }
    c.out(`defter-onek: tamam (${yeni.length - eski.length} bayt eklendi)\n`);
    return 0;
  }
  if (komut === "defter-onar") {
    const yol = arg[0] ?? "iz/defter.jsonl";
    let r: { bayt: number; yarim: string } | null;
    try {
      r = onar(yol);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      c.err(`defter-onar: dosya yok: ${yol}\n`);
      return 2;
    }
    c.out(r === null ? `defter-onar: yarım satır yok: ${yol}\n`
      : `defter-onar: son yarım satır (${r.bayt} bayt) ${r.yarim} dosyasına taşındı\n`);
    const hatalar = dogrula(yol);
    for (const h of hatalar) c.err(h + "\n");
    return hatalar.length ? 1 : 0;
  }
  if (komut === "defter-dogrula") {
    const hatalar = dogrula(arg[0] ?? "iz/defter.jsonl");
    for (const h of hatalar) c.err(h + "\n");
    return hatalar.length ? 1 : 0;
  }
  return kullanim(c, komut === undefined ? "komut gerekli" : `bilinmeyen komut: ${komut}`);
}

function dogrudanCalisiyor(): boolean {
  const a = process.argv[1];
  if (a === undefined) return false;
  try {
    return realpathSync(a) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (dogrudanCalisiyor()) process.exitCode = main(process.argv.slice(2));
