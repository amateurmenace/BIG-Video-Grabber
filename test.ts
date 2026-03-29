import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

async function run() {
  const url = 'https://brooklinema.zoomgov.com/rec/share/sNbtBEUruVAC7KQGaHPGmBKsRZHoW5Fc_qQGZ9FLViBi79KJWwJtQFsn7qoSXBqz.ENt6J6pKtVOVc-uf?startTime=1774562430000';
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const downloadPath = path.resolve('./downloads_test2');
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath);
  }
  
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath,
    eventsEnabled: true
  });

  client.on('Browser.downloadWillBegin', async (event) => {
    console.log(`Download starting: ${event.suggestedFilename}`);
    if (!event.suggestedFilename.endsWith('.mp4')) {
      console.log(`Canceling non-mp4 download: ${event.suggestedFilename}`);
      try {
        await client.send('Browser.cancelDownload', { guid: event.guid });
      } catch (e) {
        console.error("Error canceling:", e);
      }
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2' });
  
  try {
    console.log("Looking for download button...");
    const downloadBtnSelector = 'a[aria-label="Download"], button[aria-label="Download"], .download-button, [class*="download"]';
    await page.waitForSelector(downloadBtnSelector, { timeout: 10000 });
    console.log("Found download button, clicking...");
    await page.click(downloadBtnSelector);
    
    console.log("Waiting 15 seconds...");
    await new Promise(r => setTimeout(r, 15000));
    
    console.log("Files in downloads:", fs.readdirSync(downloadPath));
  } catch (e) {
    console.log("Error:", e.message);
  }
  
  await browser.close();
}
run();
