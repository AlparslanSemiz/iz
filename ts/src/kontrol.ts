// Adım günlüğü okuma ve eksik adım kontrolü (Python: iz.kontrol). Bozuk satır atlanır, satır numarasıyla bildirilir.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kosuDogrula } from "./adim.ts";
import { kayitSurumu } from "./sozlesme.ts";

/** Gerekli alanlardan liste olanlar; geri kalan gerekli alanlar metin olmalı. */
const LISTE_ALANLARI = new Set(["girdi", "cikti"]);

/** Günlükte bozuk satır var (yarım yazım, elle bozulma). */
export class GunlukHatasi extends Error {}

/**
 * Satırlar yalnız "\n" ile bölünür, sondaki "\r" ve boş satır yok sayılır. JSON nesnesi olmayan ya da gerekli alanı
 * eksik satır atlanıp hataya yazılır; desteklenmeyen `sema_surumu` SurumHatasi ile durur.
 */
export function gunlukOku(
  yol: string, gerekliAlanlar: readonly string[] = ["ad", "sonuc"],
): { kayitlar: Record<string, unknown>[]; hatalar: string[] } {
  const kayitlar: Record<string, unknown>[] = [];
  const hatalar: string[] = [];
  if (!existsSync(yol)) return { kayitlar, hatalar };
  const satirlar = readFileSync(yol, "utf8").split("\n");
  for (let i = 0; i < satirlar.length; i++) {
    const s = (satirlar[i] as string).replace(/\r$/, "");
    if (s.trim() === "") continue;
    let j: unknown;
    try {
      j = JSON.parse(s);
    } catch {
      j = null;
    }
    if (j === null || typeof j !== "object" || Array.isArray(j)) {
      hatalar.push(`satır ${i + 1}: JSON değil`);
      continue;
    }
    const k = j as Record<string, unknown>;
    kayitSurumu(k);
    const eksik = gerekliAlanlar.filter((a) => !(a in k));
    if (eksik.length) {
      hatalar.push(`satır ${i + 1}: eksik alan ${eksik.join(",")}`);
      continue;
    }
    const yanlis = gerekliAlanlar.find((a) => !LISTE_ALANLARI.has(a) && typeof k[a] !== "string");
    if (yanlis !== undefined) {
      hatalar.push(`satır ${i + 1}: alan ${yanlis} metin değil`);
      continue;
    }
    kayitlar.push(k);
  }
  return { kayitlar, hatalar };
}

/** Eksik adımlar ve bozuk satır hataları. */
export function kosuDurumu(kok: string, kosu: string, gerekli: string[]): { eksik: string[]; hatalar: string[] } {
  const { kayitlar, hatalar } = gunlukOku(join(kok, "kosular", `${kosuDogrula(kosu)}.jsonl`));
  const tamam = new Set(kayitlar.filter((k) => k.sonuc === "tamam").map((k) => k.ad));
  return { eksik: gerekli.filter((g) => !tamam.has(g)), hatalar };
}

/** Bozuk satır varsa GunlukHatasi (ilk satır numarası ve atlanan sayısıyla). */
export function eksikAdimlar(kok: string, kosu: string, gerekli: string[]): string[] {
  const { eksik, hatalar } = kosuDurumu(kok, kosu, gerekli);
  if (hatalar.length) throw new GunlukHatasi(`${hatalar[0]} (${hatalar.length} bozuk satır atlandı)`);
  return eksik;
}
