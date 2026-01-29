// ============================================================
// scrape_text_metrics.js
// CLEAR FILTERS - Show ALL states data
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

    // ----------------------------------------------------------
    // FIND AND CLEAR ALL FILTERS/SLICERS
    // ----------------------------------------------------------
    console.log("Looking for Power BI filters and slicers...\n");

    const filterInfo = await frame.evaluate(async () => {
      const results = {
        slicers: [],
        filters: [],
        clearButtons: []
      };

      // Find all slicers
      const slicers = document.querySelectorAll('[class*="slicer"], [aria-label*="Slicer"], [role="listbox"]');
      results.slicers = Array.from(slicers).map((s, i) => ({
        index: i,
        class: s.className,
        label: s.getAttribute('aria-label'),
        text: s.textContent.substring(0, 100)
      }));

      // Find filter pane or filter buttons
      const filterElements = document.querySelectorAll('[aria-label*="Filter"], [title*="Filter"], [class*="filter"]');
      results.filters = Array.from(filterElements).map((f, i) => ({
        index: i,
        tag: f.tagName,
        label: f.getAttribute('aria-label'),
        title: f.getAttribute('title')
      }));

      // Find "Clear" or "Reset" buttons
      const allButtons = document.querySelectorAll('button, [role="button"]');
      const clearButtons = Array.from(allButtons).filter(btn =>
        btn.textContent.toLowerCase().includes('clear') ||
        btn.textContent.toLowerCase().includes('reset') ||
        btn.getAttribute('aria-label')?.toLowerCase().includes('clear')
      );

      results.clearButtons = clearButtons.map((btn, i) => ({
        index: i,
        text: btn.textContent,
        label: btn.getAttribute('aria-label')
      }));

      // Try clicking any clear buttons
      for (const btn of clearButtons) {
        console.log(`Clicking clear button: ${btn.textContent}`);
        btn.click();
        await new Promise(r => setTimeout(r, 1500));
      }

      // Try clicking "Select All" in any slicers
      const selectAllButtons = Array.from(allButtons).filter(btn =>
        btn.textContent.toLowerCase().includes('select all') ||
        btn.getAttribute('aria-label')?.toLowerCase().includes('select all')
      );

      for (const btn of selectAllButtons) {
        console.log(`Clicking select all: ${btn.textContent}`);
        btn.click();
        await new Promise(r => setTimeout(r, 1500));
      }

      return results;
    });

    console.log("Filter search results:");
    console.log(`  Slicers found: ${filterInfo.slicers.length}`);
    console.log(`  Filters found: ${filterInfo.filters.length}`);
    console.log(`  Clear buttons found: ${filterInfo.clearButtons.length}`);
    
    if (filterInfo.clearButtons.length > 0) {
      console.log("\nClear buttons:");
      filterInfo.clearButtons.forEach(btn => console.log(`  - ${btn.text} (${btn.label})`));
    }

    fs.writeFileSync("debug_filters.json", JSON.stringify(filterInfo, null, 2));

    // Wait for any filter changes to apply
    await new Promise(r => setTimeout(r, 5000));

    // ----------------------------------------------------------
    // NOW EXTRACT DATA
    // ----------------------------------------------------------
    console.log("\nExtracting data after clearing filters...\n");

    const rawText = await frame.evaluate(() => document.body.innerText);
    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l && !isJunkLine(l));

    fs.writeFileSync("debug_lines.txt", lines.join("\n"));
    fs.writeFileSync(
      "debug_lines_numbered.txt",
      lines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`Total lines after filtering: ${lines.length}\n`);

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

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    const stateMap_Data = new Map();
    let currentState = "National";

    for (let i = 0; i < lines.length; i++) {
      const label = extractLabel(lines[i]);

      if (stateKeys.includes(label)) {
        currentState = stateMap[label];
        
        if (currentState !== "National" && !stateMap_Data.has(currentState)) {
          stateMap_Data.set(currentState, {
            state: currentState,
            categories: []
          });
          console.log(`Initialized state: ${currentState}`);
        }
        continue;
      }

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

    output.states = Array.from(stateMap_Data.values());

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
