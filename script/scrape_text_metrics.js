const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeCattleDataWithScroll() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('Loading page...');
    await page.goto('YOUR_GITHUB_PAGE_URL', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const frames = await page.frames();
    const powerBIFrame = frames.find(frame => 
      frame.url().includes('powerbi') || frame.name().includes('powerbi')
    );

    if (!powerBIFrame) {
      throw new Error('Power BI iframe not found');
    }

    console.log('Waiting for tables to load...');
    await powerBIFrame.waitForSelector('[role="grid"]', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Function to scroll and collect all data
    const scrollAndCollect = async () => {
      return await powerBIFrame.evaluate(async () => {
        // Find scrollable containers
        const scrollableContainers = document.querySelectorAll('.scrollable-cells-viewport, .scrollRegion');
        
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Collect all unique rows
        const collectedRows = new Map();
        let previousSize = 0;
        let unchangedCount = 0;

        // Function to collect visible rows
        const collectVisibleRows = () => {
          const rows = document.querySelectorAll('[role="row"]');
          
          rows.forEach((row) => {
            const cells = row.querySelectorAll('[role="gridcell"]');
            if (cells.length === 0) return;
            
            const cellTexts = Array.from(cells).map(c => c.textContent.trim());
            const rowKey = cellTexts.join('|'); // Create unique key
            
            if (!collectedRows.has(rowKey)) {
              collectedRows.set(rowKey, cellTexts);
            }
          });
        };

        // Initial collection
        collectVisibleRows();

        // Scroll through each container
        for (const container of scrollableContainers) {
          let scrollPosition = 0;
          const maxScroll = container.scrollHeight;
          const scrollStep = 100;

          while (scrollPosition < maxScroll) {
            container.scrollTop = scrollPosition;
            await sleep(200); // Wait for new rows to render
            collectVisibleRows();
            
            scrollPosition += scrollStep;
            
            // Check if we're still finding new rows
            if (collectedRows.size === previousSize) {
              unchangedCount++;
              if (unchangedCount > 5) break; // No new rows for 5 scrolls
            } else {
              unchangedCount = 0;
              previousSize = collectedRows.size;
            }
          }
        }

        console.log(`Collected ${collectedRows.size} unique rows`);
        return Array.from(collectedRows.values());
      });
    };

    console.log('Scrolling and collecting data...');
    const allRows = await scrollAndCollect();
    console.log(`Total unique rows collected: ${allRows.length}`);

    // Process the collected rows
    const data = {
      stateAverages: [],
      nationalAverages: []
    };

    allRows.forEach((cells, idx) => {
      if (cells.length === 0) return;
      
      const firstCell = cells[0];
      const isStateRow = /^(NSW|QLD|VIC|SA|Tas|WA|NT)$/i.test(firstCell);
      
      if (isStateRow) {
        // National averages row (has State column)
        data.nationalAverages.push({
          State: cells[0] || '',
          Category: cells[1] || '',
          CategoryCC: cells[2] || '',
          Offered: cells[3] || '',
          WeightRange: cells[4] || '',
          AvgWeight: cells[5] || '',
          HeadRange: cells[6] || '',
          Avg: cells[7] || '',
          Change: cells[8] || '',
          CkgRange: cells[9] || '',
          AvgCkg: cells[10] || '',
          ChangeCkg: cells[11] || '',
          Clearance: cells[12] || ''
        });
      } else if (/steers|heifers|breeding/i.test(firstCell)) {
        // State averages row (no State column)
        data.stateAverages.push({
          Category: cells[0] || '',
          CategoryCC: cells[1] || '',
          Offered: cells[2] || '',
          WeightRange: cells[3] || '',
          AvgWeight: cells[4] || '',
          HeadRange: cells[5] || '',
          Avg: cells[6] || '',
          Change: cells[7] || '',
          CkgRange: cells[8] || '',
          AvgCkg: cells[9] || '',
          ChangeCkg: cells[10] || '',
          Clearance: cells[11] || ''
        });
      }
    });

    // Group national data by state
    const stateData = {};
    data.nationalAverages.forEach(row => {
      const state = row.State;
      if (!stateData[state]) {
        stateData[state] = [];
      }
      stateData[state].push(row);
    });

    const finalData = {
      extractedDate: new Date().toISOString(),
      stateAverages: data.stateAverages,
      nationalAveragesByState: stateData,
      allStates: Object.keys(stateData).sort(),
      summary: {
        totalStateAverageRows: data.stateAverages.length,
        totalNationalAverageRows: data.nationalAverages.length,
        statesFound: Object.keys(stateData).sort(),
        rowsPerState: Object.entries(stateData).map(([state, rows]) => ({
          state,
          count: rows.length
        }))
      }
    };

    const filename = `cattle_data_scroll_${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(finalData, null, 2));
    
    console.log('\n=== EXTRACTION COMPLETE ===');
    console.log(`State averages: ${finalData.summary.totalStateAverageRows} rows`);
    console.log(`National averages: ${finalData.summary.totalNationalAverageRows} rows`);
    console.log(`States found: ${finalData.summary.statesFound.join(', ')}`);
    console.log('\nRows per state:');
    finalData.summary.rowsPerState.forEach(({ state, count }) => {
      console.log(`  ${state}: ${count} rows`);
    });
    console.log(`\nData saved to: ${filename}`);

    return finalData;

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the scraper
scrapeCattleDataWithScroll()
  .then(data => {
    console.log('\n✓ Scraping completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Scraping failed:', error);
    process.exit(1);
  });
