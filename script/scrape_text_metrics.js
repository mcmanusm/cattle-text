// ============================================================
// scrape_national_table.js
// Extract ONLY National data from Power BI table
// Based on your original working script
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "national-cattle-prices.json";

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log("Loading page...");
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    console.log("Waiting for Power BI iframe...");
    await page.waitForSelector("iframe", { timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const frames = await page.frames();
    const powerBIFrame = frames.find(f => 
      f.url().includes("powerbi") || f.name().includes("powerbi")
    );

    if (!powerBIFrame) {
      throw new Error("Power BI iframe not found");
    }

    console.log("✓ Power BI iframe found");
    console.log("Waiting for table to load...");
    
    await powerBIFrame.waitForSelector('[role="grid"]', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log("Scrolling and collecting data...\n");

    // Scroll and collect all table rows
    const allRows = await powerBIFrame.evaluate(async () => {
      const scrollableContainers = document.querySelectorAll(
        ".scrollable-cells-viewport, .scrollRegion, [role='grid']"
      );
      
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const collectedRows = new Map();
      let previousSize = 0;
      let unchangedCount = 0;

      // Function to collect visible rows
      const collectVisibleRows = () => {
        const rows = document.querySelectorAll('[role="row"]');
        
        rows.forEach((row) => {
          const cells = row.querySelectorAll('[role="gridcell"], [role="columnheader"]');
          if (cells.length === 0) return;
          
          const cellTexts = Array.from(cells).map(c => c.textContent.trim());
          const rowKey = cellTexts.join("|");
          
          if (!collectedRows.has(rowKey) && cellTexts.some(c => c.length > 0)) {
            collectedRows.set(rowKey, cellTexts);
          }
        });
      };

      // Initial collection
      collectVisibleRows();

      // Scroll through each container
      for (const container of scrollableContainers) {
        let scrollPosition = 0;
        const maxScroll = container.scrollHeight;
        const scrollStep = 100;

        while (scrollPosition < maxScroll) {
          container.scrollTop = scrollPosition;
          await sleep(200);
          collectVisibleRows();
          
          scrollPosition += scrollStep;
          
          if (collectedRows.size === previousSize) {
            unchangedCount++;
            if (unchangedCount > 5) break;
          } else {
            unchangedCount = 0;
            previousSize = collectedRows.size;
          }
        }
      }

      console.log(`Collected ${collectedRows.size} unique rows`);
      return Array.from(collectedRows.values());
    });

    console.log(`Total unique rows collected: ${allRows.length}\n`);

    // Save raw rows for debugging
    fs.writeFileSync(
      "debug_raw_rows.json",
      JSON.stringify(allRows, null, 2)
    );

    // Process rows - looking for National data only
    const nationalData = [];
    const stateHeaders = ["NSW", "QLD", "VIC", "SA", "Tas", "WA", "NT"];
    
    let inNationalSection = true;

    for (const cells of allRows) {
      if (cells.length === 0) continue;
      
      const firstCell = cells[0];
      
      // Check if we hit a state header (means we're leaving National section)
      if (stateHeaders.includes(firstCell)) {
        console.log(`Stopped at state: ${firstCell}`);
        inNationalSection = false;
        break;
      }

      // Skip if not in National section
      if (!inNationalSection) continue;

      // Look for category rows (Steers, Heifers, breeding stock)
      const isCategoryRow = /steers|heifers|nsm|sm|ptic|mixed/i.test(firstCell);
      
      if (isCategoryRow && cells.length >= 10) {
        // This is a data row - extract it
        const category = cells[0] || "";
        
        // Determine stock category
        let stockCategory = "Breeding Stock";
        if (category.toLowerCase().includes("steers")) {
          stockCategory = "Steers";
        } else if (category.toLowerCase().includes("heifers") && 
                   !category.toLowerCase().includes("ptic") && 
                   !category.toLowerCase().includes("sm") && 
                   !category.toLowerCase().includes("nsm")) {
          stockCategory = "Heifers";
        }

        const row = {
          stock_category: stockCategory,
          category: category,
          offered: cells[2] || cells[1] || "",
          weight_range: cells[3] || cells[2] || "",
          avg_weight: cells[4] || cells[3] || "",
          dollar_head_range: cells[5] || cells[4] || "",
          avg_dollar_head: cells[6] || cells[5] || "",
          dollar_change: cells[7] || cells[6] || "",
          c_kg_range: cells[8] || cells[7] || "",
          avg_c_kg: cells[9] || cells[8] || "",
          c_kg_change: cells[10] || cells[9] || "",
          clearance: cells[11] || cells[10] || ""
        };

        nationalData.push(row);
        console.log(`✓ National: ${category}`);
      }
    }

    // Create output
    const output = {
      updated_at: new Date().toISOString(),
      market: "National",
      categories: nationalData
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Scrape complete");
    console.log(`  Categories captured: ${nationalData.length}`);
    console.log(`\nOutput saved to: ${outputFile}`);

    if (nationalData.length === 0) {
      console.warn("\n⚠ Warning: No national data found!");
      console.warn("Check debug_raw_rows.json to see what was extracted.");
    }

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error("✗ Scraping failed:", error);
    await browser.close();
    process.exit(1);
  }
})();
