// ============================================================
// scrape_national_only.js
// Scrapes ONLY National cattle prices (Friday Cattle State Averages)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "national-cattle-prices.json";

  function clean(text) {
    return text
      .normalize("NFKD")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractLabel(line) {
    return line.replace(/\s+\d+$/, "").trim();
  }

  function isJunkLine(line) {
    return (
      line === "Additional Conditional Formatting" ||
      line.includes("Press Enter") ||
      line.includes("Scroll") ||
      line.includes("Applied filters") ||
      line.includes("Species is Cattle") ||
      line.includes("Average $/Head") ||
      line.includes("Date ") ||
      line.includes("AuctionClassification") ||
      line === "Select Row" ||
      line.includes("Friday Cattle State Averages")
    );
  }

  function getStockCategory(categoryName) {
    if (categoryName.startsWith("Steers")) return "Steers";
    if (categoryName.startsWith("Heifers")) return "Heifers";
    return "Breeding Stock";
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    
    console.log("Loading page...");
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    console.log("Power BI iframe found, extracting data...\n");

    // Extract all text from the iframe
    const rawText = await frame.evaluate(() => document.body.innerText);
    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l && !isJunkLine(l));

    // Save debug output
    fs.writeFileSync("debug_all_lines.txt", lines.join("\n"));
    console.log(`Total lines extracted: ${lines.length}\n`);

    // Define the categories we're looking for
    const categories = [
      "Steers 0-200kg",
      "Steers 200.1-280kg",
      "Steers 280.1-330kg",
      "Steers 330.1-400kg",
      "Steers 400kg +",
      "Heifers 0-200kg",
      "Heifers 200.1-280kg",
      "Heifers 280.1-330kg",
      "Heifers 330.1-400kg",
      "Heifers 400kg +",
      "NSM Cows",
      "SM Heifers",
      "SM Cows",
      "PTIC Heifers",
      "PTIC Cows",
      "NSM Heifers & Calves",
      "NSM Cows & Calves",
      "SM Heifers & Calves",
      "SM Cows & Calves",
      "PTIC Heifers & Calves",
      "PTIC Cows & Calves",
      "Mixed Sexes"
    ];

    // Metrics that follow each category
    const metricKeys = [
      "offered",
      "weight_range",
      "avg_weight",
      "dollar_head_range",
      "avg_dollar_head",
      "dollar_change",
      "c_kg_range",
      "avg_c_kg",
      "c_kg_change",
      "clearance"
    ];

    // States to recognize (so we stop when we hit them)
    const stateLabels = ["NSW", "QLD", "SA", "Tas", "Vic", "VIC", "WA", "NT"];

    function isStopLine(line) {
      const label = extractLabel(line);
      // Stop if we hit a state label (means we've moved past National)
      return stateLabels.includes(label);
    }

    function parseMetrics(startIndex) {
      const metrics = {};
      let cursor = 0;
      
      for (let i = startIndex + 1; i < lines.length; i++) {
        const value = lines[i];
        
        // Stop if we hit another category or state
        const label = extractLabel(value);
        if (categories.includes(label) || stateLabels.includes(label)) break;
        if (isJunkLine(value)) continue;
        if (cursor >= metricKeys.length) break;
        
        metrics[metricKeys[cursor]] = value;
        cursor++;
      }
      
      return metrics;
    }

    const output = {
      updated_at: new Date().toISOString(),
      market: "National",
      categories: []
    };

    let foundNational = false;
    let hitFirstState = false;

    for (let i = 0; i < lines.length; i++) {
      const label = extractLabel(lines[i]);

      // Check if we've hit a state label
      if (stateLabels.includes(label)) {
        hitFirstState = true;
        console.log(`Stopped at state: ${label}`);
        break;
      }

      // Check if this is a category
      if (categories.includes(label)) {
        foundNational = true;
        const metrics = parseMetrics(i);
        
        const payload = {
          stock_category: getStockCategory(label),
          category: label,
          ...metrics
        };

        output.categories.push(payload);
        console.log(`✓ National: ${label}`);
      }
    }

    if (!foundNational) {
      console.warn("\n⚠ Warning: No national data found. Check debug_all_lines.txt");
    }

    // Save the output
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Scrape complete");
    console.log(`  Categories captured: ${output.categories.length}`);
    console.log(`\nOutput saved to: ${outputFile}`);

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error("✗ Scraping failed:", error);
    await browser.close();
    process.exit(1);
  }
})();
