// ============================================================
// scrape_text_metrics.js
// Power BI TABLE (ARIA grid) scraper – FINAL VERSION
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
    page.setDefaultTimeout(90000);

    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 8000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    // ----------------------------------------------------------
    // Extract rows via ARIA grid
    // ----------------------------------------------------------

    const rows = await frame.evaluate(() => {
      const result = [];

      document.querySelectorAll('div[role="row"]').forEach(row => {
        const cells = Array.from(
          row.querySelectorAll('div[role="gridcell"]')
        ).map(cell => {
          // Remove hidden conditional formatting text
          const hidden = cell.querySelector(".visually-hidden");
          if (hidden) return null;

          return cell.innerText.replace(/\s+/g, " ").trim();
        });

        if (cells.filter(Boolean).length > 0) {
          result.push(cells);
        }
      });

      return result;
    });

    // ----------------------------------------------------------
    // Output structure
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    const stateBuckets = {};

    const STATES = ["NSW", "QLD", "VIC", "SA", "Tas", "WA", "NT"];

    // ----------------------------------------------------------
    // Parse rows
    // ----------------------------------------------------------

    rows.forEach(cells => {
      // NATIONAL TABLE (no state column)
      if (!STATES.includes(cells[0])) {
        // Expected layout:
        // [CategoryGroup, Category, Offered, WeightRange, AvgWeight, $Range, Avg$, Change$, ckgRange, AvgCkg, Change, Clearance]

        if (cells.length < 10) return;

        output.national.push({
          category: cells[1],
          offered: cells[2],
          weight_range: cells[3],
          avg_weight: cells[4],
          dollar_head_range: cells[5],
          avg_dollar_head: cells[6],
          dollar_change: cells[7],
          c_kg_range: cells[8],
          avg_c_kg: cells[9],
          c_kg_change: cells[10] || null,
          clearance: cells[11] || null
        });

        return;
      }

      // STATE TABLE
      const state = cells[0];

      if (!stateBuckets[state]) {
        stateBuckets[state] = {
          state,
          categories: []
        };
      }

      // Expected layout:
      // [State, CategoryGroup, Category, Offered, WeightRange, AvgWeight, $Range, Avg$, Change$, ckgRange, AvgCkg, Change, Clearance]

      if (cells.length < 11) return;

      stateBuckets[state].categories.push({
        category: cells[2],
        offered: cells[3],
        weight_range: cells[4],
        avg_weight: cells[5],
        dollar_head_range: cells[6],
        avg_dollar_head: cells[7],
        dollar_change: cells[8],
        c_kg_range: cells[9],
        avg_c_kg: cells[10],
        c_kg_change: cells[11] || null,
        clearance: cells[12] || null
      });
    });

    // Push populated states
    Object.values(stateBuckets).forEach(bucket => {
      if (bucket.categories.length > 0) {
        output.states.push(bucket);
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
