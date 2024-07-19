const express = require('express');
const bodyParser = require('body-parser');
const pa11y = require('pa11y');
const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const validator = require('html-validator');
const axios = require('axios');
const { ESLint } = require('eslint');
const stylelint = require('stylelint');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

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

async function runLighthouse(url) {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const options = { logLevel: 'info', output: 'json', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], port: chrome.port };
  const runnerResult = await lighthouse(url, options);

  await chrome.kill();
  return JSON.parse(runnerResult.report);
}

async function validateHtml(url) {
  const response = await axios.get(url);
  const options = {
    data: response.data,
    format: 'json'
  };

  const result = await validator(options);
  return result;
}

async function runESLint() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["**/*.js", "**/*.jsx"]);
  const formatter = await eslint.loadFormatter("json");
  const resultText = formatter.format(results);
  return JSON.parse(resultText);
}

async function runStylelint() {
  const results = await stylelint.lint({
    files: '**/*.css',
    formatter: 'json'
  });

  return JSON.parse(results.output);
}

async function generateReport(url, checks) {
  const report = { url };

  if (checks.pa11y) {
    report.pa11y = await runPa11yWithPuppeteer(url);
  }
  if (checks.lighthouse) {
    report.lighthouse = await runLighthouse(url);
  }
  if (checks.htmlValidation) {
    report.htmlValidation = await validateHtml(url);
  }
  if (checks.eslint) {
    report.eslint = await runESLint();
  }
  if (checks.stylelint) {
    report.stylelint = await runStylelint();
  }

  return report;
}

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
