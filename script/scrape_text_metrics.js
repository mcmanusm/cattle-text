// ============================================================
// scrape_text_metrics.js
// AGGRESSIVE MULTI-METHOD SCROLLING for Power BI
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

    // ----------------------------------------------------------
    // AGGRESSIVE SCROLLING - TRY EVERYTHING
    // ----------------------------------------------------------
    console.log("Starting aggressive scroll to load ALL table rows...\n");
    
    const scrollResult = await frame.evaluate(async () => {
      const results = {
        methods: [],
        initialRows: 0,
        finalRows: 0
      };

      // Count initial rows
      const getAllRows = () => Array.from(document.querySelectorAll('div.row'));
      results.initialRows = getAllRows().length;
      console.log(`Initial rows: ${results.initialRows}`);

      // METHOD 1: Find ALL possible scrollable elements
      const scrollableElements = [];
      
      // Try specific selectors
      const selectors = [
        '.bodyCells',
        '.pivotTable',
        '[class*="scroll"]',
        '[class*="container"]',
        '[class*="viewport"]',
        '[class*="content"]'
      ];

      for (const selector of selectors) {
        const els = document.querySelectorAll(selector);
        els.forEach(el => {
          const style = window.getComputedStyle(el);
          if (style.overflow === 'auto' || style.overflow === 'scroll' ||
              style.overflowY === 'auto' || style.overflowY === 'scroll') {
            if (!scrollableElements.includes(el)) {
              scrollableElements.push(el);
              console.log(`Found scrollable: ${selector}`);
            }
          }
        });
      }

      // Walk up from first row to find scrollable parents
      const firstRow = document.querySelector('div.row');
      if (firstRow) {
        let parent = firstRow.parentElement;
        let depth = 0;
        while (parent && depth < 10) {
          const style = window.getComputedStyle(parent);
          if (style.overflow === 'auto' || style.overflow === 'scroll' ||
              style.overflowY === 'auto' || style.overflowY === 'scroll') {
            if (!scrollableElements.includes(parent)) {
              scrollableElements.push(parent);
              console.log(`Found scrollable parent at depth ${depth}`);
            }
          }
          parent = parent.parentElement;
          depth++;
        }
      }

      console.log(`Found ${scrollableElements.length} scrollable elements`);

      // METHOD 2: Scroll EACH scrollable element
      for (let i = 0; i < scrollableElements.length; i++) {
        const el = scrollableElements[i];
        console.log(`\nScrolling element ${i + 1}/${scrollableElements.length}...`);
        
        let scrollAttempts = 0;
        let lastRows = getAllRows().length;
        let stableCount = 0;

        while (scrollAttempts < 30 && stableCount < 3) {
          // Scroll by pixel amount
          el.scrollTop = el.scrollTop + 400;
          await new Promise(r => setTimeout(r, 1000));

          // Check if we got new rows
          const currentRows = getAllRows().length;
          if (currentRows > lastRows) {
            console.log(`  Rows increased: ${lastRows} -> ${currentRows}`);
            lastRows = currentRows;
            stableCount = 0;
          } else {
            stableCount++;
          }

          scrollAttempts++;
        }

        results.methods.push({
          element: i,
          scrolls: scrollAttempts,
          rows: getAllRows().length
        });
      }

      // METHOD 3: Dispatch wheel events to ALL scrollable elements
      console.log(`\nDispatching wheel events...`);
      for (const el of scrollableElements) {
        for (let i = 0; i < 50; i++) {
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 200,
            bubbles: true,
            cancelable: true
          }));
          await new Promise(r => setTimeout(r, 200));
        }
      }

      await new Promise(r => setTimeout(r, 2000));

      // METHOD 4: Try clicking rows to force rendering
      console.log(`\nClicking rows to force rendering...`);
      const allRows = getAllRows();
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        allRows[i].click();
        await new Promise(r => setTimeout(r, 500));
      }

      // Scroll all elements back to top
      console.log(`\nScrolling back to top...`);
      for (const el of scrollableElements) {
        el.scrollTop = 0;
      }

      await new Promise(r => setTimeout(r, 2000));

      results.finalRows = getAllRows().length;
      return results;
    });

    console.log(`\n✓ Scroll complete!`);
    console.log(`  Initial rows: ${scrollResult.initialRows}`);
    console.log(`  Final rows: ${scrollResult.finalRows}`);
    console.log(`  Methods tried: ${scrollResult.methods.length}`);

    await new Promise(r => setTimeout(r, 3000));

    // ----------------------------------------------------------
    // EXTRACT DATA
    // ----------------------------------------------------------
    console.log("\n✓ Extracting data...\n");

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
    // Parse data
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
        
        // Only initialize if doesn't exist yet
        if (currentState !== "National" && !stateMap_Data.has(currentState)) {
          stateMap_Data.set(currentState, {
            state: currentState,
            categories: []
          });
          console.log(`Initialized state: ${currentState}`);
        }
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
