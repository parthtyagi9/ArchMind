import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'out');
await fs.mkdir(out,{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.tsx'),publicDir:path.join(root,'public')});
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const result=JSON.parse(await fs.readFile(path.join(root,'public/demo-results.json'),'utf8'));
const inputProps={comparisonChanged:result.comparison.changed};
const composition=await selectComposition({serveUrl,id:'ArchMindDemo',browserExecutable,inputProps});
if(process.argv.includes('--stills')){
  for(const [name,frame] of [['intro',60],['connect',240],['agents',510],['answer',735],['approval',960],['compare',1260],['govern',1530],['outro',1710]]){
    await renderStill({serveUrl,composition,frame,output:path.join(out,`${name}.png`),browserExecutable,inputProps});
    console.log(`Rendered preview ${name}`);
  }
}else{
  const narration=JSON.parse(await fs.readFile(path.join(root,'public/audio/narration.json'),'utf8'));
  const stamp=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')},000`;
  let cursor=0;
  const srt=narration.map(([name,duration,text],i)=>{const start=cursor;cursor+=duration;return `${i+1}\n${stamp(start)} --> ${stamp(cursor)}\n${text}\n`;}).join('\n');
  await fs.writeFile(path.join(out,'archmind-captions.srt'),srt);
  let last=-1;
  await renderMedia({serveUrl,composition,inputProps,codec:'h264',audioCodec:'aac',crf:18,pixelFormat:'yuv420p',
    outputLocation:path.join(out,'archmind-demo.mp4'),browserExecutable,concurrency:4,
    onProgress:({progress})=>{const pct=Math.floor(progress*100);if(pct>=last+10){console.log(`Render ${pct}%`);last=pct;}}});
  await renderStill({serveUrl,composition,frame:65,output:path.join(out,'archmind-poster.png'),browserExecutable});
  console.log('Rendered out/archmind-demo.mp4 (1920×1080, 30fps, 60 seconds)');
}
