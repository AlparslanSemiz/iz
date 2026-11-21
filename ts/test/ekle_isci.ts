// Eş zamanlılık testi işçisi: node ekle_isci.ts <defter> <no> <adet>; BASLA (ms) verilirse o ana kadar döner
// (tüm işçiler aynı anda yarışa girsin).
import { ekle } from "../src/defter.ts";

const [yol, no, adet] = process.argv.slice(2) as [string, string, string];
const basla = Number(process.env.BASLA ?? 0);
while (Date.now() < basla) {
  // meşgul bekleme: zamanlayıcı gecikmesi yarışı yumuşatmasın
}
for (let i = 0; i < Number(adet); i++) ekle(yol, "t", "o", "k", "g", "kim", `p${no}-${i}`);
