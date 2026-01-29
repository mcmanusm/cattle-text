// ============================================================
// scrape_text_message_templates.js
// Scrapes Power BI "Text Message Template" page (Page 2)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-message-templates.json";

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function clean(text) {
    return text
      .normalize("NFKD")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ----------------------------------------------------------
  // Launch browser
  // ----------------------------------------------------------
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);

    console.log("→ Navigating to Power BI embed...");
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 12000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    console.log("→ Switching to page: Text Message Template");

    // ----------------------------------------------------------
    // Switch to Page 2 (Text Message Template)
    // ----------------------------------------------------------
    await frame.evaluate(() => {
      const pageButtons = Array.from(
        document.querySelectorAll('[role="tab"], button')
      );

      const target = pageButtons.find(el =>
        el.innerText?.includes("Text Message Template")
      );

      if (target) {
        target.click();
      }
    });

    await new Promise(r => setTimeout(r, 8000));

    // ----------------------------------------------------------
    // Extract table rows
    // ----------------------------------------------------------
    console.log("→ Extracting table rows...");

    const rows = await frame.evaluate(() => {
      const data = [];

      const rowEls = Array.from(document.querySelectorAll('div[role="row"]'));

      rowEls.forEach(row => {
        const cells = Array.from(
          row.querySelectorAll('div[role="gridcell"]')
        );

        if (cells.length < 3) return;

        const rowData = cells.map(c => c.innerText.trim());

        // Skip header row
        if (rowData[0] === "Price Stock Category") return;

        data.push({
          price_stock_category: rowData[0] || null,
          per_head: rowData[1] || null,
          per_ckg: rowData[2] || null
        });
      });

      return data;
    });

    const cleanedRows = rows
      .map(r => ({
        price_stock_category: clean(r.price_stock_category),
        per_head: clean(r.per_head),
        per_ckg: clean(r.per_ckg)
      }))
      .filter(r => r.price_stock_category);

    // ----------------------------------------------------------
    // Write output
    // ----------------------------------------------------------
    const output = {
      updated_at: new Date().toISOString(),
      templates: cleanedRows
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("✓ Text Message Templates captured");
    console.log(`  Rows: ${cleanedRows.length}`);

    await browser.close();
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    console.error(err.stack);
    await browser.close();
    process.exit(1);
  }
})();
