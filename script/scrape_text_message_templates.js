// ============================================================
// scrape_text_message_templates.js
// Scrapes "Text Message Template" (Power BI Page 2)
// GitHub Actions SAFE (explicit Chrome path)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer-core");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-message-templates.json";

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
  // Launch browser (Chrome path injected by workflow)
  // ----------------------------------------------------------

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.CHROME_PATH,
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

    await frame.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], button'));
      const target = tabs.find(t =>
        t.textContent?.toLowerCase().includes("text message template")
      );
      if (target) target.click();
    });

    await new Promise(r => setTimeout(r, 8000));

    // ----------------------------------------------------------
    // Scroll table
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
    // Extract text
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
    // Parse rows (3-column table)
    // ----------------------------------------------------------

    const results = [];
    let i = 0;

    while (i < lines.length - 2) {
      const category = lines[i];
      const head = lines[i + 1];
      const ckg = lines[i + 2];

      if (head.includes("$") && ckg.includes("c")) {
        results.push({
          price_stock_category: category,
          text_template_head: head,
          text_template_ckg: ckg
        });
        i += 3;
      } else {
        i++;
      }
    }

    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        {
          updated_at: new Date().toISOString(),
          templates: results
        },
        null,
        2
      )
    );

    console.log(`✓ Templates captured: ${results.length}`);
    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error("❌ Scraper failed:", err);
    await browser.close();
    process.exit(1);
  }
})();
