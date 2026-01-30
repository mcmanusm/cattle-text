// ============================================================
// scrape_text_metrics.js
// FIXED: Handles repeating state headers (state appears before EACH category)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-metrics.json";

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
      line === "Select Row"
    );
  }

  // Determine stock category from category name
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
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    const rawText = await frame.evaluate(() => document.body.innerText);
    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l && !isJunkLine(l));

    // Save debug
    fs.writeFileSync("debug_lines.txt", lines.join("\n"));
    fs.writeFileSync(
      "debug_lines_numbered.txt",
      lines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`Total lines after filtering: ${lines.length}`);

    // ----------------------------------------------------------
    // Mappings
    // ----------------------------------------------------------
    const stateMap = {
      "National": "National",
      "NSW": "NSW",
      "QLD": "QLD",
      "SA": "SA",
      "Tas": "Tas",
      "Vic": "VIC",
      "VIC": "VIC",
      "WA": "WA",
      "NT": "NT"
    };

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

    const stateKeys = Object.keys(stateMap);

    function isStopLine(line) {
      const label = extractLabel(line);
      return stateKeys.includes(label) || categories.includes(label);
    }

    function parseMetrics(startIndex) {
      const metrics = {};
      let cursor = 0;
      
      for (let i = startIndex + 1; i < lines.length; i++) {
        const value = lines[i];
        if (isStopLine(value)) break;
        if (isJunkLine(value)) continue;
        if (cursor >= metricKeys.length) break;
        
        metrics[metricKeys[cursor]] = value;
        cursor++;
      }
      
      return metrics;
    }

    // ----------------------------------------------------------
    // Parse - FIXED: Don't reinitialize state bucket
    // ----------------------------------------------------------
    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    // Use a MAP to group by state properly
    const stateMap_Data = new Map();
    let currentState = "National";

    for (let i = 0; i < lines.length; i++) {
      const label = extractLabel(lines[i]);

      // Check for state header
      if (stateKeys.includes(label)) {
        currentState = stateMap[label];
        
        // ✅ FIXED: Only initialize if doesn't exist yet
        if (currentState !== "National" && !stateMap_Data.has(currentState)) {
          stateMap_Data.set(currentState, {
            state: currentState,
            categories: []
          });
          console.log(`Initialized state: ${currentState}`);
        }
        
        // Don't log every time, just set current state
        continue;
      }

      // Check for category
      if (categories.includes(label)) {
        const metrics = parseMetrics(i);
        const payload = {
          stock_category: getStockCategory(label),
          category: label,
          ...metrics
        };

        if (currentState === "National") {
          output.national.push(payload);
          console.log(`  National: ${label}`);
        } else if (stateMap_Data.has(currentState)) {
          stateMap_Data.get(currentState).categories.push(payload);
          console.log(`  ${currentState}: ${label}`);
        }
      }
    }

    // Convert state map to array
    output.states = Array.from(stateMap_Data.values());

    // ----------------------------------------------------------
    // Save output
    // ----------------------------------------------------------
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Scrape complete");
    console.log(`  National rows: ${output.national.length}`);
    output.states.forEach(s =>
      console.log(`  ${s.state}: ${s.categories.length} categories`)
    );
    console.log(`\nOutput saved to: ${outputFile}`);

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error("✗ Scraping failed:", error);
    await browser.close();
    process.exit(1);
  }
})();
