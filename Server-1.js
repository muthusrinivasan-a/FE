import express from 'express';
import bodyParser from 'body-parser';
import pa11y from 'pa11y';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import validator from 'html-validator';
import axios from 'axios';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import https from 'https';

// Import JSON configuration files with assertions
import eslintConfig from './.eslintrc.json' assert { type: 'json' };
import stylelintConfig from './.stylelintrc.json' assert { type: 'json' };

// Function to run Pa11y with Puppeteer
async function runPa11yWithPuppeteer(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

  const results = await pa11y(url, {
    browser: browser,
    page: page,
    wait: '5000' // Wait for 5 seconds after loading the page to ensure all content is rendered
  });

  await browser.close();
  return results;
}

// Function to run Lighthouse
async function runLighthouse(url) {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const options = { logLevel: 'info', output: 'json', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], port: chrome.port };
  const runnerResult = await lighthouse(url, options);

  await chrome.kill();
  return JSON.parse(runnerResult.report);
}

// Function to validate HTML
async function validateHtml(url) {
  const response = await axios.get(url, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false
    })
  });
  const options = {
    data: response.data,
    format: 'json'
  };

  const result = await validator(options);
  return result;
}

// Function to run ESLint
async function runESLint() {
  const eslint = new ESLint({ overrideConfig: eslintConfig });
  const results = await eslint.lintFiles(["**/*.js", "**/*.jsx"]);
  const formatter = await eslint.loadFormatter("json");
  const resultText = formatter.format(results);
  return JSON.parse(resultText);
}

// Function to run Stylelint
async function runStylelint() {
  const results = await stylelint.lint({
    files: '**/*.css',
    formatter: 'json',
    config: stylelintConfig
  });

  return JSON.parse(results.output);
}

// Function to generate consolidated report
async function generateReport(url, checks) {
  const report = { url, issues: [] };

  if (checks.pa11y) {
    report.pa11y = await runPa11yWithPuppeteer(url);
    report.issues.push(...report.pa11y.issues);
  }
  if (checks.lighthouse) {
    report.lighthouse = await runLighthouse(url);
    report.issues.push(...report.lighthouse.audits);
  }
  if (checks.htmlValidation) {
    report.htmlValidation = await validateHtml(url);
    report.issues.push(...report.htmlValidation.messages);
  }
  if (checks.eslint) {
    report.eslint = await runESLint();
    report.issues.push(...report.eslint);
  }
  if (checks.stylelint) {
    report.stylelint = await runStylelint();
    report.issues.push(...report.stylelint);
  }

  return report;
}

const app = express();
app.use(bodyParser.json());

// Get __dirname equivalent in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Serve the HTML page
app.use(express.static(path.join(__dirname, 'public')));

app.post('/check', async (req, res) => {
  const { url, checks } = req.body;
  if (!url) {
    return res.status(400).send('URL is required');
  }

  try {
    const report = await generateReport(url, checks);
    res.json(report);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).send('Error generating report');
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
