// ============================================================
// scrape_text_metrics_table.js
// POWER BI TABLE SAFE SCRAPER (ARIA-COLINDEX BASED)
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

    console.log("→ Loading page…");
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector("iframe");
    await page.waitForTimeout(15000);

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    console.log("→ Scrolling tables…");

    // Scroll all Power BI table containers
    for (let i = 0; i < 15; i++) {
      await frame.evaluate(step => {
        document.querySelectorAll(
          'div[role="grid"], div[class*="scroll"], div.visualContainer'
        ).forEach(el => {
          if (el.scrollHeight > el.clientHeight) {
            el.scrollTop = (el.scrollHeight / 15) * step;
          }
        });
      }, i);
      await page.waitForTimeout(700);
    }

    console.log("→ Extracting rows…");

    const rows = await frame.evaluate(() => {
      const output = [];

      document.querySelectorAll('div[role="row"]').forEach(row => {
        const cells = row.querySelectorAll('div[role="gridcell"]');
        if (!cells.length) return;

        const record = {};

        cells.forEach(cell => {
          const idx = cell.getAttribute("aria-colindex");
          let text = cell.innerText.replace(/\s+/g, " ").trim();

          if (
            !text ||
            text === "Additional Conditional Formatting" ||
            text.includes("Press Enter") ||
            text.includes("Scroll")
          ) {
            return;
          }

          record[idx] = text;
        });

        if (Object.keys(record).length > 2) {
          output.push(record);
        }
      });

      return output;
    });

    // ----------------------------------------------------------
    // DEBUG (optional but useful)
    // ----------------------------------------------------------
    fs.writeFileSync(
      "debug_rows.json",
      JSON.stringify(rows, null, 2)
    );

    console.log(`→ Rows captured: ${rows.length}`);

    // ----------------------------------------------------------
    // COLUMN MAP (Power BI TABLE)
    // ----------------------------------------------------------
    const COL = {
      LOCATION: "1",       // National / NSW / VIC etc (blank = National)
      STOCK_GROUP: "2",    // Steers / Heifers / Breeding Stock
      CATEGORY: "3",       // Category (CC)
      OFFERED: "4",
      WEIGHT_RANGE: "5",
      AVG_WEIGHT: "6",
      DOLLAR_RANGE: "7",
      AVG_DOLLAR: "8",
      DOLLAR_CHANGE: "9",
      CKG_RANGE: "10",
      AVG_CKG: "11",
      CKG_CHANGE: "12",
      CLEARANCE: "13"
    };

    // ----------------------------------------------------------
    // NORMALISE INTO FINAL JSON
    // ----------------------------------------------------------
    const output = {
      updated_at: new Date().toISOString(),
      records: []
    };

    let lastLocation = "National";

    rows.forEach(r => {
      const location = r[COL.LOCATION] || lastLocation;
      lastLocation = location;

      const record = {
        location,
        stock_category: r[COL.STOCK_GROUP] || null,
        category: r[COL.CATEGORY] || null,
        offered: r[COL.OFFERED] || null,
        weight_range: r[COL.WEIGHT_RANGE] || null,
        avg_weight: r[COL.AVG_WEIGHT] || null,
        dollar_head_range: r[COL.DOLLAR_RANGE] || null,
        avg_dollar_head: r[COL.AVG_DOLLAR] || null,
        dollar_change: r[COL.DOLLAR_CHANGE] || null,
        c_kg_range: r[COL.CKG_RANGE] || null,
        avg_c_kg: r[COL.AVG_CKG] || null,
        c_kg_change: r[COL.CKG_CHANGE] || null,
        clearance: r[COL.CLEARANCE] || null
      };

      // Skip junk rows
      if (!record.category || !record.stock_category) return;

      output.records.push(record);
    });

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("✓ Scrape complete");
    console.log(`✓ Records written: ${output.records.length}`);

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err);
    await browser.close();
    process.exit(1);
  }
})();
