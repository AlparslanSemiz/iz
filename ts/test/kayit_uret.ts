// Sözleşme testi yardımcısı: TS'nin yazdığı adım ve defter kayıtlarını verilen dizine üretir.
import { join } from "node:path";
import { adim, ekle } from "../src/index.ts";

const dizin = process.argv[2]!;
await adim("ts_uret", { kok: join(dizin, ".iz"), kosu: "TS1", nitelikler: { parola: "x" } }, async () => {
  await adim("ts_ic", { kok: join(dizin, ".iz"), kosu: "TS1" }, () => undefined);
});
ekle(join(dizin, "defter.jsonl"), "karar", "o", "k", "g", "kim", "ts-1");
