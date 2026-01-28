// ============================================================
// puppeteer_scrape.js - IMPROVED VERSION WITH BETTER DEBUGGING
// ============================================================

const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {

    // --------------------------------------------------------
    // CONFIGURATION
    // --------------------------------------------------------

    const url = "https://mcmanusm.github.io/Cattle_Comments/table.html";

    // --------------------------------------------------------
    // LOAD PREVIOUS METRICS
    // --------------------------------------------------------

    let previousMetrics = null;
    const outputFile = "metrics.json";

    if (fs.existsSync(outputFile)) {
        previousMetrics = JSON.parse(fs.readFileSync(outputFile, "utf8"));
        console.log("✓ Loaded previous metrics for comparison");
    } else {
        console.log("ℹ No previous metrics file found");
    }

    // --------------------------------------------------------
    // LAUNCH HEADLESS BROWSER
    // --------------------------------------------------------

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ]
    });

    const page = await browser.newPage();

    // Set a longer timeout for slow-loading Power BI content
    page.setDefaultTimeout(60000); // 60 seconds

    console.log("→ Navigating to:", url);
    await page.goto(url, { waitUntil: "networkidle2" });

    // --------------------------------------------------------
    // WAIT FOR POWER BI IFRAME
    // --------------------------------------------------------

    console.log("→ Waiting for Power BI iframe...");
    await page.waitForSelector("#pbiTable", { timeout: 30000 });
    console.log("✓ Iframe found");

    // --------------------------------------------------------
    // SWITCH INTO IFRAME
    // --------------------------------------------------------

    const frameHandle = await page.$("#pbiTable");
    const frame = await frameHandle.contentFrame();

    // --------------------------------------------------------
    // WAIT FOR POWER BI TO FULLY RENDER
    // --------------------------------------------------------

    console.log("→ Waiting for Power BI content to render (15 seconds)...");
    await new Promise(r => setTimeout(r, 15000));

    // --------------------------------------------------------
    // EXTRACT ALL TEXT
    // --------------------------------------------------------

    const allText = await frame.evaluate(() => document.body.innerText);

    console.log("=== RAW SCRAPED TEXT START ===");
    console.log(allText);
    console.log("=== RAW SCRAPED TEXT END ===");

    // --------------------------------------------------------
    // PARSE LINES
    // --------------------------------------------------------

    const lines = allText
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    console.log(`\n→ Found ${lines.length} non-empty lines`);

    // --------------------------------------------------------
    // COUNT "Select Row" MARKERS
    // --------------------------------------------------------

    const selectRowCount = lines.filter(l => l === "Select Row").length;
    console.log(`→ Found ${selectRowCount} "Select Row" markers`);

    // --------------------------------------------------------
    // PARSE TABLE ROWS
    // --------------------------------------------------------

    const rows = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === "Select Row") {
            const block = lines.slice(i, i + 11);

            // Show what we're parsing for each row
            console.log(`\n→ Parsing row ${rows.length + 1}:`);
            console.log("  Block:", block.slice(0, 3).join(" | "));

            const row = {
                index: block[1],
                total_head: block[2].replace(/[^\d-]/g, ""),
                clearance_rate: block[3].replace(/[^\d-]/g, ""),
                amount_over_reserve: block[4].replace(/[^\d-]/g, ""),
                ayci_dw: block[5].replace(/[^\d-]/g, ""),
                ayci_change: block[6].replace(/[^\d-]/g, ""),
                total_head_change: block[7].replace(/[^\d-]/g, ""),
                clearance_rate_change: block[8].replace(/[^\d-]/g, ""),
                vor_change: block[9].replace(/[^\d-]/g, "")
            };

            rows.push(row);
        }
    }

    console.log(`\n→ Successfully parsed ${rows.length} rows`);

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (rows.length === 0) {
        console.error("\n❌ ERROR: No rows found!");
        console.error("This usually means:");
        console.error("  1. Power BI content didn't fully load");
        console.error("  2. The table structure has changed");
        console.error("  3. The iframe is empty or showing an error");
        console.error("\nCheck the raw scraped text above for clues.");
        
        await browser.close();
        process.exit(1);
    }

    if (rows.length !== 4) {
        console.error(`\n⚠️  WARNING: Expected 4 rows but found ${rows.length}`);
        console.error("Proceeding anyway, but verify the data is correct.");
    }

    // --------------------------------------------------------
    // BUILD METRICS OBJECT
    // --------------------------------------------------------

    const metrics = {
        updated_at: new Date().toISOString(),
        this_week: rows[0] || null,
        last_week: rows[1] || null,
        two_weeks_ago: rows[2] || null,
        three_weeks_ago: rows[3] || null
    };

    console.log("\n✓ FINAL METRICS:");
    console.log(JSON.stringify(metrics, null, 2));

    // --------------------------------------------------------
    // CHANGE DETECTION
    // --------------------------------------------------------

    if (
        previousMetrics &&
        JSON.stringify(previousMetrics) === JSON.stringify(metrics)
    ) {
        console.log("\n→ No metric changes detected; skipping file write");
        await browser.close();
        return;
    }

    console.log("\n→ Metric changes detected; writing updated file");

    // --------------------------------------------------------
    // WRITE OUTPUT
    // --------------------------------------------------------

    fs.writeFileSync(
        outputFile,
        JSON.stringify(metrics, null, 2)
    );

    console.log(`✓ Written to ${outputFile}`);

    // --------------------------------------------------------
    // CLEANUP
    // --------------------------------------------------------

    await browser.close();
    console.log("✓ Scrape completed successfully");

})();
