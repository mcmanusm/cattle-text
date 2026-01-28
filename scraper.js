// ============================================================
// scrape_text_metrics.js - Cattle Market Weekly Averages Scraper
// IMPROVED WITH BETTER IFRAME DETECTION
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
        // DEBUG: CHECK PAGE CONTENT
        // --------------------------------------------------------

        console.log("→ Checking page content...");
        
        const pageHTML = await page.content();
        console.log("→ Page HTML length:", pageHTML.length);
        
        // Check for iframes
        const iframeCount = await page.evaluate(() => {
            return document.querySelectorAll('iframe').length;
        });
        console.log(`→ Found ${iframeCount} iframe(s) on page`);

        if (iframeCount === 0) {
            console.error("❌ No iframes found on page!");
            console.log("→ Page title:", await page.title());
            console.log("→ Checking for Power BI elements...");
            
            const hasPowerBI = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes('Power BI') || bodyText.includes('powerbi');
            });
            
            console.log("→ Has Power BI references:", hasPowerBI);
            
            await browser.close();
            process.exit(1);
        }

        // --------------------------------------------------------
        // WAIT FOR IFRAME
        // --------------------------------------------------------

        console.log("→ Waiting for iframe to load...");
        await page.waitForSelector("iframe", { timeout: 30000 });
        console.log("✓ Iframe found");

        // Wait a bit for iframe to fully load
        await new Promise(r => setTimeout(r, 5000));

        // --------------------------------------------------------
        // GET ALL FRAMES
        // --------------------------------------------------------

        const frames = await page.frames();
        console.log(`→ Found ${frames.length} frames total`);

        // Try to find Power BI frame
        let powerBIFrame = null;
        
        for (let i = 0; i < frames.length; i++) {
            const frameUrl = frames[i].url();
            console.log(`  Frame ${i}: ${frameUrl.substring(0, 100)}...`);
            
            if (frameUrl.includes('powerbi.com') || frameUrl.includes('pbix')) {
                powerBIFrame = frames[i];
                console.log(`✓ Found Power BI frame at index ${i}`);
                break;
            }
        }

        if (!powerBIFrame && frames.length > 1) {
            powerBIFrame = frames[1]; // Fallback to second frame
            console.log("→ Using second frame as fallback");
        }

        if (!powerBIFrame) {
            console.error("❌ Could not find Power BI frame");
            await browser.close();
            process.exit(1);
        }

        // --------------------------------------------------------
        // WAIT FOR POWER BI TO RENDER
        // --------------------------------------------------------

        console.log("→ Waiting 20 seconds for Power BI to fully render...");
        await new Promise(r => setTimeout(r, 20000));

        // --------------------------------------------------------
        // EXTRACT TEXT FROM FRAME
        // --------------------------------------------------------

        console.log("→ Extracting text from Power BI frame...");
        const allText = await powerBIFrame.evaluate(() => document.body.innerText);

        console.log("\n" + "=".repeat(80));
        console.log("RAW POWER BI OUTPUT:");
        console.log("=".repeat(80));
        console.log(allText);
        console.log("=".repeat(80));

        // --------------------------------------------------------
        // PARSE THE DATA
        // --------------------------------------------------------

        const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
        console.log(`\n→ Found ${lines.length} non-empty lines`);

        console.log("\nFirst 100 lines:");
        lines.slice(0, 100).forEach((line, i) => {
            console.log(`${i.toString().padStart(3, '0')}: ${line}`);
        });

        // Create a simple metrics file for now
        const metrics = {
            updated_at: new Date().toISOString(),
            raw_line_count: lines.length,
            first_50_lines: lines.slice(0, 50),
            note: "Debug version - will parse properly once we see the structure"
        };

        console.log("\n✓ Extracted data, writing debug output...");

        fs.writeFileSync(
            outputFile,
            JSON.stringify(metrics, null, 2)
        );

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
