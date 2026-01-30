// ============================================================
// scrape_national_v2.js
// Improved scraper with flexible pattern matching
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

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    
    console.log("Loading page...");
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("iframe", { timeout: 30000 });
    
    console.log("Waiting for Power BI to fully load (20 seconds)...");
    await new Promise(r => setTimeout(r, 20000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) {
      throw new Error("Power BI iframe not found");
    }

    console.log("Power BI iframe found, extracting data...\n");

    // Extract all text
    const rawText = await frame.evaluate(() => document.body.innerText);
    
    // Clean and split into lines
    const allLines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(l => l.length > 0);

    // Save for debugging
    fs.writeFileSync("debug_all_text.txt", rawText);
    fs.writeFileSync("debug_clean_lines.txt", allLines.join("\n"));
    fs.writeFileSync(
      "debug_numbered.txt",
      allLines.map((l, i) => `${i}: ${l}`).join("\n")
    );

    console.log(`Total lines extracted: ${allLines.length}\n`);

    // Define all possible categories (both exact and variations)
    const categoryPatterns = [
      // Steers
      { pattern: /^Steers?\s*0\s*-?\s*200\s*kg?$/i, name: "Steers 0-200kg" },
      { pattern: /^Steers?\s*200\.?1?\s*-?\s*280\s*kg?$/i, name: "Steers 200.1-280kg" },
      { pattern: /^Steers?\s*280\.?1?\s*-?\s*330\s*kg?$/i, name: "Steers 280.1-330kg" },
      { pattern: /^Steers?\s*330\.?1?\s*-?\s*400\s*kg?$/i, name: "Steers 330.1-400kg" },
      { pattern: /^Steers?\s*400\s*kg?\s*\+?$/i, name: "Steers 400kg +" },
      
      // Heifers
      { pattern: /^Heifers?\s*0\s*-?\s*200\s*kg?$/i, name: "Heifers 0-200kg" },
      { pattern: /^Heifers?\s*200\.?1?\s*-?\s*280\s*kg?$/i, name: "Heifers 200.1-280kg" },
      { pattern: /^Heifers?\s*280\.?1?\s*-?\s*330\s*kg?$/i, name: "Heifers 280.1-330kg" },
      { pattern: /^Heifers?\s*330\.?1?\s*-?\s*400\s*kg?$/i, name: "Heifers 330.1-400kg" },
      { pattern: /^Heifers?\s*400\s*kg?\s*\+?$/i, name: "Heifers 400kg +" },
      
      // Breeding stock
      { pattern: /^NSM\s*Cows?$/i, name: "NSM Cows" },
      { pattern: /^SM\s*Heifers?$/i, name: "SM Heifers" },
      { pattern: /^SM\s*Cows?$/i, name: "SM Cows" },
      { pattern: /^PTIC\s*Heifers?$/i, name: "PTIC Heifers" },
      { pattern: /^PTIC\s*Cows?$/i, name: "PTIC Cows" },
      { pattern: /^NSM\s*Heifers?\s*&\s*Calves?$/i, name: "NSM Heifers & Calves" },
      { pattern: /^NSM\s*Cows?\s*&\s*Calves?$/i, name: "NSM Cows & Calves" },
      { pattern: /^SM\s*Heifers?\s*&\s*Calves?$/i, name: "SM Heifers & Calves" },
      { pattern: /^SM\s*Cows?\s*&\s*Calves?$/i, name: "SM Cows & Calves" },
      { pattern: /^PTIC\s*Heifers?\s*&\s*Calves?$/i, name: "PTIC Heifers & Calves" },
      { pattern: /^PTIC\s*Cows?\s*&\s*Calves?$/i, name: "PTIC Cows & Calves" },
      { pattern: /^Mixed\s*Sexes?$/i, name: "Mixed Sexes" }
    ];

    function matchCategory(line) {
      for (const cat of categoryPatterns) {
        if (cat.pattern.test(line)) {
          return cat.name;
        }
      }
      return null;
    }

    function getStockCategory(categoryName) {
      if (categoryName.startsWith("Steers")) return "Steers";
      if (categoryName.startsWith("Heifers")) return "Heifers";
      return "Breeding Stock";
    }

    // State labels to know when we've left National data
    const statePatterns = /^(NSW|QLD|SA|Tas|VIC|Vic|WA|NT)$/;

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

    function parseMetrics(startIndex) {
      const metrics = {};
      let cursor = 0;
      
      for (let i = startIndex + 1; i < allLines.length && cursor < metricKeys.length; i++) {
        const line = allLines[i];
        
        // Stop if we hit another category or state
        if (matchCategory(line) || statePatterns.test(line)) {
          break;
        }
        
        // Skip obvious junk
        if (
          line.length > 100 ||
          line.includes("Additional Conditional") ||
          line.includes("Press Enter") ||
          line.includes("Scroll") ||
          line.includes("Applied filters") ||
          line.includes("Species is") ||
          line.includes("Date ")
        ) {
          continue;
        }
        
        metrics[metricKeys[cursor]] = line;
        cursor++;
      }
      
      return metrics;
    }

    const output = {
      updated_at: new Date().toISOString(),
      market: "National",
      categories: []
    };

    let inNationalSection = true;
    let foundCategories = 0;

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];

      // Check if we've hit a state (means we've left National)
      if (statePatterns.test(line)) {
        console.log(`\nStopped at state marker: ${line}`);
        inNationalSection = false;
        break;
      }

      // Look for category match
      const categoryName = matchCategory(line);
      if (categoryName && inNationalSection) {
        const metrics = parseMetrics(i);
        
        const payload = {
          stock_category: getStockCategory(categoryName),
          category: categoryName,
          ...metrics
        };

        output.categories.push(payload);
        foundCategories++;
        console.log(`✓ Found: ${categoryName} (${Object.keys(metrics).length} metrics)`);
      }
    }

    console.log(`\n✓ Scrape complete`);
    console.log(`  Categories found: ${foundCategories}`);

    if (foundCategories === 0) {
      console.warn("\n⚠ WARNING: No categories found!");
      console.warn("Check debug_all_text.txt and debug_numbered.txt to see what was extracted.");
    }

    // Save output
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`\nOutput saved to: ${outputFile}`);

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error("✗ Scraping failed:", error);
    await browser.close();
    process.exit(1);
  }
})();
