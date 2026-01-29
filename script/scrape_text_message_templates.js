// ============================================================
// scrape_text_message_templates.js
// Scrapes "Text Message Template" page (Power BI page 2)
// Mirrors working cattle text metrics scraper structure
// SAFE for GitHub Actions (uses full puppeteer)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-message-templates.json";

  // ----------------------------------------------------------
  // Helpers (MATCH metrics scraper)
  // ----------------------------------------------------------

  function clean(text) {
    return text
      .normalize("NFKD")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isJunkLine(line) {
    return (
      !line ||
      line === "Select Row" ||
      line.includes("Scroll") ||
      line.includes("Press Enter") ||
      line.includes("Additional Conditional Formatting") ||
      line.includes("Applied filters") ||
      line.includes("Species is Cattle") ||
      line.includes("Date ")
    );
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

    console.log("→ Navigating...");
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    console.log("→ Switching to Text Message Template page...");

    // ----------------------------------------------------------
    // SWITCH TO PAGE 2 (Text Message Template)
    // ----------------------------------------------------------

    await frame.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('[role="tab"], button'));
      const page2 = buttons.find(b =>
        b.textContent?.toLowerCase().includes("text message template")
      );

      if (page2) {
        page2.click();
      }
    });

    await new Promise(r => setTimeout(r, 8000));

    // ----------------------------------------------------------
    // SCROLL TABLE TO LOAD ALL ROWS
    // ----------------------------------------------------------

    for (let i = 0; i < 15; i++) {
      await frame.evaluate(step => {
        const grids = document.querySelectorAll('div[role="grid"], div[class*="scroll"]');
        grids.forEach(el => {
          if (el.scrollHeight > el.clientHeight) {
            el.scrollTop = (el.scrollHeight / 15) * step;
          }
        });
      }, i);

      await new Promise(r => setTimeout(r, 800));
    }

    await new Promise(r => setTimeout(r, 3000));

    // ----------------------------------------------------------
    // EXTRACT TEXT
    // ----------------------------------------------------------

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l && !isJunkLine(l));

    fs.writeFileSync(
      "debug_text_message_lines.txt",
      lines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`→ Lines extracted: ${lines.length}`);

    // ----------------------------------------------------------
    // PARSE TABLE ROWS
    // Expected layout:
    // Price Stock Category
    // $/Head Template
    // c/kg Template
    // ----------------------------------------------------------

    const results = [];
    let i = 0;

    while (i < lines.length - 2) {
      const stockCategory = lines[i];
      const headTemplate = lines[i + 1];
      const ckgTemplate = lines[i + 2];

      // Heuristic: templates always contain $
      if (headTemplate.includes("$") && ckgTemplate.includes("c")) {
        results.push({
          price_stock_category: stockCategory,
          text_template_head: headTemplate,
          text_template_ckg: ckgTemplate
        });

        i += 3;
      } else {
        i++;
      }
    }

    // ----------------------------------------------------------
    // WRITE OUTPUT
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      templates: results
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Text Message Templates scraped successfully");
    console.log(`  Rows captured: ${results.length}`);
    console.log(`  Output: ${outputFile}`);

    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error("❌ Scraper failed:", err);
    await browser.close();
    process.exit(1);
  }
})();
