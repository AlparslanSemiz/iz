// Kayıt biçimi sözleşmesi (Python: iz.sozlesme). Şemalar depo kökünde `sema/`.
/** Bu sürümün yazdığı kayıt biçimi. Alan eklemek minor; alan silmek ya da anlamını değiştirmek major. */
export const SEMA_SURUMU = 1;
/** Okunan biçimler (N ve N-1). `sema_surumu` alanı olmayan kayıt v1 sayılır. */
export const DESTEKLENEN: readonly number[] = [1];

export class SurumHatasi extends Error {}

export function kayitSurumu(kayit: Record<string, unknown>): number {
  const s = "sema_surumu" in kayit ? kayit.sema_surumu : 1;
  if (typeof s !== "number" || !Number.isInteger(s) || !DESTEKLENEN.includes(s)) {
    throw new SurumHatasi(`desteklenmeyen sema_surumu ${JSON.stringify(s)} (desteklenen: ${JSON.stringify(DESTEKLENEN)})`);
  }
  return s;
}
