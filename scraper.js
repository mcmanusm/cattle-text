// ============================================================
// scrape_text_metrics_diagnostic.js
// PATCHED OG VERSION – National default + junk skip
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
      line.includes("Scroll")
    );
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

    const rawText = await frame.evaluate(() => document.body.innerText);

    const lines = rawText
      .split("\n")
      .map(l => clean(l))
      .filter(Boolean);

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

    // ✅ DEFAULT TO NATIONAL
    let currentState = "National";
    let stateBucket = null;

    for (let i = 0; i < lines.length; i++) {
      const label = extractLabel(lines[i]);

      if (stateKeys.includes(label)) {
        if (stateBucket && currentState !== "National") {
          output.states.push(stateBucket);
        }

        currentState = stateMap[label];
        stateBucket = currentState === "National"
          ? null
          : { state: currentState, categories: [] };

        continue;
      }

      if (categories.includes(label)) {
        const metrics = parseMetrics(i);
        const payload = { category: label, ...metrics };

        if (currentState === "National") {
          output.national.push(payload);
        } else if (stateBucket) {
          stateBucket.categories.push(payload);
        }
      }
    }

    if (stateBucket && currentState !== "National") {
      output.states.push(stateBucket);
    }

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

    await browser.close();

  } catch (err) {
    console.error("❌ ERROR:", err);
    await browser.close();
    process.exit(1);
  }

})();
