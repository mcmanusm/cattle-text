// ============================================================
// scrape_text_metrics.js
// National + State → Category → Metrics (ROBUST VERSION)
// ============================================================

const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {

  const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
  const outputFile = "text-metrics.json";

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector("iframe");
    await new Promise(r => setTimeout(r, 15000));

    const frame = page.frames().find(f => f.url().includes("powerbi.com"));
    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    // ----------------------------------------------------------
    // Definitions
    // ----------------------------------------------------------

    const states = ["National", "NSW", "QLD", "SA", "Tas", "Vic", "WA", "NT"];

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

    // ----------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------

    function isStopLine(line) {
      return states.includes(line) || categories.includes(line);
    }

    function parseMetrics(startIndex) {
      const metrics = {};
      let metricCursor = 0;

      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];

        if (isStopLine(line)) break;
        if (metricCursor >= metricKeys.length) break;

        metrics[metricKeys[metricCursor]] = line;
        metricCursor++;
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
      const line = lines[i];

      // ---------- STATE ----------
      if (states.includes(line)) {
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
        }

        currentState = line;

        if (line === "National") {
          stateBucket = null;
        } else {
          stateBucket = {
            state: line,
            categories: []
          };
        }

        continue;
      }

      // ---------- CATEGORY ----------
      if (categories.includes(line)) {
        const metrics = parseMetrics(i);

        const categoryPayload = {
          category: line,
          ...metrics
        };

        if (currentState === "National") {
          output.national.push(categoryPayload);
        } else if (stateBucket) {
          stateBucket.categories.push(categoryPayload);
        }
      }
    }

    // push last state
    if (stateBucket && currentState !== "National") {
      output.states.push(stateBucket);
    }

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log("✓ Metrics captured successfully");
    console.log(`  National categories: ${output.national.length}`);
    console.log(
      `  State categories: ${output.states.reduce((s, x) => s + x.categories.length, 0)}`
    );

    await browser.close();

  } catch (err) {
    console.error("❌ Error:", err);
    await browser.close();
    process.exit(1);
  }

})();
