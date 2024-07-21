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
  const report = { url, issues: [], scores: {} };

  if (checks.pa11y) {
    const pa11yResults = await runPa11yWithPuppeteer(url);
    report.pa11y = pa11yResults;
    report.scores.accessibility = pa11yResults.issues.length ? 100 - pa11yResults.issues.length : 100;
    report.issues.push({ type: 'accessibility', issues: pa11yResults.issues });
  }
  if (checks.lighthouse) {
    const lighthouseResults = await runLighthouse(url);
    report.lighthouse = lighthouseResults;
    report.scores.performance = Math.round(lighthouseResults.categories.performance.score * 100);
    report.scores.accessibility = Math.round(lighthouseResults.categories.accessibility.score * 100);
    report.scores['best-practices'] = Math.round(lighthouseResults.categories['best-practices'].score * 100);
    report.scores.seo = Math.round(lighthouseResults.categories.seo.score * 100);
    report.issues.push({
      type: 'performance',
      issues: Object.values(lighthouseResults.audits).filter(audit => audit.score !== 1 && audit.details && audit.details.type !== 'diagnostic')
    });
  }
  if (checks.htmlValidation) {
    const htmlValidationResults = await validateHtml(url);
    report.htmlValidation = htmlValidationResults;
    report.scores.htmlValidation = htmlValidationResults.messages.length ? 100 - htmlValidationResults.messages.length : 100;
    report.issues.push({ type: 'htmlValidation', issues: htmlValidationResults.messages });
  }
  if (checks.eslint) {
    const eslintResults = await runESLint();
    report.eslint = eslintResults;
    report.scores.eslint = eslintResults.length ? 100 - eslintResults.length : 100;
    report.issues.push({ type: 'eslint', issues: eslintResults });
  }
  if (checks.stylelint) {
    const stylelintResults = await runStylelint();
    report.stylelint = stylelintResults;
    report.scores.stylelint = stylelintResults.length ? 100 - stylelintResults.length : 100;
    report.issues.push({ type: 'stylelint', issues: stylelintResults });
  }

  // Calculate consolidated score as an average of individual scores
  const scoreValues = Object.values(report.scores);
  report.scores.consolidated = scoreValues.length ? Math.round(scoreValues.reduce((a, b) => a + b) / scoreValues.length) : 0;

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
