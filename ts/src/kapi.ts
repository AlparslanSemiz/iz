// Kapı koşucusu: her kapı bir adım olarak günlüklenir, sonunda eksik adım aranır (Python: kapi.py).
import { adim, kosuDogrula, uuid7 } from "./adim.ts";
import { eksikAdimlar } from "./kontrol.ts";
import type { Json } from "./maske.ts";

export class KapiHatasi extends Error {
  kod: number;
  constructor(kapi: string, kod: number) {
    super(`kapı başarısız: ${kapi} (çıkış ${kod})`);
    this.kod = kod;
  }
}

export interface KapiSecenek {
  kos: (kapi: string) => number;
  kosu?: string;
  kok?: string;
  nitelikler?: Json;
  yaz?: (s: string) => void;
}

async function sirayla(kapilar: string[], sec: KapiSecenek, kosu: string, kok: string): Promise<number> {
  const taban = sec.nitelikler !== null && typeof sec.nitelikler === "object" && !Array.isArray(sec.nitelikler)
    ? sec.nitelikler : {};
  for (const kapi of kapilar) {
    try {
      await adim(kapi, { kosu, kok, nitelikler: { ...taban, kapi } }, () => {
        const kod = sec.kos(kapi);
        if (kod !== 0) throw new KapiHatasi(kapi, kod);
      });
    } catch (e) {
      if (e instanceof KapiHatasi) return e.kod;
      throw e;
    }
  }
  return 0;
}

export async function kapilariKos(kapilar: string[], sec: KapiSecenek): Promise<number> {
  const kosu = kosuDogrula(sec.kosu ?? (process.env.IZ_KOSU || uuid7()));
  const kok = sec.kok ?? process.env.IZ_DIZIN ?? ".iz";
  const yaz = sec.yaz ?? ((s: string) => void process.stderr.write(s));
  const onceki = process.env.IZ_KOSU;
  process.env.IZ_KOSU = kosu;
  try {
    const kod = await sirayla(kapilar, sec, kosu, kok);
    if (kod !== 0) return kod;
    let eksik: string[];
    try {
      eksik = eksikAdimlar(kok, kosu, kapilar);
    } catch (e) {
      // Python tarafı `iz kontrol` alt sürecinin sıfır dışı kodunu 1'e indirir; aynısı.
      yaz(`iz kontrol: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    if (eksik.length) {
      yaz("iz kontrol: eksik adım: " + eksik.join(", ") + "\n");
      return 1;
    }
    return 0;
  } finally {
    if (onceki === undefined) delete process.env.IZ_KOSU;
    else process.env.IZ_KOSU = onceki;
  }
}
