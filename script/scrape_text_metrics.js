// ============================================================
// DEBUG SCRAPER - Shows raw Power BI output
// ============================================================

const puppeteer = require('puppeteer');

console.log("Starting scraper...");
console.log("Node version:", process.version);
console.log("Working directory:", process.cwd());

(async () => {
    const url = "https://mcmanusm.github.io/Cattle_Comments/texttable";

    console.log("Launching browser...");
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

        console.log("→ Waiting for iframe...");
        await page.waitForSelector("iframe", { timeout: 30000 });
        console.log("✓ Iframe found");

        const frames = await page.frames();
        console.log(`→ Found ${frames.length} frames`);

        let frame = frames.find(f => f.url().includes('powerbi.com'));
        if (!frame && frames.length > 1) {
            frame = frames[1];
        }

        if (!frame) {
            console.error("❌ Could not find Power BI iframe");
            await browser.close();
            process.exit(1);
        }

        console.log("✓ Found Power BI frame");
        console.log("→ Waiting 20 seconds for Power BI to load...");
        await new Promise(r => setTimeout(r, 20000));

        console.log("→ Extracting text from frame...");
        const allText = await frame.evaluate(() => document.body.innerText);

        console.log("\n" + "=".repeat(80));
        console.log("RAW POWER BI OUTPUT:");
        console.log("=".repeat(80));
        console.log(allText);
        console.log("=".repeat(80));

        // Also split by lines to see structure
        const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
        console.log(`\nTotal non-empty lines: ${lines.length}`);
        console.log("\nFirst 50 lines:");
        lines.slice(0, 50).forEach((line, i) => {
            console.log(`${i.toString().padStart(3, '0')}: ${line}`);
        });

        console.log("\n✓ Scrape completed successfully");
        await browser.close();
        
    } catch (error) {
        console.error("\n❌ ERROR:", error.message);
        console.error(error.stack);
        await browser.close();
        process.exit(1);
    }
})();
