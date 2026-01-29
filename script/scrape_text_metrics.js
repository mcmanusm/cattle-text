// ============================================================
// scrape_text_metrics.js
// Power BI Cattle Market Weekly Averages
// National + State → Category → Metrics
// UPDATED: Advanced scrolling + interaction to load all states
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

  // Removes Power BI row counts e.g. "National 50" → "National"
  function extractLabel(line) {
    return line.replace(/\s+\d+$/, "").trim();
  }

  // Power BI accessibility / formatting junk
  function isJunkLine(line) {
    return (
      line === "Additional Conditional Formatting" ||
      line.includes("Press Enter") ||
      line.includes("Scroll")
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

    console.log("→ Navigating...");
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    if (!frame) throw new Error("Power BI iframe not found");

    console.log("→ Attempting to load all state data...");
    
    // STRATEGY 1: Look for and click "State" filter to ensure "All" is selected
    try {
      console.log("  → Checking for State filter...");
      const stateFilter = await frame.$('div[aria-label*="State"]');
      if (stateFilter) {
        console.log("  → Found State filter, clicking...");
        await stateFilter.click();
        await new Promise(r => setTimeout(r, 1000));
        
        // Look for "All" option and click it
        const allOption = await frame.$('div[title="All"], div[aria-label="All"]');
        if (allOption) {
          console.log("  → Clicking 'All' option...");
          await allOption.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (e) {
      console.log("  → No interactive filter found, continuing...");
    }

    // STRATEGY 2: Aggressive scrolling through the Power BI visual
    console.log("  → Scrolling through data...");
    
    // Find the visual container
    const scrollAttempts = await frame.evaluate(() => {
      let attempts = 0;
      
      // Find all possible scrollable containers
      const selectors = [
        'div[class*="pivotTable"]',
        'div[role="grid"]',
        'div[class*="bodyCells"]',
        'div[class*="scroll"]',
        'div.visualContainer',
        '.scrollRegion'
      ];

      let scrolled = false;
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el.scrollHeight > el.clientHeight) {
            attempts++;
            // Scroll to bottom
            el.scrollTop = el.scrollHeight;
            scrolled = true;
          }
        });
      }

      return { attempts, scrolled };
    });

    console.log(`  → Found ${scrollAttempts.attempts} scrollable elements`);
    
    // Wait for content to load after scroll
    await new Promise(r => setTimeout(r, 5000));

    // STRATEGY 3: Multiple incremental scrolls
    console.log("  → Performing incremental scrolls...");
    for (let i = 0; i < 15; i++) {
      await frame.evaluate((step) => {
        const containers = document.querySelectorAll(
          'div[role="grid"], div[class*="pivotTable"], div[class*="scroll"], div.visualContainer'
        );
        
        containers.forEach(el => {
          if (el.scrollHeight > el.clientHeight) {
            el.scrollTop = (el.scrollHeight / 15) * step;
          }
        });
      }, i);
      
      await new Promise(r => setTimeout(r, 800));
    }

    console.log("  → Final wait for rendering...");
    await new Promise(r => setTimeout(r, 3000));

    // STRATEGY 4: Scroll back to top to capture everything
    await frame.evaluate(() => {
      const containers = document.querySelectorAll(
        'div[role="grid"], div[class*="pivotTable"], div[class*="scroll"], div.visualContainer'
      );
      containers.forEach(el => {
        el.scrollTop = 0;
      });
      window.scrollTo(0, 0);
    });

    await new Promise(r => setTimeout(r, 2000));

    // Extract the text
    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(Boolean);

    console.log(`→ Lines extracted: ${lines.length}`);

    // DEBUG: Save raw lines to file for inspection
    fs.writeFileSync("debug_lines.txt", lines.join("\n"));
    console.log("→ Debug lines saved to debug_lines.txt");

    // ----------------------------------------------------------
    // Definitions - UPDATED with all categories
    // ----------------------------------------------------------

    const stateMap = {
      "National": "National",
      "NSW": "NSW",
      "QLD": "QLD",
      "SA": "SA",
      "Tas": "Tas",
      "Vic": "Vic",
      "WA": "WA",
      "NT": "NT",
      "New South Wales": "NSW",
      "Queensland": "QLD",
      "South Australia": "SA",
      "Tasmania": "Tas",
      "Victoria": "Vic",
      "Western Australia": "WA",
      "Northern Territory": "NT"
    };

    const stateKeys = Object.keys(stateMap);

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

    function isStopLine(line) {
      const label = extractLabel(line);
      return stateKeys.includes(label) || categories.includes(label);
    }

    // ----------------------------------------------------------
    // METRIC PARSER
    // ----------------------------------------------------------

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
    // Main Parse Loop - IMPROVED
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    let currentState = null;
    let stateBucket = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const label = extractLabel(rawLine);

      // ---------- STATE ----------
      if (stateKeys.includes(label)) {
        // Save previous state bucket before starting new one
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
          console.log(`✓ Saved ${currentState}: ${stateBucket.categories.length} categories`);
        }

        currentState = stateMap[label];
        console.log(`→ Found state: ${currentState}`);

        if (currentState === "National") {
          stateBucket = null;
        } else {
          stateBucket = {
            state: currentState,
            categories: []
          };
        }
        continue;
      }

      // ---------- CATEGORY ----------
      if (categories.includes(label)) {
        const metrics = parseMetrics(i);

        const categoryPayload = {
          category: label,
          ...metrics
        };

        if (currentState === "National") {
          output.national.push(categoryPayload);
        } else if (stateBucket) {
          stateBucket.categories.push(categoryPayload);
        }
      }
    }

    // Push final state bucket (important for last state)
    if (stateBucket && currentState !== "National") {
      output.states.push(stateBucket);
      console.log(`✓ Saved ${currentState}: ${stateBucket.categories.length} categories`);
    }

    // ----------------------------------------------------------
    // Write Output
    // ----------------------------------------------------------

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("\n✓ Metrics captured successfully");
    console.log(`  National categories: ${output.national.length}`);
    console.log(`  States found: ${output.states.length}`);
    
    output.states.forEach(state => {
      console.log(`    - ${state.state}: ${state.categories.length} categories`);
    });
    
    console.log(
      `  Total state categories: ${output.states.reduce((s, x) => s + x.categories.length, 0)}`
    );

    // Show which states are missing
    const foundStates = output.states.map(s => s.state);
    const expectedStates = ["NSW", "QLD", "SA", "Tas", "Vic", "WA", "NT"];
    const missingStates = expectedStates.filter(s => !foundStates.includes(s));
    
    if (missingStates.length > 0) {
      console.log(`\n⚠️  Missing states: ${missingStates.join(", ")}`);
      console.log(`  Check debug_lines.txt to see what was captured`);
    }

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    console.error(err.stack);
    await browser.close();
    process.exit(1);
  }

})();
