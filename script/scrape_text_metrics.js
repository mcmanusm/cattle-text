name: Scrape Cattle Text Metrics

on:
  schedule:
    # Run every day at 9:30 PM AEDT (10:30 AM UTC)
    - cron: '30 10 * * *'
  workflow_dispatch: # Allows manual triggering

jobs:
  scrape:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repo
        uses: actions/checkout@v3
        
      - name: List repository structure
        run: |
          echo "=== Repository Root ==="
          ls -la
          echo ""
          echo "=== Script Directory ==="
          ls -la script/ || echo "script/ directory not found"
          echo ""
          echo "=== Looking for scrape files ==="
          find . -name "*scrape*" -type f
        
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm install puppeteer
        
      - name: Run scraper
        run: node script/scrape_text_metrics.js
        
      - name: Commit updated metrics
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add -A
          git diff --quiet && git diff --staged --quiet || git commit -m "Update cattle text metrics [automated]"
          
      - name: Push changes
        uses: ad-m/github-push-action@master
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          branch: ${{ github.ref }}
