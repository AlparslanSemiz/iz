// Yük yarışı: her turda bayat kilit varken SURE süreç aynı anda (BASLA) yarışa girer; defter hiç bozulmamalı.
// Varsayılan 2 tur (vitest); tam deneme `python3 betikler/gorev.py yuk` (IZ_YARIS_TUR=40).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { dogrula } from "../src/index.ts";

const TUR = Number(process.env.IZ_YARIS_TUR ?? 2);
const SURE = Number(process.env.IZ_YARIS_SUREC ?? 14);
const ADET = 2;
const isci = join(import.meta.dirname, "ekle_isci.ts");

function calis(yol: string, no: number, basla: number): Promise<{ kod: number; err: string }> {
  return new Promise((coz) => {
    const c = spawn(process.execPath, [isci, yol, String(no), String(ADET)], {
      env: { ...process.env, BASLA: String(basla) }, stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    c.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    c.on("close", (kod) => coz({ kod: kod ?? -1, err }));
  });
}

it(`yarış: ${SURE} süreç x ${TUR} tur, bayat kilitle başlar, bozulma 0`, async () => {
  const d = mkdtempSync(join(tmpdir(), "iz-yaris-"));
  const bozuk: string[] = [];
  for (let tur = 0; tur < TUR; tur++) {
    const yol = join(d, `d${tur}.jsonl`);
    writeFileSync(`${yol}.kilit`, "olu");
    const eski = new Date(Date.now() - 100_000);
    utimesSync(`${yol}.kilit`, eski, eski);
    const basla = Date.now() + 1200;
    const r = await Promise.all(Array.from({ length: SURE }, (_, i) => calis(yol, i, basla)));
    const hatalar = r.filter((x) => x.kod !== 0).map((x) => x.err.split("\n").find((l) => l.includes("Hata")) ?? x.err);
    const satir = readFileSync(yol, "utf8").trim().split("\n").length;
    const h = dogrula(yol);
    if (h.length || hatalar.length || satir !== SURE * ADET) bozuk.push(`tur ${tur}: defter=${JSON.stringify(h)} satır=${satir} süreç=${JSON.stringify(hatalar)}`);
  }
  process.stdout.write(`yarış: ${SURE} süreç x ${TUR} tur, bozuk tur ${bozuk.length}\n`);
  expect(bozuk).toEqual([]);
}, 600_000);
