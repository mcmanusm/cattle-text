// ============================================================
// scrape_text_message_template.js
// Scrapes "Text Message Template" page (Power BI page 2)
// Mirrors working cattle text scraper structure
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

    console.log("→ Navigating to Power BI page...");
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    // ----------------------------------------------------------
    // Switch to PAGE 2 (Text Message Template)
    // ----------------------------------------------------------

    console.log("→ Switching to Text Message Template page...");

    await frame.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const target = tabs.find(t =>
        t.textContent.toLowerCase().includes("text message")
      );
      if (target) target.click();
    });

    await new Promise(r => setTimeout(r, 8000));

    // ----------------------------------------------------------
    // Extract text
    // ----------------------------------------------------------

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => !isJunkLine(l));

    fs.writeFileSync(
      "debug_message_template_lines.txt",
      lines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`→ Lines captured: ${lines.length}`);

    // ----------------------------------------------------------
    // Parse rows (3-column repeating pattern)
    // ----------------------------------------------------------

    const templates = [];

    for (let i = 0; i < lines.length - 2; i++) {
      const stock = lines[i];
      const head = lines[i + 1];
      const ckg = lines[i + 2];

      // Heuristic: templates always look like "$" and "c"
      if (
        head.includes("$") &&
        ckg.toLowerCase().includes("c")
      ) {
        templates.push({
          price_stock_category: stock,
          text_head: head,
          text_c_kg: ckg
        });

        i += 2; // move to next row
      }
    }

    const output = {
      updated_at: new Date().toISOString(),
      templates
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Text message templates scraped");
    console.log(`  Templates found: ${templates.length}`);
    console.log(`  Output: ${outputFile}`);

    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error("✗ Template scrape failed:", err);
    await browser.close();
    process.exit(1);
  }
})();
