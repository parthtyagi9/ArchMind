import React from 'react';
import {AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ArrowRight, BookOpen, Brain, Check, Code2, Database, GitBranch, Layers, LockKeyhole, ShieldCheck, Sparkles, Ticket} from 'lucide-react';

const C={bg:'#080a11', panel:'#111522', line:'#2a3045', text:'#f1f3ff', muted:'#929bb8', brand:'#99a6ff', green:'#50dfb5', blue:'#67c6ff', amber:'#f8cb72'};
const FONT='-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO='"SF Mono", Menlo, monospace';
const SCENES=[
  {start:0, end:5, id:'intro', label:'ENGINEERING MEMORY, UNDER YOUR CONTROL', caption:'Code tells you what happens. ArchMind uncovers why—and remembers the rules.'},
  {start:5, end:12, id:'connect', label:'01 / CONNECT YOUR CONTEXT', caption:'Connect a repository and paste public Jira and Confluence links. No API tokens for public sources.'},
  {start:12, end:21, id:'investigate', label:'02 / ASK THE CODE WHY', caption:'Select code and ask why. GitHub, Jira, Confluence, and Memory agents gather evidence in parallel.'},
  {start:21, end:28, id:'answer', label:'03 / FOLLOW THE EVIDENCE', caption:'Get concrete guidance, with each agent’s retrieved evidence available to inspect.'},
  {start:28, end:36, id:'approve', label:'04 / A HUMAN APPROVES THE MEMORY', caption:'Knowledge starts as a proposal. A human approves its scope, provenance, and expiry.'},
  {start:36, end:48, id:'compare', label:'05 / WATCH MEMORY CHANGE THE GUIDANCE', caption:'Ask the same question with and without memory. Shared evidence makes the difference visible.'},
  {start:48, end:55, id:'govern', label:'06 / GOVERN THE WHOLE LIFECYCLE', caption:'Filter by tenant, scope, status, and expiry inside Atlas Vector Search. Correct a memory, or revoke it from retrieval.'},
  {start:55, end:60, id:'outro', label:'MEMORY YOU CAN GOVERN', caption:'ArchMind. Understand the decision. Govern what your agent remembers.'},
] as const;

const rise=(f:number,delay=0)=>spring({frame:Math.max(0,f-delay),fps:30,config:{damping:22,stiffness:110,mass:0.8}});
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;

function Background(){
  const f=useCurrentFrame();
  return <AbsoluteFill style={{background:C.bg,overflow:'hidden'}}>
    <div style={{position:'absolute',width:1600,height:1200,left:500+Math.sin(f/180)*65,top:-700,background:'radial-gradient(ellipse,#687aff24,transparent 65%)'}}/>
    <div style={{position:'absolute',width:1100,height:900,left:-600,top:350,background:'radial-gradient(ellipse,#20cfa212,transparent 65%)'}}/>
    <svg width="1920" height="1080" style={{position:'absolute',opacity:0.23}}><defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#536080"/></pattern></defs><rect width="1920" height="1080" fill="url(#grid)"/></svg>
  </AbsoluteFill>;
}

function Logo({size=36}:{size?:number}){
  return <div style={{display:'flex',alignItems:'center',gap:14,fontSize:size,fontWeight:740,letterSpacing:-1.5}}>
    <div style={{width:size*1.28,height:size*1.28,display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid #a0adff55',borderRadius:size*0.3,background:'linear-gradient(140deg,#a0adff28,#5be8bd0c)',boxShadow:'0 0 30px #7c8cff15'}}><Layers size={size*0.8} color={C.brand} strokeWidth={1.8}/></div>
    ArchMind
  </div>;
}

function Label({children}:{children:React.ReactNode}){return <div style={{fontFamily:MONO,fontSize:18,fontWeight:500,letterSpacing:2.1,color:C.green,marginBottom:28}}>{children}</div>}
function Pill({children,color=C.brand}:{children:React.ReactNode;color?:string}){return <div style={{display:'inline-flex',gap:9,alignItems:'center',padding:'11px 16px',borderRadius:11,border:`1px solid ${color}40`,background:`${color}0d`,color,fontSize:20,fontWeight:500}}>{children}</div>}

function Screen({name,x,y,w,h,crop,delay=0}:{name:string;x:number;y:number;w:number;h:number;crop?:{x:number;y:number;w:number};delay?:number}){
  const f=useCurrentFrame(),p=rise(f,delay);
  const scale=w/(crop?.w??1920);
  return <div style={{position:'absolute',left:x,top:y,width:w,height:h,opacity:p,transform:`translateY(${(1-p)*35}px) perspective(1800px) rotateY(${(1-p)*-3}deg)`,borderRadius:20,overflow:'hidden',border:'1px solid #65709d55',background:C.panel,boxShadow:'0 28px 110px #0009, 0 0 100px #7183ff0b'}}>
    <div style={{height:35,display:'flex',alignItems:'center',gap:7,paddingLeft:15,background:'#171c2b',borderBottom:'1px solid #ffffff0b'}}>{['#fa756c','#efc86d','#67d6a3'].map(c=><i key={c} style={{width:8,height:8,borderRadius:100,background:c}}/>)}<span style={{fontFamily:MONO,fontSize:11,color:'#8993b1',marginLeft:15}}>ArchMind · actual application capture</span></div>
    <div style={{position:'relative',height:h-35,overflow:'hidden'}}><Img src={staticFile(`captures/${name}.png`)} style={{position:'absolute',width:1920*scale,height:1080*scale,left:-(crop?.x??0)*scale,top:-(crop?.y??0)*scale,maxWidth:'none'}}/></div>
  </div>;
}

function Copy({label,title,body,children}:{label:string;title:React.ReactNode;body:string;children?:React.ReactNode}){
  const f=useCurrentFrame(),p=rise(f,4);
  return <div style={{position:'absolute',left:100,top:225,width:500,opacity:p,transform:`translateY(${(1-p)*22}px)`}}>
    <Label>{label}</Label><h1 style={{fontSize:66,letterSpacing:-3.1,lineHeight:1.07,fontWeight:700,margin:'0 0 28px'}}>{title}</h1>
    <p style={{color:C.muted,fontSize:26,lineHeight:1.5,maxWidth:480,margin:'0 0 30px'}}>{body}</p>{children}
  </div>;
}

function Intro(){
  const f=useCurrentFrame(),p=rise(f);
  return <>
    <div style={{position:'absolute',left:100,top:76}}><Logo/></div>
    <div style={{position:'absolute',left:100,top:285,opacity:p,transform:`translateY(${(1-p)*25}px)`}}>
      <Label>MEMORY YOU CAN GOVERN</Label>
      <h1 style={{fontSize:112,lineHeight:1.06,letterSpacing:-6,margin:0,fontWeight:720}}>Your code has history.<br/><span style={{background:'linear-gradient(90deg,#a2acff,#67e3c0)',backgroundClip:'text',WebkitTextFillColor:'transparent'}}>Give your agent context.</span></h1>
      <div style={{display:'flex',gap:14,marginTop:45}}><Pill><Code2 size={21}/>Code intelligence</Pill><Pill color={C.green}><ShieldCheck size={21}/>Governed memory</Pill></div>
    </div>
    <div style={{position:'absolute',right:120,top:90,fontFamily:MONO,fontSize:16,color:C.muted}}>MONGODB AGENTS IN CONTEXT · TORONTO</div>
  </>;
}

function Connect(){return <>
  <Copy label="01 / CONNECT" title={<>Your sources.<br/><span style={{color:C.brand}}>One workspace.</span></>} body="A repository. Its tickets. Its design decisions. Public context starts with a link.">
    <div style={{display:'flex',flexDirection:'column',gap:16}}><Pill><GitBranch size={22}/>apache/kafka</Pill><Pill color={C.blue}><Ticket size={22}/>Public Jira</Pill><Pill color={C.green}><BookOpen size={22}/>Public Confluence</Pill></div>
  </Copy>
  <Screen name="sources" x={660} y={155} w={1160} h={760} crop={{x:287,y:65,w:1225}}/>
</>}

function Investigate(){
  const f=useCurrentFrame();
  return <>
    <div style={{position:'absolute',left:100,top:105}}><Label>02 / ASK THE CODE WHY</Label><h1 style={{fontSize:62,letterSpacing:-2.5,lineHeight:1.08,margin:0}}>One question. <span style={{color:C.brand}}>Four perspectives.</span></h1></div>
    <Screen name={f<112?'selection':'agents'} x={95} y={270} w={1120} h={610} crop={f<112?{x:285,y:70,w:1225}:{x:1000,y:70,w:920}}/>
    <div style={{position:'absolute',left:1290,top:280,width:530,display:'flex',flexDirection:'column',gap:20}}>
      {([{label:'GitHub',detail:'Code · commits · pull requests',icon:GitBranch,color:C.text},{label:'Jira',detail:'Issues · context · resolutions',icon:Ticket,color:C.blue},{label:'Confluence',detail:'Proposals · architecture docs',icon:BookOpen,color:C.brand},{label:'Memory',detail:'Approved · scoped · unexpired',icon:Brain,color:C.green}]).map((a,i)=>{
        const p=rise(f,25+i*13);return <div key={a.label} style={{opacity:p,transform:`translateX(${(1-p)*45}px)`,border:`1px solid ${a.color}40`,borderRadius:16,padding:'20px 24px',background:`linear-gradient(110deg,${a.color}10,#111522)`}}><div style={{display:'flex',gap:14,alignItems:'center',fontSize:26,fontWeight:600}}><a.icon size={28} color={a.color}/>{a.label}<div style={{marginLeft:'auto',fontFamily:MONO,fontSize:13,color:a.color}}>SUB-AGENT</div></div><div style={{color:C.muted,fontSize:20,marginTop:9,marginLeft:42}}>{a.detail}</div></div>;
      })}
    </div>
  </>;
}

function Answer(){return <>
  <Copy label="03 / FOLLOW THE EVIDENCE" title={<>An answer<br/>you can <span style={{color:C.green}}>inspect.</span></>} body="See the recommendation and the evidence each agent actually retrieved.">
    <Pill color={C.green}><Check size={22}/>Sources stay visible</Pill>
    <div style={{marginTop:26,fontFamily:MONO,fontSize:17,color:C.muted,lineHeight:1.8}}>GitHub history<br/>Jira findings<br/>Confluence pages</div>
  </Copy>
  <Screen name="answer" x={850} y={140} w={760} h={785} crop={{x:1520,y:310,w:400}}/>
</>}

function Approve(){return <>
  <Copy label="04 / HUMAN APPROVAL" title={<>Knowledge waits<br/>for <span style={{color:C.amber}}>your approval.</span></>} body="A proposal is not an instruction. Only approved, eligible memory can influence the next answer.">
    <div style={{display:'flex',gap:14,alignItems:'center'}}><Pill color={C.amber}>Pending</Pill><ArrowRight color={C.muted}/><Pill color={C.green}>Active</Pill></div>
    <div style={{marginTop:30,fontFamily:MONO,fontSize:16,color:C.muted}}>ILLUSTRATIVE DEMO-TEAM POLICY</div>
  </Copy>
  <Screen name="approval" x={660} y={155} w={1160} h={760} crop={{x:288,y:70,w:1230}}/>
</>}

function Compare({changed=true}:{changed?:boolean}){
  const f=useCurrentFrame();
  return <>
    <div style={{position:'absolute',left:100,top:95}}><Label>05 / MEASURE THE DIFFERENCE</Label><h1 style={{fontSize:60,letterSpacing:-2.7,lineHeight:1.07,margin:0}}>Same question. Same evidence. <span style={{color:C.green}}>{changed?'Different guidance.':'An honest comparison.'}</span></h1></div>
    <Screen name="compare" x={100} y={250} w={1720} h={670} crop={{x:288,y:470,w:1230}}/>
    <div style={{position:'absolute',right:125,top:101,opacity:rise(f,20)}}><Pill color={C.green}><Brain size={22}/>Actual comparison</Pill></div>
    <div style={{position:'absolute',left:125,top:880,fontFamily:MONO,fontSize:15,color:C.muted,background:'#0a0e19ee',padding:'10px 14px',borderRadius:8}}>DEMO POLICY · captured backend results · elapsed time condensed</div>
  </>;
}

function Govern(){
  const f=useCurrentFrame();
  return <>
    <Copy label="06 / GOVERN THE LIFECYCLE" title={<>Memory with<br/><span style={{color:C.green}}>boundaries.</span></>} body="Atlas Vector Search filters memory before it reaches the model.">
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{['Tenant','Scope','Active status','Expiry'].map((s,i)=><div key={s} style={{opacity:rise(f,10+i*8)}}><Pill color={C.green}><LockKeyhole size={18}/>{s}</Pill></div>)}</div>
      <div style={{marginTop:32,fontSize:23,color:C.muted,lineHeight:1.8}}>Correct → a new version<br/>Revoke → excluded from retrieval</div>
    </Copy>
    <Screen name="memory" x={820} y={155} w={920} h={760} crop={{x:1035,y:interpolate(f,[0,155],[140,440],clamp),w:485}}/>
  </>;
}

function Outro(){
  const f=useCurrentFrame(),p=rise(f);
  return <>
    <div style={{position:'absolute',inset:0,opacity:0.11}}><Img src={staticFile('captures/architecture.png')} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
    <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse,#080a1199,#080a11)'}}/>
    <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',opacity:p,transform:`translateY(${(1-p)*25}px)`,paddingBottom:80}}>
      <Logo size={70}/><h1 style={{fontSize:66,fontWeight:600,letterSpacing:-2.7,textAlign:'center',lineHeight:1.16,margin:'38px 0 30px'}}>Understand the decision.<br/><span style={{color:C.green}}>Govern what your agent remembers.</span></h1>
      <div style={{display:'flex',alignItems:'center',gap:13,color:C.muted,fontSize:22}}><Database size={24} color={C.green}/>MongoDB Atlas + Vector Search<span style={{margin:'0 10px',color:'#48516e'}}>·</span>Memory You Can Govern</div>
      <div style={{fontFamily:MONO,fontSize:18,marginTop:32,color:C.brand}}>github.com/parthtyagi9/ArchMind</div>
    </div>
  </>;
}

const COMPONENTS={intro:Intro,connect:Connect,investigate:Investigate,answer:Answer,approve:Approve,compare:Compare,govern:Govern,outro:Outro};

export function ArchMindDemo({comparisonChanged=true}:{comparisonChanged?:boolean}){
  const f=useCurrentFrame();
  return <AbsoluteFill style={{fontFamily:FONT,color:C.text,background:C.bg}}>
    <Background/>
    {SCENES.map(s=>{
      const Scene=COMPONENTS[s.id];
      return <Sequence key={s.id} from={s.start*30} durationInFrames={(s.end-s.start)*30}>
        {s.id==='compare'?<Compare changed={comparisonChanged}/>:<Scene/>}
        <Audio src={staticFile(`audio/${s.id}.wav`)} volume={1}/>
        <div style={{position:'absolute',left:140,right:140,bottom:47,display:'flex',justifyContent:'center'}}><div style={{fontSize:25,lineHeight:1.35,textAlign:'center',maxWidth:1490,padding:'15px 28px',border:'1px solid #46516e55',borderRadius:13,background:'#080b14f2',color:'#e8ecff',boxShadow:'0 6px 30px #0006'}}>{s.caption}</div></div>
      </Sequence>;
    })}
    <Audio src={staticFile('audio/score.wav')} volume={frame=>interpolate(frame,[0,40,1730,1799],[0,0.13,0.13,0],clamp)}/>
    <div style={{position:'absolute',left:0,right:0,bottom:0,height:3,background:'#27304c'}}><div style={{height:'100%',width:`${f/1799*100}%`,background:'linear-gradient(90deg,#8f9eff,#50dfb5)'}}/></div>
    {f>=150&&f<1650&&<div style={{position:'absolute',left:100,top:47,display:'flex',alignItems:'center',gap:13}}><Logo size={25}/><div style={{height:20,width:1,background:C.line,margin:'0 7px'}}/><span style={{fontFamily:MONO,fontSize:13,letterSpacing:1.5,color:C.muted}}>PRODUCT WALKTHROUGH</span></div>}
  </AbsoluteFill>;
}
