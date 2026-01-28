// ============================================================
// scrape_text_metrics.js - Cattle Market Weekly Averages Scraper
// PRODUCTION VERSION
// ============================================================

const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {

    // --------------------------------------------------------
    // CONFIGURATION
    // --------------------------------------------------------

    const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";

    // --------------------------------------------------------
    // LOAD PREVIOUS METRICS
    // --------------------------------------------------------

    let previousMetrics = null;
    const outputFile = "text-metrics.json";

    if (fs.existsSync(outputFile)) {
        try {
            previousMetrics = JSON.parse(fs.readFileSync(outputFile, "utf8"));
            console.log("✓ Loaded previous metrics for comparison");
        } catch (e) {
            console.log("⚠️  Previous metrics file exists but couldn't be parsed");
        }
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
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(90000);

        console.log("→ Navigating to:", url);
        await page.goto(url, { waitUntil: "networkidle2" });
        console.log("✓ Page loaded");

        // --------------------------------------------------------
        // WAIT FOR IFRAME
        // --------------------------------------------------------

        console.log("→ Waiting for iframe...");
        await page.waitForSelector("iframe", { timeout: 30000 });
        console.log("✓ Iframe found");

        await new Promise(r => setTimeout(r, 5000));

        // --------------------------------------------------------
        // GET POWER BI FRAME
        // --------------------------------------------------------

        const frames = await page.frames();
        console.log(`→ Found ${frames.length} frames`);

        let powerBIFrame = frames.find(f => f.url().includes('powerbi.com'));
        if (!powerBIFrame && frames.length > 1) {
            powerBIFrame = frames[1];
        }

        if (!powerBIFrame) {
            throw new Error("Could not find Power BI frame");
        }

        // --------------------------------------------------------
        // WAIT FOR POWER BI TO RENDER
        // --------------------------------------------------------

        console.log("→ Waiting 20 seconds for Power BI to render...");
        await new Promise(r => setTimeout(r, 20000));

        // --------------------------------------------------------
        // EXTRACT TEXT
        // --------------------------------------------------------

        console.log("→ Extracting text...");
        const allText = await powerBIFrame.evaluate(() => document.body.innerText);

        const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
        console.log(`→ Found ${lines.length} non-empty lines`);

        // --------------------------------------------------------
        // FIND DATE
        // --------------------------------------------------------

        const dateLine = lines.find(l => l.includes("January 2026") || l.includes("2026"));
        console.log("→ Report date:", dateLine || "Not found");

        // --------------------------------------------------------
        // PARSE CATTLE CATEGORIES
        // --------------------------------------------------------

        const categories = [];
        const categoryPattern = /^(Steers|Heifers)\s+[\d\.]+-?[\d\.]*k?g?\+?$/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (categoryPattern.test(line)) {
                console.log(`\n→ Found category: ${line}`);
                
                // The next several lines should contain the data
                // Based on the structure: Offered, Weight Range, Avg Weight, $/Head Range, Avg, Change, c/kg Range, Avg, Change, Clearance
                
                const category = {
                    category: line,
                    offered: null,
                    weight_range: null,
                    avg_weight: null,
                    dollar_head_range: null,
                    avg_dollar_head: null,
                    dollar_change: null,
                    c_kg_range: null,
                    avg_c_kg: null,
                    c_kg_change: null,
                    clearance: null
                };
                
                // Look ahead for numeric values
                let dataIndex = 0;
                for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                    const value = lines[j];
                    
                    // Skip non-data lines
                    if (value.includes("Additional Conditional Formatting") ||
                        value.includes("Scroll") ||
                        value.includes("Range") ||
                        value === "Change" ||
                        value === "Avg" ||
                        value === "Offered" ||
                        value === "Clearance") {
                        continue;
                    }
                    
                    // Stop if we hit another category
                    if (categoryPattern.test(value)) {
                        break;
                    }
                    
                    // Assign values in order
                    if (dataIndex === 0) category.offered = value;
                    else if (dataIndex === 1) category.weight_range = value;
                    else if (dataIndex === 2) category.avg_weight = value;
                    else if (dataIndex === 3) category.dollar_head_range = value;
                    else if (dataIndex === 4) category.avg_dollar_head = value;
                    else if (dataIndex === 5) category.dollar_change = value;
                    else if (dataIndex === 6) category.c_kg_range = value;
                    else if (dataIndex === 7) category.avg_c_kg = value;
                    else if (dataIndex === 8) category.c_kg_change = value;
                    else if (dataIndex === 9) {
                        category.clearance = value;
                        break; // We have all the data
                    }
                    
                    dataIndex++;
                }
                
                console.log("  Data:", JSON.stringify(category, null, 2));
                categories.push(category);
            }
        }

        console.log(`\n→ Parsed ${categories.length} categories`);

        // --------------------------------------------------------
        // BUILD METRICS OBJECT
        // --------------------------------------------------------

        const metrics = {
            updated_at: new Date().toISOString(),
            report_date: dateLine || "Unknown",
            categories: categories,
            summary: {
                total_categories: categories.length,
                steers_count: categories.filter(c => c.category.toLowerCase().includes('steers')).length,
                heifers_count: categories.filter(c => c.category.toLowerCase().includes('heifers')).length
            }
        };

        console.log("\n✓ FINAL METRICS:");
        console.log(JSON.stringify(metrics, null, 2));

        // --------------------------------------------------------
        // CHANGE DETECTION
        // --------------------------------------------------------

        if (previousMetrics && 
            JSON.stringify(previousMetrics.categories) === JSON.stringify(metrics.categories)) {
            console.log("\n→ No changes detected");
        } else {
            console.log("\n→ Changes detected, writing file");
        }

        // --------------------------------------------------------
        // WRITE OUTPUT
        // --------------------------------------------------------

        fs.writeFileSync(outputFile, JSON.stringify(metrics, null, 2));
        console.log(`✓ Written to ${outputFile}`);

        await browser.close();
        console.log("✓ Scrape completed successfully");

    } catch (error) {
        console.error("\n❌ ERROR:");
        console.error(error.message);
        console.error(error.stack);
        
        await browser.close();
        process.exit(1);
    }

})();
