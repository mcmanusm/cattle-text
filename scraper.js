// ============================================================
// scrape_text_metrics_diagnostic.js
// DIAGNOSTIC VERSION - Extra logging to debug parsing issues
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
    
    // Scrolling attempts
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

    await new Promise(r => setTimeout(r, 3000));

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(Boolean);

    console.log(`→ Lines extracted: ${lines.length}`);

    // Save raw lines with line numbers
    const debugContent = lines.map((line, idx) => `${idx}: ${line}`).join("\n");
    fs.writeFileSync("debug_lines_numbered.txt", debugContent);
    console.log("→ Debug lines saved to debug_lines_numbered.txt");

    // ----------------------------------------------------------
    // Definitions
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
    // DIAGNOSTIC: Find all state occurrences
    // ----------------------------------------------------------
    console.log("\n→ DIAGNOSTIC: Searching for all state mentions...");
    lines.forEach((line, idx) => {
      const label = extractLabel(line);
      if (stateKeys.includes(label)) {
        console.log(`  Line ${idx}: "${line}" → Recognized as: ${stateMap[label]}`);
        // Show next 5 lines
        console.log(`    Next lines:`);
        for (let j = 1; j <= 5 && idx + j < lines.length; j++) {
          console.log(`      ${idx + j}: ${lines[idx + j]}`);
        }
      }
    });

    // ----------------------------------------------------------
    // DIAGNOSTIC: Find all category occurrences
    // ----------------------------------------------------------
    console.log("\n→ DIAGNOSTIC: Searching for category mentions after each state...");
    let lastState = null;
    let lastStateIndex = -1;
    
    lines.forEach((line, idx) => {
      const label = extractLabel(line);
      
      if (stateKeys.includes(label)) {
        lastState = stateMap[label];
        lastStateIndex = idx;
      }
      
      if (categories.includes(label)) {
        console.log(`  Line ${idx}: "${line}" under state: ${lastState} (state was at line ${lastStateIndex})`);
      }
    });

    // ----------------------------------------------------------
    // METRIC PARSER
    // ----------------------------------------------------------

    function parseMetrics(startIndex) {
      const metrics = {};
      let cursor = 0;

      console.log(`    Parsing metrics starting at line ${startIndex + 1}:`);

      for (let i = startIndex + 1; i < lines.length; i++) {
        const value = lines[i];

        if (isStopLine(value)) {
          console.log(`    Stopped at line ${i}: "${value}" (stop line detected)`);
          break;
        }
        
        if (isJunkLine(value)) {
          console.log(`    Skipped line ${i}: "${value}" (junk)`);
          continue;
        }
        
        if (cursor >= metricKeys.length) {
          console.log(`    Stopped at line ${i}: all metrics collected`);
          break;
        }

        metrics[metricKeys[cursor]] = value;
        console.log(`      [${cursor}] ${metricKeys[cursor]} = "${value}"`);
        cursor++;
      }

      return metrics;
    }

    // ----------------------------------------------------------
    // Main Parse Loop
    // ----------------------------------------------------------

    const output = {
      updated_at: new Date().toISOString(),
      national: [],
      states: []
    };

    let currentState = null;
    let stateBucket = null;

    console.log("\n→ Starting main parse loop...\n");

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const label = extractLabel(rawLine);

      // ---------- STATE ----------
      if (stateKeys.includes(label)) {
        // Save previous state bucket before starting new one
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
          console.log(`✓ Saved ${currentState}: ${stateBucket.categories.length} categories\n`);
        }

        currentState = stateMap[label];
        console.log(`\n→ Line ${i}: Found state: ${currentState}`);

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
        console.log(`\n→ Line ${i}: Found category: ${label} (current state: ${currentState})`);
        const metrics = parseMetrics(i);

        const categoryPayload = {
          category: label,
          ...metrics
        };

        if (currentState === "National") {
          output.national.push(categoryPayload);
          console.log(`  Added to National`);
        } else if (stateBucket) {
          stateBucket.categories.push(categoryPayload);
          console.log(`  Added to ${currentState}`);
        } else {
          console.log(`  WARNING: No state bucket! Category orphaned.`);
        }
      }
    }

    // Push final state bucket
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

    const missingStates = ["NSW", "QLD", "SA", "Tas", "Vic", "WA", "NT"].filter(
      s => !output.states.some(state => state.state === s && state.categories.length > 0)
    );
    
    if (missingStates.length > 0) {
      console.log(`\n⚠️  States with no categories: ${missingStates.join(", ")}`);
      console.log(`  Check debug_lines_numbered.txt to see the raw extracted text`);
    }

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    console.error(err.stack);
    await browser.close();
    process.exit(1);
  }

})();
