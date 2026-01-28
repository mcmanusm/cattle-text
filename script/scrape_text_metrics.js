// ============================================================
// scrape_text_metrics.js - Cattle Market Weekly Averages Scraper
// COMPREHENSIVE VERSION - All Categories + States
// ============================================================

const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {

    const url = "https://mcmanusm.github.io/cattle-text/cattle-text-table.html";
    const outputFile = "text-metrics.json";

    let previousMetrics = null;
    if (fs.existsSync(outputFile)) {
        try {
            previousMetrics = JSON.parse(fs.readFileSync(outputFile, "utf8"));
            console.log("✓ Loaded previous metrics");
        } catch (e) {
            console.log("⚠️  Could not parse previous metrics");
        }
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(90000);

        console.log("→ Navigating...");
        await page.goto(url, { waitUntil: "networkidle2" });
        
        await page.waitForSelector("iframe", { timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        const frames = await page.frames();
        let powerBIFrame = frames.find(f => f.url().includes('powerbi.com')) || frames[1];
        
        console.log("→ Waiting for Power BI...");
        await new Promise(r => setTimeout(r, 20000));

        const allText = await powerBIFrame.evaluate(() => document.body.innerText);
        const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);
        
        console.log(`→ Found ${lines.length} lines`);

        const dateLine = lines.find(l => l.includes("2026")) || "Unknown";
        
        // Categories to look for
        const steersCategories = [
            "Steers 0-200kg",
            "Steers 200.1-280kg", 
            "Steers 280.1-330kg",
            "Steers 330.1-400kg",
            "Steers 400kg +"
        ];
        
        const heifersCategories = [
            "Heifers 0-200kg",
            "Heifers 200.1-280kg",
            "Heifers 280.1-330kg", 
            "Heifers 330.1-400kg",
            "Heifers 400kg +"
        ];
        
        const breedingCategories = [
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
        
        const allCategories = [...steersCategories, ...heifersCategories, ...breedingCategories];
        const states = ["National", "NSW", "QLD", "SA", "Tas", "Vic", "WA", "NT"];

        function parseCategory(lines, startIndex) {
            const data = {
                offered: null, weight_range: null, avg_weight: null,
                dollar_head_range: null, avg_dollar_head: null, dollar_change: null,
                c_kg_range: null, avg_c_kg: null, c_kg_change: null, clearance: null
            };
            
            let dataIndex = 0;
            for (let j = startIndex + 1; j < Math.min(startIndex + 20, lines.length); j++) {
                const value = lines[j];
                
                // Skip header/formatting lines
                if (value.includes("Additional") || value.includes("Scroll") ||
                    value === "Change" || value === "Avg" || value === "Offered" ||
                    value === "Clearance" || value.includes("Range")) continue;
                
                // Stop if hit another category or state
                if (allCategories.some(c => value === c) || states.some(s => value === s)) break;
                
                if (dataIndex === 0) data.offered = value;
                else if (dataIndex === 1) data.weight_range = value;
                else if (dataIndex === 2) data.avg_weight = value;
                else if (dataIndex === 3) data.dollar_head_range = value;
                else if (dataIndex === 4) data.avg_dollar_head = value;
                else if (dataIndex === 5) data.dollar_change = value;
                else if (dataIndex === 6) data.c_kg_range = value;
                else if (dataIndex === 7) data.avg_c_kg = value;
                else if (dataIndex === 8) data.c_kg_change = value;
                else if (dataIndex === 9) { data.clearance = value; break; }
                
                dataIndex++;
            }
            return data;
        }

        const results = { national: [], states: [] };
        let currentState = null;
        let currentCategories = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for state header
            if (states.includes(line)) {
                if (currentState && currentCategories.length > 0) {
                    if (currentState === "National") {
                        results.national = currentCategories;
                    } else {
                        results.states.push({ state: currentState, categories: currentCategories });
                    }
                }
                currentState = line;
                currentCategories = [];
                console.log(`→ Found: ${line}`);
                continue;
            }
            
            // Check for category
            if (allCategories.includes(line)) {
                const data = parseCategory(lines, i);
                currentCategories.push({ category: line, ...data });
            }
        }

        // Save last section
        if (currentState && currentCategories.length > 0) {
            if (currentState === "National") {
                results.national = currentCategories;
            } else {
                results.states.push({ state: currentState, categories: currentCategories });
            }
        }

        const metrics = {
            updated_at: new Date().toISOString(),
            report_date: dateLine,
            ...results,
            summary: {
                national_categories: results.national.length,
                states_count: results.states.length,
                total_state_categories: results.states.reduce((sum, s) => sum + s.categories.length, 0)
            }
        };

        console.log(`\n✓ Parsed: ${metrics.summary.national_categories} national, ${metrics.summary.total_state_categories} state categories`);

        fs.writeFileSync(outputFile, JSON.stringify(metrics, null, 2));
        console.log(`✓ Written to ${outputFile}`);

        await browser.close();

    } catch (error) {
        console.error("\n❌ ERROR:", error.message);
        await browser.close();
        process.exit(1);
    }

})();
