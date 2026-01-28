// ============================================================
// scrape_text_metrics.js
// Power BI Cattle Market Weekly Averages
// National + State → Category → Metrics
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

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(Boolean);

    console.log(`→ Lines extracted: ${lines.length}`);

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
    // METRIC PARSER (FIXED)
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
    // Main Parse Loop
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
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
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

    // Push final state bucket
    if (stateBucket && currentState !== "National") {
      output.states.push(stateBucket);
    }

    // ----------------------------------------------------------
    // Write Output
    // ----------------------------------------------------------

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log("✓ Metrics captured successfully");
    console.log(`  National categories: ${output.national.length}`);
    console.log(
      `  State categories: ${output.states.reduce((s, x) => s + x.categories.length, 0)}`
    );

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    await browser.close();
    process.exit(1);
  }

})();
