import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

// Simple in-memory cache to avoid re-scraping frequently during a session
const seedCache: Record<string, any> = {};

// Function to fetch HTML content using the Fetch API
async function fetchHtml(domain: string) {
  const url = `https://${domain}`;
  try {
    const res = await fetch(url, {
      headers: {
        // Set a user-agent to mimic a real browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow', // Follow redirects
    });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    return await res.text(); // Return the HTML content as text
  } catch (err) {
    throw new Error(`Error fetching ${url}: ${err}`);
  }
}

// Function to fetch HTML content using Puppeteer for more complex pages
async function fetchWithPuppeteer(domain: string, takeScreenshot = false) {
  const url = `https://${domain}`;
  let browser: any;
  try {
    console.log('Launching Puppeteer for', domain);
    // Launch Puppeteer with specific arguments
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    // Set a user-agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    // Navigate to the URL and wait for network to be idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    // Allow single-page app hydration to complete
    await page.waitForTimeout(1500);
    const content = await page.content(); // Get the page content
    if (takeScreenshot) {
      // Take a screenshot if requested
      const screenshotPath = `/tmp/${domain.replace(/\./g, '_')}_fallback.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log('Puppeteer screenshot saved to', screenshotPath);
    }
    await browser.close(); // Close the browser
    return content;
  } catch (e) {
    console.error('Error during Puppeteer launch or fetch:', e);
    if (browser) await browser.close(); // Ensure browser is closed on error
    throw new Error(`Puppeteer fetch failed: ${e}`);
  }
}

// GET handler for scraping a domain
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  console.log('Scrape GET called for domain:', domain);
  if (!domain) return NextResponse.json({ error: 'domain query param is required' }, { status: 400 });
  // Normalize the domain by removing protocol and trailing slashes
  const normalized = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

  // Return cached result if it exists
  if (seedCache[normalized]) {
    return NextResponse.json(seedCache[normalized]);
  }

  try {
    // Fetch HTML content using Fetch API
    const html = await fetchHtml(normalized);
    const $ = cheerio.load(html); // Load HTML into Cheerio for parsing
    const title = $('title').text().trim() || null; // Extract the title
    const canonicalTag = $('link[rel="canonical"]').attr('href') || null; // Extract canonical link

    // Extract and clean body text
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    let snippet = bodyText.slice(0, 500); // Create a snippet of the body text

    const jsonLd: any[] = [];
    // Extract JSON-LD scripts
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).text() || '{}');
        jsonLd.push(parsed);
      } catch (e) {}
    });

    let companyNames: string[] = [];
    // Function to extract company names from JSON-LD data
    const extractNamesFromJsonLd = (items: any[]) => {
      const names: string[] = [];
      items.forEach(item => {
        if (item && typeof item === 'object') {
          if (item.name) names.push(item.name);
          if (Array.isArray(item['@graph'])) {
            item['@graph'].forEach((g: any) => { if (g?.name) names.push(g.name); });
          }
        }
      });
      return names;
    };
    companyNames = extractNamesFromJsonLd(jsonLd);

    // Fallback to Puppeteer if data is sparse
    if ((snippet.length < 100 || companyNames.length === 0)) {
      console.log('Falling back to Puppeteer for', normalized);
      try {
        // Fetch HTML content using Puppeteer
        const puppeteerHtml = await fetchWithPuppeteer(normalized, true);
        const $2 = cheerio.load(puppeteerHtml);
        const bodyText2 = $2('body').text().replace(/\s+/g, ' ').trim();
        const snippet2 = bodyText2.slice(0, 500);
        const jsonLd2: any[] = [];
        // Extract JSON-LD scripts from Puppeteer content
        $2('script[type="application/ld+json"]').each((_, el) => {
          try { jsonLd2.push(JSON.parse($2(el).text() || '{}')); } catch {}
        });
        const companyNames2 = extractNamesFromJsonLd(jsonLd2);
        if (snippet2.length > snippet.length) snippet = snippet2;
        if (companyNames2.length > 0) companyNames = companyNames2;
        console.log('Puppeteer fallback enriched data for', normalized);
      } catch (e) {
        console.warn('Puppeteer fallback failed for', normalized, e);
      }
    }

    // Use the title as a company name if no names were found
    if (companyNames.length === 0 && title) {
      companyNames.push(title);
    }

    // Create a seed object with the extracted data
    const seed = { 
      domain: normalized, 
      title, 
      canonical: canonicalTag, 
      companyNames: Array.from(new Set(companyNames)), // Remove duplicate names
      snippet, 
      source: { usedPuppeteerFallback: snippet.length < 100 || companyNames.length === 0 }
    };
    seedCache[normalized] = seed; // Cache the result

    return NextResponse.json(seed);
  } catch (err: any) {
    console.error('Scrape error:', err);
    return NextResponse.json({ error: err.message || 'unknown error', domain: normalized }, { status: 500 });
  }
}
