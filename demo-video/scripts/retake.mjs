// Retake the approval shot only after its real network data has loaded.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const state=JSON.parse(await fs.readFile(path.join(root,'recording-state.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  const response=await route.fetch({url:`http://127.0.0.1:8011${url.pathname}${url.search}`,
    headers:{...req.headers(),cookie:`archmind_session=${state.cookie}`},timeout:180_000});
  await route.fulfill({response});
});
const page=await context.newPage();
page.setDefaultTimeout(60_000);
try{
  await page.goto('http://localhost:3000',{waitUntil:'networkidle'});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.getByRole('button',{name:'Open',exact:true}).first().click();
  await page.getByRole('button',{name:'Governance',exact:true}).click();
  await page.getByRole('button',{name:/^Approval Center/}).click();
  await page.getByRole('button',{name:'Approve',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'public/captures/approval.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Approve',exact:true}).click();
  await page.getByText('Nothing is waiting for review.').waitFor({timeout:90_000});
  await page.getByRole('button',{name:'Architecture',exact:true}).click();
  await page.getByText(/components · \d+ dependencies/).first().waitFor();
  await page.screenshot({path:path.join(root,'public/captures/architecture.png'),animations:'disabled'});
  console.log('Retaken loaded approval and architecture screens; no mock responses.');
}finally{await context.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
