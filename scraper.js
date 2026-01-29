// ============================================================
// scrape_text_metrics.js
// Power BI TABLE scraper – row-based (CORRECT VERSION)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-metrics.json";

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 8000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    const lines = (await frame.evaluate(() => document.body.innerText))
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    // ----------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------

    const STATES = ["NSW", "QLD", "VIC", "SA", "Tas", "WA", "NT"];

    function isHeader(line) {
      return (
        line === "Category" ||
        line === "State" ||
        line === "Category (CC)"
      );
    }

    // ----------------------------------------------------------
    // Output
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    const stateBuckets = {};

    // ----------------------------------------------------------
    // Parse stream into rows
    // ----------------------------------------------------------

    let i = 0;

    while (i < lines.length) {

      // ----------------------------
      // NATIONAL ROW (11 columns)
      // ----------------------------
      if (
        ["Steers", "Heifers", "Breeding Stock"].includes(lines[i])
      ) {
        const row = lines.slice(i, i + 11);

        if (row.length === 11 && !isHeader(row[0])) {
          output.national.push({
            category: row[1],
            offered: row[2],
            weight_range: row[3],
            avg_weight: row[4],
            dollar_head_range: row[5],
            avg_dollar_head: row[6],
            dollar_change: row[7],
            c_kg_range: row[8],
            avg_c_kg: row[9],
            c_kg_change: row[10],
            clearance: row[11] || null
          });
        }

        i += 11;
        continue;
      }

      // ----------------------------
      // STATE ROW (12 columns)
      // ----------------------------
      if (STATES.includes(lines[i])) {
        const row = lines.slice(i, i + 12);
        const state = row[0];

        if (!stateBuckets[state]) {
          stateBuckets[state] = {
            state,
            categories: []
          };
        }

        if (row.length === 12 && !isHeader(row[1])) {
          stateBuckets[state].categories.push({
            category: row[2],
            offered: row[3],
            weight_range: row[4],
            avg_weight: row[5],
            dollar_head_range: row[6],
            avg_dollar_head: row[7],
            dollar_change: row[8],
            c_kg_range: row[9],
            avg_c_kg: row[10],
            c_kg_change: row[11],
            clearance: row[12] || null
          });
        }

        i += 12;
        continue;
      }

      i++;
    }

    // Push states with data
    Object.values(stateBuckets).forEach(s => {
      if (s.categories.length > 0) {
        output.states.push(s);
      }
    });

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("✓ Scrape complete");
    console.log(`  National rows: ${output.national.length}`);
    output.states.forEach(s =>
      console.log(`  ${s.state}: ${s.categories.length}`)
    );

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err);
    await browser.close();
    process.exit(1);
  }
})();
