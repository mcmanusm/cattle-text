// ============================================================
// scrape_text_metrics.js
// Power BI TABLE scraper - Fixed for CI/CD + All States
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
      line.includes("AuctionClassification")
    );
  }

  const browser = await puppeteer.launch({
    headless: "new",  // ✅ Works in CI/CD
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000)); // Wait for Power BI to load

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    // Get all text and split into lines
    const rawText = await frame.evaluate(() => document.body.innerText);
    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l && !isJunkLine(l));

    // Save debug output
    fs.writeFileSync("debug_lines.txt", lines.join("\n"));
    fs.writeFileSync(
      "debug_lines_numbered.txt",
      lines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`Total lines after filtering: ${lines.length}`);

    // ----------------------------------------------------------
    // State and Category mappings
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
      "NT": "NT",
      "New South Wales": "NSW",
      "Queensland": "QLD",
      "South Australia": "SA",
      "Tasmania": "Tas",
      "Victoria": "VIC",
      "Western Australia": "WA",
      "Northern Territory": "NT"
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

    // ----------------------------------------------------------
    // Parse metrics following a category
    // ----------------------------------------------------------
    function parseMetrics(startIndex) {
      const metrics = {};
      let cursor = 0;
      
      for (let i = startIndex + 1; i < lines.length; i++) {
        const value = lines[i];
        
        // Stop if we hit another category or state
        if (isStopLine(value)) break;
        
        // Skip junk
        if (isJunkLine(value)) continue;
        
        // Stop if we've collected all metrics
        if (cursor >= metricKeys.length) break;
        
        metrics[metricKeys[cursor]] = value;
        cursor++;
      }
      
      return metrics;
    }

    // ----------------------------------------------------------
    // Parse the lines
    // ----------------------------------------------------------
    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    let currentState = "National";
    let stateBucket = null;

    for (let i = 0; i < lines.length; i++) {
      const label = extractLabel(lines[i]);

      // Check if this is a state header
      if (stateKeys.includes(label)) {
        // Save previous state bucket if exists
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
        }

        // Set new current state
        currentState = stateMap[label];
        
        // Create new bucket for non-National states
        stateBucket = currentState === "National"
          ? null
          : { state: currentState, categories: [] };
        
        console.log(`Found state: ${currentState}`);
        continue;
      }

      // Check if this is a category
      if (categories.includes(label)) {
        const metrics = parseMetrics(i);
        const payload = { category: label, ...metrics };

        if (currentState === "National") {
          output.national.push(payload);
        } else if (stateBucket) {
          stateBucket.categories.push(payload);
        }
        
        console.log(`  Added category: ${label} to ${currentState}`);
      }
    }

    // Don't forget the last state bucket
    if (stateBucket && currentState !== "National") {
      output.states.push(stateBucket);
    }

    // ----------------------------------------------------------
    // Save output
    // ----------------------------------------------------------
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Scrape complete");
    console.log(`  National rows: ${output.national.length}`);
    output.states.forEach(s =>
      console.log(`  ${s.state}: ${s.categories.length}`)
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
