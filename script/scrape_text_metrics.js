// ============================================================
// scrape_text_metrics.js
// Power BI TABLE-based scraper (National + All States)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-metrics.json";

  function clean(text) {
    return text
      .normalize("NFKD")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  const STATES = ["NSW", "QLD", "VIC", "SA", "Tas", "WA", "NT"];
  const CATEGORY_GROUPS = ["Steers", "Heifers", "Breeding Stock"];

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);

    console.log("→ Navigating...");
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 10000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(clean)
      .filter(Boolean);

    console.log(`→ Extracted ${lines.length} lines`);

    // ----------------------------------------------------------
    // Output structure
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    const stateBuckets = {};

    STATES.forEach(s => {
      stateBuckets[s] = {
        state: s,
        categories: []
      };
    });

    // ----------------------------------------------------------
    // Row parser (TABLE ROWS)
    // ----------------------------------------------------------

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Split by double-space heuristic
      const cols = line.split(" ").filter(Boolean);

      // NATIONAL ROW
      if (CATEGORY_GROUPS.includes(cols[0])) {
        // Expected layout:
        // [CategoryGroup, Category(CC), Offered, WeightRange, AvgWeight, $Range, Avg$, Change$, c/kgRange, Avg c/kg, Change, Clearance]

        if (cols.length < 10) continue;

        output.national.push({
          category: cols[1],
          offered: cols[2],
          weight_range: cols[3] + " " + cols[4],
          avg_weight: cols[5],
          dollar_head_range: cols[6] + " " + cols[7],
          avg_dollar_head: cols[8],
          dollar_change: cols[9],
          c_kg_range: cols[10] + " " + cols[11],
          avg_c_kg: cols[12],
          c_kg_change: cols[13],
          clearance: cols[14]
        });

        continue;
      }

      // STATE ROW
      if (STATES.includes(cols[0])) {
        const state = cols[0];

        if (cols.length < 11) continue;

        stateBuckets[state].categories.push({
          category: cols[2],
          offered: cols[3],
          weight_range: cols[4] + " " + cols[5],
          avg_weight: cols[6],
          dollar_head_range: cols[7] + " " + cols[8],
          avg_dollar_head: cols[9],
          dollar_change: cols[10],
          c_kg_range: cols[11] + " " + cols[12],
          avg_c_kg: cols[13],
          c_kg_change: cols[14],
          clearance: cols[15]
        });
      }
    }

    // Push populated states only
    Object.values(stateBuckets).forEach(s => {
      if (s.categories.length > 0) {
        output.states.push(s);
      }
    });

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("✓ Scrape complete");
    console.log(`  National categories: ${output.national.length}`);
    output.states.forEach(s =>
      console.log(`  ${s.state}: ${s.categories.length} rows`)
    );

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    await browser.close();
    process.exit(1);
  }
})();
