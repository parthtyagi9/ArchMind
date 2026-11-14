// Drive the actual frontend and backend. No mocked API responses or invented answers.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const state = JSON.parse(await fs.readFile(path.join(root, 'recording-state.json'), 'utf8'));
const captures = path.join(root, 'public/captures');
await fs.mkdir(captures, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const context = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
await context.addCookies([{name:'archmind_session', value:state.cookie, url:'http://localhost:3000', httpOnly:true, sameSite:'Lax'}]);
await context.route('**/api/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  const response = await route.fetch({url:`http://127.0.0.1:8011${url.pathname}${url.search}`,
    headers:{...req.headers(), cookie:`archmind_session=${state.cookie}`}, timeout:180_000});
  await route.fulfill({response});
});
const page = await context.newPage();
page.setDefaultTimeout(25_000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const pause = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  await pause(500);
  await page.screenshot({path:path.join(captures, `${name}.png`), animations:'disabled'});
  console.log(`Captured ${name}`);
};
const request = async (url, opts={}) => {
  const res = await context.request.fetch(`http://127.0.0.1:8011/api${url}`, {
    ...opts, headers:{cookie:`archmind_session=${state.cookie}`, ...opts.headers}, timeout:180_000,
  });
  if(!res.ok()) throw new Error(`${url}: ${res.status()} ${await res.text()}`);
  return res.json();
};

try {
  await page.goto('http://localhost:3000', {waitUntil:'networkidle'});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.getByRole('heading', {name:'Open a workspace'}).waitFor();
  await shot('workspace');
  await page.getByRole('button', {name:'Open', exact:true}).first().click();
  await page.getByRole('complementary', {name:'AI assistant'}).waitFor();
  let run;
  if(!process.argv.includes('--resume')) {
  await page.getByRole('button', {name:'Connect', exact:true}).count().then(async count => {
    // Both sources are already verified during setup; open Settings via the source indicator.
    await page.getByRole('button', {name:'Jira connected', exact:true}).click();
  });
  await page.getByRole('heading', {name:'Jira & Confluence context'}).waitFor();
  await shot('sources');

  // Filter the real file tree and open ProducerConfig.java.
  await page.getByRole('button', {name:'Explorer', exact:true}).click();
  const filter = page.getByPlaceholder(/filter/i).first();
  await filter.fill('ProducerConfig.java');
  await page.getByRole('button', {name:/ProducerConfig.java/}).last().click();
  await page.locator('[data-line="311"]').waitFor();
  await page.locator('[data-line="311"]').scrollIntoViewIfNeeded();
  const first=await page.locator('[data-line="311"]').boundingBox();
  const last=await page.locator('[data-line="319"]').boundingBox();
  await page.mouse.move(550,first.y+first.height/2);
  await page.mouse.down();
  await page.mouse.move(1120,last.y+last.height/2,{steps:18});
  await page.mouse.up();
  await page.getByRole('button',{name:'Add to chat',exact:true}).waitFor();
  await shot('selection');
  await page.getByRole('button', {name:'Add to chat', exact:true}).click();
  await page.getByRole('textbox', {name:'Question', exact:true}).fill(state.question);
  await shot('question');
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/agent/runs') && r.request().method()==='POST');
  await page.getByRole('button', {name:'Send', exact:true}).click();
  const runId=(await (await responsePromise).json()).run_id;
  state.run_id=runId;
  let progressCaptured=false;
  for(let i=0;i<180;i++){
    run=await request(`/agent/runs/${runId}`);
    if(!progressCaptured && run.agents.some(a=>a.status==='running')){
      await shot('agents'); progressCaptured=true;
    }
    if(run.status!=='running') break;
    await pause(1000);
  }
  if(run.status!=='completed') throw new Error(`Investigation failed: ${run.error}`);
  await pause(1400);
  await page.getByRole('complementary', {name:'AI assistant'}).locator('div.overflow-y-auto').first().evaluate(el=>el.scrollTop=el.scrollHeight);
  await shot('answer');
  console.log('Genuine investigation:',run.answer.guidance.verdict,run.agents.map(a=>`${a.id}:${a.status}`).join(', '));
  } else {
    run=(await request(`/agent/runs?repo_id=${state.repo_id}`)).find(r=>r.status==='completed');
    if(!run) throw new Error('No completed investigation to resume.');
    state.run_id=run.id;
  }
  await fs.writeFile(path.join(root,'recording-state.json'),JSON.stringify(state,null,2));

  await page.getByRole('button', {name:'Governance', exact:true}).click();
  const policy = await request(`/memories/${state.policy_id}`);
  if(policy.status==='pending'){
  await page.getByRole('button', {name:/^Approval Center/}).click();
  await page.getByRole('heading', {name:'Approval Center', exact:true}).waitFor();
  await page.getByRole('button', {name:'Approve', exact:true}).waitFor();
  await shot('approval');
  await page.getByRole('button', {name:'Approve', exact:true}).click();
  await page.getByText('Nothing is waiting for review.').waitFor({timeout:90_000});
  }

  await page.getByRole('button', {name:'Memory Inspector', exact:true}).click();
  await page.getByRole('button', {name:/Demo policy: preserve producer reliability/}).click();
  await page.getByRole('heading', {name:'Demo policy: preserve producer reliability'}).waitFor();
  await shot('memory');

  // Let Atlas's asynchronous search index catch up after approval; use real retrieval.
  for(let i=0;i<30;i++){
    const result=await request('/memories/search',{method:'POST',data:{query:state.question,repo_id:state.repo_id}});
    if(result.results.some(r=>r.memory.memory_id===state.policy_id)) break;
    await pause(1500);
    if(i===29) throw new Error('Demo policy was not eligible/relevant in live vector retrieval.');
  }
  await page.getByRole('button', {name:'Memory Impact', exact:true}).click();
  await page.getByRole('heading', {name:'Memory Impact', exact:true}).waitFor();
  await page.locator('textarea').first().fill(state.question);
  const compareResponse=page.waitForResponse(r=>r.url().endsWith('/api/agent/compare') && r.request().method()==='POST');
  await page.getByRole('button', {name:'Compare with and without memory', exact:true}).click();
  const compareId=(await (await compareResponse).json()).compare_id;
  state.compare_id=compareId;
  let comparison;
  for(let i=0;i<180;i++){
    comparison=await request(`/agent/compare/${compareId}`);
    if(comparison.status!=='running') break;
    await pause(1000);
  }
  if(comparison.status!=='completed') throw new Error(`Comparison failed: ${comparison.error}`);
  await pause(1200);
  const result=page.getByText(comparison.changed?'Decision changed because of memory':'No change: memory did not alter the decision',{exact:true});
  await result.scrollIntoViewIfNeeded();
  await shot('compare');
  console.log('Genuine comparison:',comparison.without_memory.guidance.verdict,'->',comparison.with_memory.guidance.verdict,'changed:',comparison.changed);

  await page.getByRole('button', {name:'Decision History', exact:true}).click();
  await page.getByRole('heading', {name:'Decision History', exact:true}).waitFor();
  await shot('audit');
  await page.getByRole('button', {name:'Architecture', exact:true}).click();
  await page.getByText(/components · \d+ dependencies/).first().waitFor();
  await shot('architecture');

  const manifest={question:state.question, policy:'Illustrative demo-team policy', capturedAt:new Date().toISOString(),
    run:{id:run.id, verdict:run.answer.guidance.verdict, sources:run.agents.map(a=>({id:a.id,status:a.status,findings:a.findings.length}))},
    comparison:{id:comparison.id,changed:comparison.changed,without:comparison.without_memory.guidance.verdict,with:comparison.with_memory.guidance.verdict,
      withoutRecommendation:comparison.without_memory.guidance.recommendation,withRecommendation:comparison.with_memory.guidance.recommendation,
      constraints:comparison.with_memory.guidance.constraints.map(c=>c.text)},
    errors};
  await fs.writeFile(path.join(root,'public/demo-results.json'),JSON.stringify(manifest,null,2));
  await fs.writeFile(path.join(root,'recording-state.json'),JSON.stringify(state,null,2));
  console.log('Capture complete. All displayed answers came from the actual backend.');
} catch(e) {
  await page.screenshot({path:path.join(captures,'debug.png')}).catch(()=>{});
  console.error(e.message);
  console.error('Browser errors:', errors);
  process.exitCode=1;
} finally { await context.unrouteAll({behavior:'ignoreErrors'}); await browser.close(); }
