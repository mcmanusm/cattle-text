// ============================================================
// scrape_text_metrics.js
// WITH AUTO-SCROLLING that dynamically finds all rows
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
    // SCROLL TO LOAD ALL VIRTUALIZED ROWS - ROBUST VERSION
    // ----------------------------------------------------------
    console.log("Starting auto-scroll to load all table data...");
    
    const scrollResult = await frame.evaluate(async () => {
      // Find all div.row elements
      const getAllRows = () => {
        return Array.from(document.querySelectorAll('div.row'));
      };

      // Find the scrollable container (parent of the rows)
      let scrollableElement = null;
      const rows = getAllRows();
      
      if (rows.length > 0) {
        // Walk up the DOM to find scrollable parent
        let parent = rows[0].parentElement;
        while (parent) {
          const overflow = window.getComputedStyle(parent).overflow;
          const overflowY = window.getComputedStyle(parent).overflowY;
          
          if (overflow === 'auto' || overflow === 'scroll' || 
              overflowY === 'auto' || overflowY === 'scroll') {
            scrollableElement = parent;
            console.log('Found scrollable parent:', parent.className);
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!scrollableElement) {
        // Fallback to common Power BI selectors
        scrollableElement = document.querySelector('.bodyCells') 
          || document.querySelector('[class*="scroll"]')
          || document.querySelector('.pivotTable')
          || document.body;
        console.log('Using fallback scrollable element');
      }

      const scrollStep = 300; // Smaller steps for precision
      const scrollDelay = 2000; // Wait 2s after each scroll for rendering
      let lastRowCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 100; // Increased for larger tables

      while (scrollAttempts < maxScrollAttempts) {
        // Get current row count
        const currentRows = getAllRows();
        const currentRowCount = currentRows.length;
        
        console.log(`Scroll ${scrollAttempts}: ${currentRowCount} rows found`);

        // Check if we've found all rows
        if (currentRowCount === lastRowCount) {
          stableCount++;
          // If row count stable for 4 consecutive scrolls, we're done
          if (stableCount >= 4) {
            console.log(`✓ All rows loaded: ${currentRowCount} total rows`);
            return { success: true, totalRows: currentRowCount, scrolls: scrollAttempts };
          }
        } else {
          stableCount = 0;
        }
        
        lastRowCount = currentRowCount;

        // Scroll down by step
        scrollableElement.scrollTop = scrollableElement.scrollTop + scrollStep;
        
        // Wait for new content to render
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
        
        scrollAttempts++;
      }

      return { 
        success: false, 
        totalRows: lastRowCount, 
        scrolls: scrollAttempts,
        message: "Max scroll attempts reached" 
      };
    });

    console.log(`\n✓ Scroll complete!`);
    console.log(`  Total rows found: ${scrollResult.totalRows}`);
    console.log(`  Scrolls performed: ${scrollResult.scrolls}`);
    
    if (!scrollResult.success) {
      console.log(`  Warning: ${scrollResult.message}`);
    }

    // Scroll back to top and wait for stability
    await frame.evaluate(() => {
      const scrollableElement = document.querySelector('.bodyCells') 
        || document.querySelector('[class*="scroll"]')
        || document.querySelector('.pivotTable')
        || document.body;
      scrollableElement.scrollTop = 0;
    });
    
    console.log("\n✓ Scrolled back to top, waiting for stability...");
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
