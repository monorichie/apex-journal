import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as Papa from "papaparse";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine, PieChart, Pie, Area, AreaChart } from "recharts";

const SK = "apex-journal-v1";
const G="#22c55e",R="#ef4444",A="#f59e0b",AC="#06b6d4",BL="#6366f1",PK="#ec4899",MU="#64748b";
const ASSETS=["Forex","Crypto","Commodity","Index","Stock","Option","Futures"];
const DIRS=["Long","Short"];
const TAGS=["Scalp","Swing","Day Trade","Breakout","Reversal","Momentum","Mean Reversion","Liquidity Sweep","Order Block","FVG","BOS/CHoCH"];
const EMOTES=["Disciplined","Confident","Neutral","Anxious","FOMO","Revenge","Greedy","Patient","Frustrated"];
const PLAYBOOKS=["ICT Silver Bullet","London Killzone","NY AM Session","Asian Sweep","Break & Retest","Supply/Demand","Trend Continuation","Counter-Trend","News Play","Custom"];
const LOT_CAPS={XAUUSD:0.02,USOIL:0.02,USDJPY:0.15};
const RULES=[
  {id:"sl",icon:"🛡",label:"Always set a stop loss",desc:"With SL: +$958 | Without: -$2,176"},
  {id:"hold",icon:"⏱",label:"Min 30 min hold",desc:"<30 min trades lost -$3,336 at 23% WR"},
  {id:"streak",icon:"✋",label:"Stop after 2 consecutive losses",desc:"After 2+ losses WR drops to 28%"},
  {id:"lots",icon:"📏",label:"Lot size caps",desc:"XAU/OIL: 0.02 | JPY: 0.15"},
  {id:"days",icon:"📅",label:"Avoid Wed & Thu",desc:"Wed+Thu cost -$2,087 combined"},
];
const COL_MAP={
  ticker:["symbol","ticker","instrument"],direction:["type","direction","side"],
  entryPrice:["opening_price","entry price","open price","price"],exitPrice:["closing_price","exit price","close price"],
  quantity:["lots","quantity","qty","volume","original_position_size"],
  entryDate:["opening_time_utc","entry date","open date","date","time"],exitDate:["closing_time_utc","exit date","close date"],
  stopLoss:["stop_loss","stop loss","sl"],takeProfit:["take_profit","take profit","tp"],
  profit:["profit","pnl","p&l"],commission:["commission","fee"],swap:["swap","rollover"],
};

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function fC(v){if(v==null||isNaN(v))return"$0";return`${v>=0?"+":"-"}$${Math.abs(v).toFixed(2)}`;}
function fP(v){if(v==null||isNaN(v))return"0%";return`${v>=0?"+":""}${v.toFixed(1)}%`;}
function pnl(t){if(t.profit!=null&&t.profit!==0)return t.profit;if(!t.exitPrice||!t.entryPrice||!t.quantity)return null;return(t.exitPrice-t.entryPrice)*t.quantity*(t.direction==="Long"?1:-1);}
function hm(t){if(!t.entryDate||!t.exitDate)return 0;return(new Date(t.exitDate)-new Date(t.entryDate))/6e4;}
function gAsset(s){if(!s)return"Forex";const t=s.toUpperCase().replace(/M$/,"");if(/XA[UG]USD|XPTUSD/.test(t))return"Commodity";if(/BTC|ETH|LTC/.test(t))return"Crypto";if(/US30|NAS|SPX|DAX/.test(t))return"Index";if(/OIL|BRENT|GAS/.test(t))return"Commodity";if(t.length===6&&/^[A-Z]+$/.test(t))return"Forex";return"Stock";}
function autoMap(h){const m={},n=h.map(x=>x.toLowerCase().trim());for(const[f,al]of Object.entries(COL_MAP)){for(const a of al){const i=n.indexOf(a);if(i!==-1){m[f]=h[i];break;}}}return m;}
function parseDir(v){if(!v)return"Long";return/sell|short/i.test(v)?"Short":"Long";}
function parseD(v){if(!v)return"";try{const d=new Date(v);return isNaN(d)?"":d.toISOString().slice(0,16);}catch{return"";}}
function dayKey(d){return new Date(d).toISOString().slice(0,10);}
function violations(t,recent=[]){
  const v=[];const tk=t.ticker?.toUpperCase()||"";
  if(!t.stopLoss)v.push({r:"sl",m:"No stop loss"});
  for(const[s,mx]of Object.entries(LOT_CAPS))if(tk.includes(s)&&t.quantity>mx)v.push({r:"lots",m:`${tk} qty ${t.quantity} > ${mx}`});
  if(t.entryDate){const d=new Date(t.entryDate).getDay();if(d===3||d===4)v.push({r:"days",m:`Trading on ${d===3?"Wednesday":"Thursday"}`});}
  if(recent.length>=2&&recent.slice(0,2).every(x=>(pnl(x)||0)<0))v.push({r:"streak",m:"2+ consecutive losses"});
  return v;
}

// ─── Storage ───
function loadLocal(){try{const r=localStorage.getItem(SK);return r?JSON.parse(r):[];}catch{return[];}}
function save(trades){try{localStorage.setItem(SK,JSON.stringify(trades));}catch{}}
async function fetchRemote(){
  try{
    const r=await fetch("./trades.json?t="+Date.now());
    if(!r.ok)return null;
    const d=await r.json();
    return d;
  }catch{return null;}
}
function mergeRemoteLocal(remote,local){
  // Remote trades from MT5 sync agent are the source of truth for trade data
  // Local edits (tags, notes, emotions, playbook) are preserved
  if(!remote||!remote.trades)return local;
  const localMap={};
  local.forEach(t=>{if(t.id)localMap[t.id]=t;});
  const merged=remote.trades.map(t=>{
    const loc=localMap[t.id];
    if(loc){
      // Preserve local journal edits
      return{...t,tags:loc.tags||t.tags||[],emotion:loc.emotion||t.emotion||"",
        setup:loc.setup||t.setup||"",notes:loc.notes||t.notes||"",playbook:loc.playbook||t.playbook||""};
    }
    return t;
  });
  // Keep any manual-only local trades not from MT5
  local.forEach(t=>{if(t.id&&!remote.trades.find(r=>r.id===t.id)&&t.source!=="mt5")merged.push(t);});
  return merged;
}

// ─── Styles ───
const font="'Geist Mono',ui-monospace,monospace";
const fontS="'DM Sans',system-ui,sans-serif";
const css=`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap');
:root{--bg:#09090b;--s1:#18181b;--s2:#27272a;--b:#3f3f46;--t:#fafafa;--t2:#a1a1aa;--t3:#71717a;--ac:#06b6d4;--g:#22c55e;--r:#ef4444;--a:#f59e0b;--bl:#6366f1;--pk:#ec4899;}
*{box-sizing:border-box;margin:0;padding:0;}body{background:var(--bg);}
::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-track{background:var(--bg);}::-webkit-scrollbar-thumb{background:var(--b);border-radius:3px;}
input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
select option{background:var(--s1);color:var(--t);}`;

// ─── Components ───
const S={fontFamily:font};
const Card=({children,s={}})=><div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:8,padding:16,...s}}>{children}</div>;
const Label=({children})=><div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--t3)",...S,marginBottom:4}}>{children}</div>;
const Val=({children,c})=><div style={{fontSize:20,fontWeight:700,...S,color:c||"var(--t)",lineHeight:1.1}}>{children}</div>;
const Sub=({children})=><div style={{fontSize:10,color:"var(--t3)",...S,marginTop:3}}>{children}</div>;
const Sec=({children})=><div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--t3)",...S,marginBottom:10}}>{children}</div>;
const Inp=({label,...p})=><div style={{display:"flex",flexDirection:"column",gap:3}}>
  {label&&<label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S}}>{label}</label>}
  <input {...p} style={{background:"var(--bg)",border:"1px solid var(--b)",borderRadius:4,padding:"7px 9px",color:"var(--t)",fontSize:12,...S,outline:"none",...p.style}}/>
</div>;
const Sel=({label,options,...p})=><div style={{display:"flex",flexDirection:"column",gap:3}}>
  {label&&<label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S}}>{label}</label>}
  <select {...p} style={{background:"var(--bg)",border:"1px solid var(--b)",borderRadius:4,padding:"7px 9px",color:"var(--t)",fontSize:12,...S,outline:"none",cursor:"pointer"}}>
    {options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>;
const Pill=({children,on,onClick,c=AC})=><button onClick={onClick} style={{padding:"3px 10px",borderRadius:4,fontSize:10,...S,fontWeight:600,cursor:"pointer",
  border:`1px solid ${on?c:"var(--b)"}`,background:on?c+"18":"transparent",color:on?c:"var(--t3)",transition:"all .12s"}}>{children}</button>;
const Btn=({children,primary,danger,...p})=><button {...p} style={{padding:"7px 18px",borderRadius:5,fontSize:11,fontWeight:700,...S,cursor:"pointer",letterSpacing:"0.05em",
  background:primary?AC:danger?R+"20":"transparent",color:primary?"#000":danger?R:"var(--t2)",border:`1px solid ${primary?AC:danger?R+"50":"var(--b)"}`,transition:"all .12s",...p.style}}>{children}</button>;

const Stat=({label,value,sub,color})=><Card><Label>{label}</Label><Val c={color}>{value}</Val>{sub&&<Sub>{sub}</Sub>}</Card>;

const TT=({active,payload,label})=>{if(!active||!payload?.length)return null;
  return<div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:6,padding:"8px 12px",...S,fontSize:11}}>
    <div style={{color:"var(--t2)",marginBottom:4}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{color:p.color||"var(--t)"}}>{p.name}: {typeof p.value==="number"?`$${p.value.toFixed(2)}`:p.value}</div>)}
  </div>;};

// ─── Calendar Heatmap ───
function CalendarView({trades}){
  const closed=trades.filter(t=>t.exitPrice||t.profit);
  const daily={};
  closed.forEach(t=>{const d=dayKey(t.exitDate||t.entryDate);if(!daily[d])daily[d]={pnl:0,trades:0,wins:0};daily[d].pnl+=(pnl(t)||0);daily[d].trades++;if((pnl(t)||0)>0)daily[d].wins++;});
  const [month,setMonth]=useState(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [y,m]=[parseInt(month.slice(0,4)),parseInt(month.slice(5))-1];
  const first=new Date(y,m,1);const last=new Date(y,m+1,0);const startDay=first.getDay();const daysInMonth=last.getDate();
  const monthPnl=Object.entries(daily).filter(([k])=>k.startsWith(month)).reduce((s,[,v])=>s+v.pnl,0);
  const monthTrades=Object.entries(daily).filter(([k])=>k.startsWith(month)).reduce((s,[,v])=>s+v.trades,0);
  const greenDays=Object.entries(daily).filter(([k,v])=>k.startsWith(month)&&v.pnl>0).length;
  const redDays=Object.entries(daily).filter(([k,v])=>k.startsWith(month)&&v.pnl<0).length;
  const maxAbs=Math.max(...Object.entries(daily).filter(([k])=>k.startsWith(month)).map(([,v])=>Math.abs(v.pnl)),1);
  const prevM=()=>{const d=new Date(y,m-1,1);setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);};
  const nextM=()=>{const d=new Date(y,m+1,1);setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);};
  const cells=[];
  for(let i=0;i<startDay;i++)cells.push(null);
  for(let d=1;d<=daysInMonth;d++)cells.push(d);

  return<Card s={{marginBottom:16}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <button onClick={prevM} style={{background:"none",border:"none",color:"var(--t2)",cursor:"pointer",fontSize:16}}>‹</button>
        <span style={{fontSize:14,fontWeight:600,...S,color:"var(--t)",minWidth:140,textAlign:"center"}}>{new Date(y,m).toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>
        <button onClick={nextM} style={{background:"none",border:"none",color:"var(--t2)",cursor:"pointer",fontSize:16}}>›</button>
      </div>
      <div style={{display:"flex",gap:16,fontSize:11,...S}}>
        <span style={{color:monthPnl>=0?G:R}}>{fC(monthPnl)}</span>
        <span style={{color:"var(--t3)"}}>{monthTrades} trades</span>
        <span><span style={{color:G}}>{greenDays}G</span> / <span style={{color:R}}>{redDays}R</span></span>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:6}}>
      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"var(--t3)",...S,padding:"4px 0"}}>{d}</div>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
      {cells.map((d,i)=>{
        if(d===null) return<div key={`e${i}`}/>;
        const key=`${month}-${String(d).padStart(2,"0")}`;
        const data=daily[key];
        const intensity=data?Math.min(Math.abs(data.pnl)/maxAbs,1):0;
        const bg=data?(data.pnl>=0?`rgba(34,197,94,${0.15+intensity*0.55})`:`rgba(239,68,68,${0.15+intensity*0.55})`):"var(--bg)";
        return<div key={key} style={{aspectRatio:"1",borderRadius:4,background:bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          border:"1px solid var(--b)",cursor:data?"pointer":"default",transition:"all .15s",position:"relative"}}
          title={data?`${key}\n${data.trades} trades | ${data.wins}W\nP&L: ${fC(data.pnl)}`:key}>
          <span style={{fontSize:11,fontWeight:500,...S,color:data?"var(--t)":"var(--t3)"}}>{d}</span>
          {data&&<span style={{fontSize:8,fontWeight:700,...S,color:data.pnl>=0?G:R,marginTop:1}}>{data.pnl>=0?"+":""}${Math.abs(data.pnl).toFixed(0)}</span>}
        </div>;
      })}
    </div>
  </Card>;
}

// ─── Analytics Tab ───
function Analytics({trades}){
  const cl=useMemo(()=>trades.filter(t=>t.exitPrice||t.profit).sort((a,b)=>new Date(a.exitDate||a.entryDate)-new Date(b.exitDate||b.entryDate)),[trades]);
  const [sub,setSub]=useState("pairs");
  if(cl.length<3)return<Card><div style={{textAlign:"center",padding:40,color:"var(--t3)",...S}}>Need more trades for analytics</div></Card>;

  // Pair data
  const pm={};cl.forEach(t=>{const tk=t.ticker||"?";if(!pm[tk])pm[tk]={ticker:tk,t:0,w:0,l:0,pnl:0,lots:0};const p=pnl(t)||0;pm[tk].t++;pm[tk].pnl+=p;pm[tk].lots+=t.quantity||0;if(p>0)pm[tk].w++;else if(p<0)pm[tk].l++;});
  const ps=Object.values(pm).map(p=>({...p,wr:p.t?Math.round(p.w/p.t*100):0,avg:p.t?p.pnl/p.t:0})).sort((a,b)=>b.pnl-a.pnl);

  // Time of day
  const tod={};cl.forEach(t=>{if(!t.entryDate)return;const h=new Date(t.entryDate).getUTCHours();if(!tod[h])tod[h]={h,t:0,w:0,pnl:0};tod[h].t++;tod[h].pnl+=(pnl(t)||0);if((pnl(t)||0)>0)tod[h].w++;});
  const todData=Array.from({length:24},(_,h)=>({name:`${h}:00`,pnl:Math.round(tod[h]?.pnl||0),trades:tod[h]?.t||0,wr:tod[h]?.t?Math.round((tod[h].w/tod[h].t)*100):0}));

  // Day of week
  const dow=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dowData=dow.map((name,i)=>{const dt=cl.filter(t=>t.entryDate&&new Date(t.entryDate).getDay()===i);const w=dt.filter(t=>(pnl(t)||0)>0).length;
    return{name,pnl:Math.round(dt.reduce((s,t)=>s+(pnl(t)||0),0)),trades:dt.length,wr:dt.length?Math.round(w/dt.length*100):0};});

  // Hold time
  const holdBuckets=[["<5m",0,5],["5-30m",5,30],["30m-2h",30,120],["2-8h",120,480],["8h+",480,1e6]].map(([name,lo,hi])=>{
    const bt=cl.filter(t=>{const h=hm(t);return h>0&&h>=lo&&h<hi;});const p=bt.reduce((s,t)=>s+(pnl(t)||0),0);const w=bt.filter(t=>(pnl(t)||0)>0).length;
    return{name,pnl:Math.round(p),trades:bt.length,wr:bt.length?Math.round(w/bt.length*100):0};});

  // By playbook/strategy
  const strats={};cl.forEach(t=>{const s=t.playbook||"Untagged";if(!strats[s])strats[s]={name:s,t:0,w:0,l:0,pnl:0};strats[s].t++;strats[s].pnl+=(pnl(t)||0);if((pnl(t)||0)>0)strats[s].w++;else if((pnl(t)||0)<0)strats[s].l++;});
  const stratData=Object.values(strats).map(s=>({...s,wr:s.t?Math.round(s.w/s.t*100):0})).sort((a,b)=>b.pnl-a.pnl);

  // By emotion
  const emoData={};cl.forEach(t=>{const e=t.emotion||"None";if(!emoData[e])emoData[e]={name:e,t:0,w:0,pnl:0};emoData[e].t++;emoData[e].pnl+=(pnl(t)||0);if((pnl(t)||0)>0)emoData[e].w++;});
  const emotions=Object.values(emoData).map(e=>({...e,wr:e.t?Math.round(e.w/e.t*100):0})).sort((a,b)=>b.pnl-a.pnl);

  // Direction
  const longT=cl.filter(t=>t.direction==="Long"),shortT=cl.filter(t=>t.direction==="Short");
  const longPnl=longT.reduce((s,t)=>s+(pnl(t)||0),0),shortPnl=shortT.reduce((s,t)=>s+(pnl(t)||0),0);
  const longWR=longT.length?Math.round(longT.filter(t=>(pnl(t)||0)>0).length/longT.length*100):0;
  const shortWR=shortT.length?Math.round(shortT.filter(t=>(pnl(t)||0)>0).length/shortT.length*100):0;

  const tabs=[["pairs","Pairs"],["time","Time"],["dow","Day"],["hold","Hold Time"],["strat","Strategy"],["emo","Emotion"],["dir","Direction"]];

  const renderTable=(data,cols)=><div style={{maxHeight:300,overflow:"auto"}}>
    <div style={{display:"grid",gridTemplateColumns:cols.map(c=>c.w||"1fr").join(" "),gap:4,fontSize:9,color:"var(--t3)",...S,borderBottom:"1px solid var(--b)",paddingBottom:4,marginBottom:4,position:"sticky",top:0,background:"var(--s1)"}}>
      {cols.map(c=><div key={c.k} style={{textAlign:c.align||"left"}}>{c.label}</div>)}
    </div>
    {data.map((row,i)=><div key={i} style={{display:"grid",gridTemplateColumns:cols.map(c=>c.w||"1fr").join(" "),gap:4,fontSize:11,...S,padding:"5px 0",borderBottom:i<data.length-1?"1px solid var(--b)":"none",alignItems:"center"}}>
      {cols.map(c=><div key={c.k} style={{textAlign:c.align||"left",color:c.color?c.color(row):"var(--t)",...(c.style?c.style(row):{})}}>
        {c.render?c.render(row):row[c.k]}</div>)}
    </div>)}
  </div>;

  return<div>
    <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>{tabs.map(([k,l])=><Pill key={k} on={sub===k} onClick={()=>setSub(k)}>{l}</Pill>)}</div>
    {sub==="pairs"&&<Card>{renderTable(ps,[
      {k:"ticker",label:"Pair",w:"80px",style:r=>({fontWeight:700,color:r===ps[0]?AC:"var(--t)"})},
      {k:"pnl",label:"P&L",w:"80px",align:"right",render:r=>fC(r.pnl),color:r=>r.pnl>=0?G:R,style:()=>({fontWeight:700})},
      {k:"wr",label:"WR%",w:"50px",align:"center",render:r=>r.wr+"%",color:r=>r.wr>=50?G:R},
      {k:"t",label:"Trades",w:"50px",align:"center",color:()=>"var(--t3)"},
      {k:"w",label:"W",w:"35px",align:"center",color:()=>G},
      {k:"l",label:"L",w:"35px",align:"center",color:()=>R},
      {k:"avg",label:"Avg",w:"70px",align:"right",render:r=>"$"+r.avg.toFixed(2),color:r=>r.avg>=0?G:R},
    ])}</Card>}
    {sub==="time"&&<Card><Sec>P&L by hour (UTC)</Sec><ResponsiveContainer width="100%" height={200}>
      <BarChart data={todData}><CartesianGrid strokeDasharray="3 3" stroke="var(--b)"/>
        <XAxis dataKey="name" tick={{fill:MU,fontSize:9,...S}} interval={2}/><YAxis tick={{fill:MU,fontSize:9}} tickFormatter={v=>`$${v}`}/>
        <Tooltip content={<TT/>}/><Bar dataKey="pnl" radius={[2,2,0,0]}>{todData.map((d,i)=><Cell key={i} fill={d.pnl>=0?G:R}/>)}</Bar>
      </BarChart></ResponsiveContainer></Card>}
    {sub==="dow"&&<Card><Sec>P&L by day of week</Sec><ResponsiveContainer width="100%" height={200}>
      <BarChart data={dowData}><CartesianGrid strokeDasharray="3 3" stroke="var(--b)"/>
        <XAxis dataKey="name" tick={{fill:MU,fontSize:10,...S}}/><YAxis tick={{fill:MU,fontSize:9}} tickFormatter={v=>`$${v}`}/>
        <Tooltip content={<TT/>}/><Bar dataKey="pnl" radius={[3,3,0,0]}>{dowData.map((d,i)=><Cell key={i} fill={d.pnl>=0?G:R}/>)}</Bar>
      </BarChart></ResponsiveContainer>
      <div style={{display:"flex",justifyContent:"space-around",marginTop:8,fontSize:10,...S,color:"var(--t3)"}}>
        {dowData.map(d=><div key={d.name} style={{textAlign:"center"}}><div style={{color:d.wr>=45?G:d.wr>=35?A:R,fontWeight:700}}>{d.wr}%</div><div>{d.trades}t</div></div>)}</div>
    </Card>}
    {sub==="hold"&&<Card><Sec>P&L by hold time — patience pays</Sec><ResponsiveContainer width="100%" height={200}>
      <BarChart data={holdBuckets}><CartesianGrid strokeDasharray="3 3" stroke="var(--b)"/>
        <XAxis dataKey="name" tick={{fill:MU,fontSize:10,...S}}/><YAxis tick={{fill:MU,fontSize:9}} tickFormatter={v=>`$${v}`}/>
        <Tooltip content={<TT/>}/><Bar dataKey="pnl" radius={[3,3,0,0]}>{holdBuckets.map((d,i)=><Cell key={i} fill={d.pnl>=0?G:R}/>)}</Bar>
      </BarChart></ResponsiveContainer>
      <div style={{display:"flex",justifyContent:"space-around",marginTop:8,fontSize:10,...S,color:"var(--t3)"}}>
        {holdBuckets.map(d=><div key={d.name} style={{textAlign:"center"}}><div style={{color:d.wr>=40?G:R,fontWeight:700}}>{d.wr}% WR</div><div>{d.trades} trades</div></div>)}</div>
    </Card>}
    {sub==="strat"&&<Card><Sec>Performance by strategy / playbook</Sec>{renderTable(stratData,[
      {k:"name",label:"Strategy",w:"minmax(100px,1.5fr)",style:r=>({fontWeight:600,color:r===stratData[0]?AC:"var(--t)"})},
      {k:"pnl",label:"P&L",w:"80px",align:"right",render:r=>fC(r.pnl),color:r=>r.pnl>=0?G:R,style:()=>({fontWeight:700})},
      {k:"wr",label:"WR%",w:"50px",align:"center",render:r=>r.wr+"%",color:r=>r.wr>=50?G:R},
      {k:"t",label:"Trades",w:"50px",align:"center",color:()=>"var(--t3)"},
    ])}</Card>}
    {sub==="emo"&&<Card><Sec>Performance by emotion / mindset</Sec>{renderTable(emotions,[
      {k:"name",label:"Emotion",w:"100px",style:r=>({fontWeight:600,color:A})},
      {k:"pnl",label:"P&L",w:"80px",align:"right",render:r=>fC(r.pnl),color:r=>r.pnl>=0?G:R,style:()=>({fontWeight:700})},
      {k:"wr",label:"WR%",w:"50px",align:"center",render:r=>r.wr+"%",color:r=>r.wr>=50?G:R},
      {k:"t",label:"Trades",w:"50px",align:"center",color:()=>"var(--t3)"},
    ])}</Card>}
    {sub==="dir"&&<Card><Sec>Long vs short</Sec>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{background:"var(--bg)",borderRadius:6,padding:14,borderLeft:`3px solid ${G}`}}>
          <div style={{fontSize:10,color:"var(--t3)",...S}}>LONG ({longT.length} trades)</div>
          <div style={{fontSize:20,fontWeight:700,...S,color:longPnl>=0?G:R,margin:"4px 0"}}>{fC(longPnl)}</div>
          <div style={{fontSize:11,...S,color:"var(--t3)"}}>WR: {longWR}%</div></div>
        <div style={{background:"var(--bg)",borderRadius:6,padding:14,borderLeft:`3px solid ${R}`}}>
          <div style={{fontSize:10,color:"var(--t3)",...S}}>SHORT ({shortT.length} trades)</div>
          <div style={{fontSize:20,fontWeight:700,...S,color:shortPnl>=0?G:R,margin:"4px 0"}}>{fC(shortPnl)}</div>
          <div style={{fontSize:11,...S,color:"var(--t3)"}}>WR: {shortWR}%</div></div>
      </div>
    </Card>}
  </div>;
}

// ─── Trade Form ───
function TradeForm({onSave,edit,onCancel,recent}){
  const [t,sT]=useState(edit||{ticker:"",assetType:"Forex",direction:"Long",entryPrice:"",exitPrice:"",quantity:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",stopLoss:"",takeProfit:"",tags:[],emotion:"",setup:"",notes:"",playbook:"",profit:null});
  const [viol,setViol]=useState([]);
  useEffect(()=>{if(edit)sT(edit);},[edit]);
  const set=(k,v)=>sT(p=>{const n={...p,[k]:v};setViol(violations(n,recent||[]));return n;});
  const togTag=tag=>sT(p=>({...p,tags:p.tags.includes(tag)?p.tags.filter(x=>x!==tag):[...p.tags,tag]}));
  useEffect(()=>{setViol(violations(t,recent||[]));},[]);
  const submit=()=>{if(!t.ticker||!t.entryPrice)return;onSave({...t,id:t.id||uid(),entryPrice:+t.entryPrice,exitPrice:t.exitPrice?+t.exitPrice:null,quantity:t.quantity?+t.quantity:1,stopLoss:t.stopLoss?+t.stopLoss:null,takeProfit:t.takeProfit?+t.takeProfit:null,profit:t.profit?+t.profit:null,createdAt:t.createdAt||Date.now()});if(!edit)sT({ticker:"",assetType:"Forex",direction:"Long",entryPrice:"",exitPrice:"",quantity:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",stopLoss:"",takeProfit:"",tags:[],emotion:"",setup:"",notes:"",playbook:"",profit:null});};

  return<Card s={{marginBottom:16}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <span style={{fontSize:13,fontWeight:700,...S}}>{edit?"EDIT TRADE":"LOG TRADE"}</span>
      <div style={{width:28,height:3,background:AC,borderRadius:2}}/></div>
    {viol.length>0&&<div style={{marginBottom:12,padding:"8px 12px",borderRadius:5,background:R+"0a",border:`1px solid ${R}30`}}>
      <div style={{fontSize:10,fontWeight:700,color:R,...S,marginBottom:4}}>⚠ RULE VIOLATIONS</div>
      {viol.map((v,i)=><div key={i} style={{fontSize:10,color:R,...S}}>• {v.m}</div>)}</div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:12}}>
      <Inp label="Ticker" placeholder="XAUUSD" value={t.ticker} onChange={e=>set("ticker",e.target.value.toUpperCase())}/>
      <Sel label="Asset" options={ASSETS} value={t.assetType} onChange={e=>set("assetType",e.target.value)}/>
      <Sel label="Direction" options={DIRS} value={t.direction} onChange={e=>set("direction",e.target.value)}/>
      <Inp label="Qty / Lots" type="number" placeholder="0.02" value={t.quantity} onChange={e=>set("quantity",e.target.value)}/>
      <Inp label="Entry" type="number" step="0.001" value={t.entryPrice} onChange={e=>set("entryPrice",e.target.value)}/>
      <Inp label="Exit" type="number" step="0.001" value={t.exitPrice} onChange={e=>set("exitPrice",e.target.value)}/>
      <Inp label="Stop Loss" type="number" step="0.001" value={t.stopLoss} onChange={e=>set("stopLoss",e.target.value)}/>
      <Inp label="Take Profit" type="number" step="0.001" value={t.takeProfit} onChange={e=>set("takeProfit",e.target.value)}/>
      <Inp label="Entry Date" type="datetime-local" value={t.entryDate} onChange={e=>set("entryDate",e.target.value)}/>
      <Inp label="Exit Date" type="datetime-local" value={t.exitDate} onChange={e=>set("exitDate",e.target.value)}/>
      <Inp label="Profit (manual)" type="number" step="0.01" value={t.profit||""} onChange={e=>set("profit",e.target.value)}/>
      <Sel label="Playbook" options={["",  ...PLAYBOOKS]} value={t.playbook||""} onChange={e=>set("playbook",e.target.value)}/>
    </div>
    <div style={{marginBottom:10}}><label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S,display:"block",marginBottom:4}}>Setup Tags</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{TAGS.map(tag=><Pill key={tag} on={t.tags.includes(tag)} onClick={()=>togTag(tag)}>{tag}</Pill>)}</div></div>
    <div style={{marginBottom:10}}><label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S,display:"block",marginBottom:4}}>Emotion</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{EMOTES.map(em=><Pill key={em} on={t.emotion===em} onClick={()=>set("emotion",t.emotion===em?"":em)} c={A}>{em}</Pill>)}</div></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
      <div style={{display:"flex",flexDirection:"column",gap:3}}><label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S}}>Setup / Thesis</label>
        <textarea placeholder="Why did you enter?" value={t.setup} onChange={e=>set("setup",e.target.value)} style={{background:"var(--bg)",border:"1px solid var(--b)",borderRadius:4,padding:"7px 9px",color:"var(--t)",fontSize:12,...S,outline:"none",minHeight:50,resize:"vertical"}}/></div>
      <div style={{display:"flex",flexDirection:"column",gap:3}}><label style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--t3)",...S}}>Post-Trade Notes</label>
        <textarea placeholder="What did you learn?" value={t.notes} onChange={e=>set("notes",e.target.value)} style={{background:"var(--bg)",border:"1px solid var(--b)",borderRadius:4,padding:"7px 9px",color:"var(--t)",fontSize:12,...S,outline:"none",minHeight:50,resize:"vertical"}}/></div>
    </div>
    <div style={{display:"flex",gap:8}}><Btn primary onClick={submit}>{edit?"UPDATE":"SAVE TRADE"}</Btn>{edit&&<Btn onClick={onCancel}>CANCEL</Btn>}</div>
  </Card>;
}

// ─── CSV Importer ───
function CSVModal({onImport,onClose}){
  const [step,setStep]=useState("upload");const [data,setData]=useState(null);const [headers,setHeaders]=useState([]);
  const [map,setMap]=useState({});const [preview,setPrev]=useState([]);const [drag,setDrag]=useState(false);const ref=useRef();
  const FIELDS=[{k:"ticker",l:"Ticker *",req:true},{k:"direction",l:"Direction"},{k:"entryPrice",l:"Entry Price"},{k:"exitPrice",l:"Exit Price"},{k:"quantity",l:"Qty/Lots"},{k:"entryDate",l:"Entry Date"},{k:"exitDate",l:"Exit Date"},{k:"stopLoss",l:"Stop Loss"},{k:"takeProfit",l:"Take Profit"},{k:"profit",l:"Profit"},{k:"commission",l:"Commission"},{k:"swap",l:"Swap"}];
  const handleFile=f=>{if(!f)return;Papa.parse(f,{header:true,skipEmptyLines:true,complete:r=>{setHeaders(r.meta.fields||[]);setData(r.data);setMap(autoMap(r.meta.fields||[]));setStep("map");}});};
  const build=()=>{const ts=data.map(row=>{const tk=(row[map.ticker]||"").replace(/m$/i,"").toUpperCase();if(!tk)return null;
    return{id:uid(),ticker:tk,assetType:gAsset(row[map.ticker]),direction:parseDir(row[map.direction]),entryPrice:parseFloat(row[map.entryPrice])||null,exitPrice:parseFloat(row[map.exitPrice])||null,quantity:parseFloat(row[map.quantity])||1,
      entryDate:parseD(row[map.entryDate]),exitDate:parseD(row[map.exitDate]),stopLoss:map.stopLoss?parseFloat(row[map.stopLoss])||null:null,takeProfit:map.takeProfit?parseFloat(row[map.takeProfit])||null:null,
      profit:map.profit?parseFloat(row[map.profit])||null:null,commission:map.commission?parseFloat(row[map.commission])||null:null,swap:map.swap?parseFloat(row[map.swap])||null:null,
      tags:[],emotion:"",setup:"",notes:"",playbook:"",createdAt:Date.now(),source:"csv"};}).filter(Boolean);setPrev(ts);setStep("preview");};

  return<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.8)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:10,width:"100%",maxWidth:640,maxHeight:"85vh",overflow:"auto",padding:24}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
        <div><div style={{fontSize:9,letterSpacing:"0.2em",color:AC,fontWeight:700,...S}}>IMPORT</div>
          <div style={{fontSize:16,fontWeight:700,fontFamily:fontS}}>{step==="upload"?"Upload CSV":step==="map"?"Map Columns":"Preview"}</div></div>
        <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t3)",fontSize:18,cursor:"pointer"}}>✕</button></div>
      {step==="upload"&&<div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>ref.current?.click()}
        style={{border:`2px dashed ${drag?AC:"var(--b)"}`,borderRadius:8,padding:"40px 20px",textAlign:"center",cursor:"pointer"}}>
        <div style={{fontSize:28,marginBottom:8,opacity:.4}}>↑</div><div style={{fontSize:12,...S}}>Drop CSV or click to browse</div>
        <input ref={ref} type="file" accept=".csv" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/></div>}
      {step==="map"&&<><div style={{fontSize:11,...S,color:"var(--t3)",marginBottom:12}}>Found <strong style={{color:AC}}>{data.length}</strong> rows. Auto-mapped columns.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {FIELDS.map(f=><div key={f.k} style={{display:"flex",flexDirection:"column",gap:2}}>
            <label style={{fontSize:9,color:f.req&&!map[f.k]?R:"var(--t3)",...S}}>{f.l}</label>
            <select value={map[f.k]||""} onChange={e=>setMap(p=>({...p,[f.k]:e.target.value||undefined}))} style={{background:"var(--bg)",border:`1px solid ${map[f.k]?AC+"60":"var(--b)"}`,borderRadius:4,padding:"6px 8px",color:"var(--t)",fontSize:11,...S}}>
              <option value="">— skip —</option>{headers.map(h=><option key={h} value={h}>{h}</option>)}</select></div>)}</div>
        <Btn primary onClick={build} style={{opacity:map.ticker?1:.5}}>PREVIEW →</Btn></>}
      {step==="preview"&&<><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        <div style={{background:"var(--bg)",borderRadius:5,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"var(--t3)",...S}}>TRADES</div><div style={{fontSize:18,fontWeight:700,color:AC,...S}}>{preview.length}</div></div>
        <div style={{background:"var(--bg)",borderRadius:5,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"var(--t3)",...S}}>P&L</div><div style={{fontSize:18,fontWeight:700,color:preview.reduce((s,t)=>s+(pnl(t)||0),0)>=0?G:R,...S}}>{fC(preview.reduce((s,t)=>s+(pnl(t)||0),0))}</div></div>
        <div style={{background:"var(--bg)",borderRadius:5,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"var(--t3)",...S}}>PAIRS</div><div style={{fontSize:18,fontWeight:700,...S}}>{[...new Set(preview.map(t=>t.ticker))].length}</div></div></div>
        <Btn primary onClick={()=>{onImport(preview);onClose();}}>IMPORT {preview.length} TRADES ✓</Btn></>}
    </div></div>;
}

// ─── Trade Row ───
function TRow({trade:t,onEdit,onDelete}){
  const [open,setOpen]=useState(false);const p=pnl(t),w=p>0,l=p<0,isOpen=!t.exitPrice&&!t.profit;
  return<div style={{border:"1px solid var(--b)",borderRadius:6,marginBottom:5,borderLeft:`3px solid ${isOpen?AC:w?G:l?R:"var(--b)"}`,background:"var(--s1)"}}>
    <div onClick={()=>setOpen(!open)} style={{display:"grid",gridTemplateColumns:"70px 44px 44px 1fr 75px 28px",alignItems:"center",padding:"9px 12px",cursor:"pointer",gap:6,fontSize:11,...S}}>
      <div style={{fontWeight:700,fontSize:12,color:"var(--t)"}}>{t.ticker}</div>
      <div style={{color:t.direction==="Long"?G:R,fontWeight:600,fontSize:9}}>{t.direction==="Long"?"BUY":"SELL"}</div>
      <div style={{color:"var(--t3)",fontSize:9}}>{t.assetType?.slice(0,5)}</div>
      <div style={{color:"var(--t3)",fontSize:10}}>{t.entryDate?new Date(t.entryDate).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}{t.playbook?` · ${t.playbook}`:""}</div>
      <div style={{textAlign:"right",fontWeight:700,color:isOpen?AC:w?G:l?R:"var(--t3)"}}>{isOpen?"OPEN":fC(p)}</div>
      <div style={{textAlign:"center",color:"var(--t3)",fontSize:13,transform:open?"rotate(180deg)":"",transition:"transform .2s"}}>▾</div>
    </div>
    {open&&<div style={{padding:"0 12px 12px",borderTop:"1px solid var(--b)"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:8,padding:"10px 0",fontSize:10,...S}}>
        <div><span style={{color:"var(--t3)"}}>Entry:</span> ${t.entryPrice}</div>
        <div><span style={{color:"var(--t3)"}}>Exit:</span> {t.exitPrice?`$${t.exitPrice}`:"—"}</div>
        <div><span style={{color:"var(--t3)"}}>Qty:</span> {t.quantity}</div>
        {t.stopLoss!=null&&<div><span style={{color:"var(--t3)"}}>SL:</span> <span style={{color:R}}>${t.stopLoss}</span></div>}
        {hm(t)>0&&<div><span style={{color:"var(--t3)"}}>Hold:</span> {Math.round(hm(t))}m</div>}
        {t.emotion&&<div><span style={{color:"var(--t3)"}}>Emotion:</span> <span style={{color:A}}>{t.emotion}</span></div>}
        {t.playbook&&<div><span style={{color:"var(--t3)"}}>Playbook:</span> <span style={{color:BL}}>{t.playbook}</span></div>}
      </div>
      {t.tags?.length>0&&<div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>{t.tags.map(x=><span key={x} style={{fontSize:8,padding:"2px 6px",borderRadius:3,background:AC+"18",color:AC,...S,fontWeight:600}}>{x}</span>)}</div>}
      {t.setup&&<div style={{fontSize:11,color:"var(--t)",marginBottom:6,lineHeight:1.5}}><strong style={{color:"var(--t3)",fontSize:9}}>SETUP:</strong><br/>{t.setup}</div>}
      {t.notes&&<div style={{fontSize:11,color:"var(--t)",marginBottom:8,lineHeight:1.5}}><strong style={{color:"var(--t3)",fontSize:9}}>NOTES:</strong><br/>{t.notes}</div>}
      <div style={{display:"flex",gap:6}}><Btn onClick={()=>onEdit(t)} style={{fontSize:9,padding:"3px 10px"}}>EDIT</Btn><Btn danger onClick={()=>onDelete(t.id)} style={{fontSize:9,padding:"3px 10px"}}>DELETE</Btn></div>
    </div>}
  </div>;
}

// ─── Main App ───
export default function App(){
  const [trades,setTrades]=useState([]);const [view,setView]=useState("dashboard");const [edit,setEdit]=useState(null);
  const [filter,setFilter]=useState({search:"",dir:"",status:""});const [loading,setLoading]=useState(true);const [csv,setCsv]=useState(false);

  const [syncInfo,setSyncInfo]=useState(null);
  useEffect(()=>{
    const local=loadLocal();
    setTrades(local);
    setLoading(false);
    // Try fetching remote MT5 synced data
    fetchRemote().then(remote=>{
      if(remote&&remote.trades){
        const merged=mergeRemoteLocal(remote,local);
        setTrades(merged);
        save(merged);
        setSyncInfo({lastSync:remote.lastSync,account:remote.account});
      }
    });
  },[]);
  const sv=useCallback(nt=>{setTrades(nt);save(nt);},[]);
  const addOrUpdate=t=>{const i=trades.findIndex(x=>x.id===t.id);let u;if(i>=0){u=[...trades];u[i]=t;}else u=[t,...trades];sv(u);setEdit(null);setView("journal");};
  const del=id=>sv(trades.filter(t=>t.id!==id));
  const importCSV=imported=>{let m=[...trades];imported.forEach(t=>{if(!m.some(x=>x.ticker===t.ticker&&x.entryDate===t.entryDate&&x.entryPrice===t.entryPrice))m.push(t);});sv(m);setView("journal");};

  const stats=useMemo(()=>{
    const cl=trades.filter(t=>t.exitPrice||t.profit),op=trades.filter(t=>!t.exitPrice&&!t.profit);
    const pnls=cl.map(pnl).filter(v=>v!=null),w=pnls.filter(v=>v>0),l=pnls.filter(v=>v<0);
    const tot=pnls.reduce((a,b)=>a+b,0),wr=pnls.length?w.length/pnls.length*100:0,lr=pnls.length?l.length/pnls.length*100:0;
    const aw=w.length?w.reduce((a,b)=>a+b,0)/w.length:0,al=l.length?l.reduce((a,b)=>a+b,0)/l.length:0;
    const pf=Math.abs(al)?aw/Math.abs(al):0,rr=al?aw/Math.abs(al):0;
    const exp=pnls.length?(wr/100*aw+lr/100*al):0;
    const lg=pnls.length?Math.max(...pnls):0,ws=pnls.length?Math.min(...pnls):0;
    // Max DD
    let peak=0,dd=0,maxDD=0;const sorted=[...cl].sort((a,b)=>new Date(a.exitDate||a.entryDate)-new Date(b.exitDate||b.entryDate));
    let cum=0;sorted.forEach(t=>{cum+=(pnl(t)||0);if(cum>peak)peak=cum;dd=peak-cum;if(dd>maxDD)maxDD=dd;});
    // Equity
    cum=0;const eq=sorted.map(t=>{cum+=(pnl(t)||0);return{v:Math.round(cum*100)/100};});
    // SL
    const wSL=cl.filter(t=>t.stopLoss),nSL=cl.filter(t=>!t.stopLoss);
    return{total:trades.length,closed:cl.length,open:op.length,totalPnL:tot,winRate:wr,lossRate:lr,avgWin:aw,avgLoss:al,pf,rr,exp,lg,ws,maxDD,eq,
      wins:w.length,losses:l.length,slWith:{n:wSL.length,p:wSL.reduce((s,t)=>s+(pnl(t)||0),0)},slNo:{n:nSL.length,p:nSL.reduce((s,t)=>s+(pnl(t)||0),0)}};
  },[trades]);

  const filtered=useMemo(()=>trades.filter(t=>{
    if(filter.search&&!t.ticker?.toUpperCase().includes(filter.search.toUpperCase()))return false;
    if(filter.dir&&t.direction!==filter.dir)return false;
    if(filter.status==="Open"&&(t.exitPrice||t.profit))return false;
    if(filter.status==="Closed"&&!t.exitPrice&&!t.profit)return false;
    return true;
  }).sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate)),[trades,filter]);

  if(loading)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--bg)",color:"var(--t3)",...S}}>Loading...</div>;

  const navItems=[["dashboard","Dashboard"],["calendar","Calendar"],["journal","Journal"],["analytics","Analytics"],["rules","Rules"],["add","+ Trade"]];

  return<><style>{css}</style>
    {csv&&<CSVModal onImport={importCSV} onClose={()=>setCsv(false)}/>}
    <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--t)"}}>
      {/* Top bar */}
      <div style={{borderBottom:"1px solid var(--b)",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100,background:"var(--bg)",backdropFilter:"blur(12px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:AC}}/> 
          <span style={{fontSize:14,fontWeight:700,fontFamily:fontS,letterSpacing:"-0.02em"}}>APEX Journal</span>
          <span style={{fontSize:9,color:"var(--t3)",...S,marginLeft:4}}>{stats.total} trades</span>
          {syncInfo&&<span style={{fontSize:9,color:G,...S,marginLeft:8,display:"flex",alignItems:"center",gap:4}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:G,display:"inline-block"}}/>
            MT5 synced {syncInfo.account?.name?`· ${syncInfo.account.name}`:""}
          </span>}
        </div>
        <div style={{display:"flex",gap:3}}>
          {navItems.map(([k,l])=><button key={k} onClick={()=>{setView(k);if(k!=="add")setEdit(null);}}
            style={{padding:"5px 12px",fontSize:10,fontWeight:600,...S,letterSpacing:"0.04em",border:view===k?"1px solid var(--ac)":"1px solid transparent",borderRadius:4,cursor:"pointer",
              background:view===k?"var(--s1)":"transparent",color:view===k?AC:"var(--t3)",transition:"all .12s"}}>{l}</button>)}
          <button onClick={()=>setCsv(true)} style={{padding:"5px 12px",fontSize:10,fontWeight:600,...S,border:"1px solid "+BL+"60",borderRadius:4,cursor:"pointer",background:BL+"10",color:BL}}>↑ CSV</button>
        </div>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",padding:"20px 16px"}}>
        {/* Dashboard */}
        {view==="dashboard"&&<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:8,marginBottom:16}}>
            <Stat label="Net P&L" value={fC(stats.totalPnL)} color={stats.totalPnL>=0?G:R} sub={`${stats.closed} closed`}/>
            <Stat label="Win Rate" value={fP(stats.winRate).replace("+","")} color={stats.winRate>=50?G:R} sub={`${stats.wins}W / ${stats.losses}L`}/>
            <Stat label="Loss Rate" value={fP(stats.lossRate).replace("+","")} color={R}/>
            <Stat label="Profit Factor" value={stats.pf.toFixed(2)} color={stats.pf>=1.5?G:stats.pf>=1?A:R}/>
            <Stat label="Avg Win" value={fC(stats.avgWin)} color={G}/>
            <Stat label="Avg Loss" value={fC(stats.avgLoss)} color={R}/>
            <Stat label="R:R" value={stats.rr.toFixed(2)} color={stats.rr>=1?G:R}/>
            <Stat label="Expectancy" value={fC(stats.exp)} color={stats.exp>=0?G:R} sub="per trade"/>
            <Stat label="Max Drawdown" value={fC(-stats.maxDD)} color={R}/>
            <Stat label="Best / Worst" value={`${fC(stats.lg).slice(0,7)}`} color={G} sub={fC(stats.ws)}/>
          </div>
          {stats.eq.length>2&&<Card s={{marginBottom:16}}><Sec>Equity curve</Sec>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={stats.eq}><defs><linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={stats.eq[stats.eq.length-1]?.v>=0?G:R} stopOpacity={0.2}/><stop offset="95%" stopColor={stats.eq[stats.eq.length-1]?.v>=0?G:R} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--b)"/><YAxis tick={{fill:MU,fontSize:9}} tickFormatter={v=>`$${v}`}/>
                <ReferenceLine y={0} stroke="var(--b)" strokeDasharray="4 4"/>
                <Area dataKey="v" stroke={stats.eq[stats.eq.length-1]?.v>=0?G:R} fill="url(#eqG)" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <Card><Sec>Stop loss impact</Sec>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"var(--bg)",borderRadius:5,padding:10,textAlign:"center",borderLeft:`3px solid ${G}`}}>
                  <div style={{fontSize:9,color:"var(--t3)",...S}}>WITH SL ({stats.slWith.n})</div>
                  <div style={{fontSize:18,fontWeight:700,color:stats.slWith.p>=0?G:R,...S,margin:"3px 0"}}>{fC(stats.slWith.p)}</div></div>
                <div style={{background:"var(--bg)",borderRadius:5,padding:10,textAlign:"center",borderLeft:`3px solid ${R}`}}>
                  <div style={{fontSize:9,color:"var(--t3)",...S}}>WITHOUT SL ({stats.slNo.n})</div>
                  <div style={{fontSize:18,fontWeight:700,color:stats.slNo.p>=0?G:R,...S,margin:"3px 0"}}>{fC(stats.slNo.p)}</div></div>
              </div>
            </Card>
            <CalendarView trades={trades}/>
          </div>
          {trades.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:"var(--t3)",...S}}>
            <div style={{fontSize:28,opacity:.3,marginBottom:8}}>◇</div><div style={{fontSize:12}}>Import your trades with <span style={{color:BL}}>↑ CSV</span> or add manually</div></div>}
        </>}

        {/* Calendar */}
        {view==="calendar"&&<CalendarView trades={trades}/>}

        {/* Journal */}
        {view==="journal"&&<>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
            <Inp label="Ticker" placeholder="XAUUSD" value={filter.search} onChange={e=>setFilter(p=>({...p,search:e.target.value}))} style={{width:100}}/>
            <Sel label="Direction" options={["All",...DIRS]} value={filter.dir||"All"} onChange={e=>setFilter(p=>({...p,dir:e.target.value==="All"?"":e.target.value}))}/>
            <Sel label="Status" options={["All","Open","Closed"]} value={filter.status||"All"} onChange={e=>setFilter(p=>({...p,status:e.target.value==="All"?"":e.target.value}))}/>
            <div style={{fontSize:10,color:"var(--t3)",...S,paddingBottom:8,marginLeft:"auto"}}>{filtered.length} / {trades.length}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"70px 44px 44px 1fr 75px 28px",padding:"5px 12px",gap:6,fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--t3)",...S,borderBottom:"1px solid var(--b)",marginBottom:5}}>
            <div>Ticker</div><div>Side</div><div>Type</div><div>Date</div><div style={{textAlign:"right"}}>P&L</div><div/>
          </div>
          {filtered.map(t=><TRow key={t.id} trade={t} onEdit={t=>{setEdit(t);setView("add");}} onDelete={del}/>)}
          {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"var(--t3)",...S,fontSize:12}}>No trades match</div>}
        </>}

        {/* Analytics */}
        {view==="analytics"&&<Analytics trades={trades}/>}

        {/* Rules */}
        {view==="rules"&&<Card s={{borderLeft:`3px solid ${A}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <Sec>Trading rules</Sec><span style={{fontSize:10,color:"var(--t3)",...S}}>Data-driven from your history</span></div>
          {(()=>{const cl=trades.filter(t=>t.exitPrice||t.profit);const tot=cl.length||1;
            const v={sl:cl.filter(t=>!t.stopLoss).length,hold:cl.filter(t=>hm(t)>0&&hm(t)<30).length,
              lots:cl.filter(t=>{const tk=t.ticker?.toUpperCase();for(const[s,mx]of Object.entries(LOT_CAPS))if(tk?.includes(s)&&t.quantity>mx)return true;return false;}).length,
              days:cl.filter(t=>{if(!t.entryDate)return false;const d=new Date(t.entryDate).getDay();return d===3||d===4;}).length,streak:0};
            return RULES.map(r=>{const bad=v[r.id]>0&&r.id!=="streak";return<div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 12px",borderRadius:5,marginBottom:6,
              border:`1px solid ${bad?R+"30":"var(--b)"}`,background:bad?R+"06":"transparent"}}>
              <span style={{fontSize:16,width:24,textAlign:"center"}}>{r.icon}</span>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,...S}}>{r.label}</div><div style={{fontSize:10,color:"var(--t3)",...S,marginTop:2}}>{r.desc}</div></div>
              {bad&&<div style={{fontSize:10,fontWeight:700,color:R,...S}}>{v[r.id]} ({Math.round(v[r.id]/tot*100)}%)</div>}
              {!bad&&r.id!=="streak"&&<div style={{fontSize:10,fontWeight:600,color:G,...S}}>✓</div>}
            </div>;});})()}
          <div style={{marginTop:14,padding:"10px 12px",background:"var(--bg)",borderRadius:5,fontSize:11,...S,color:"var(--t3)"}}>
            <strong style={{color:AC}}>Lot caps:</strong> XAUUSD & USOIL → max 0.02 | USDJPY → max 0.15</div>
        </Card>}

        {/* Add/Edit */}
        {view==="add"&&<TradeForm onSave={addOrUpdate} edit={edit} onCancel={()=>{setEdit(null);setView("journal");}}
          recent={trades.filter(t=>t.exitPrice||t.profit).sort((a,b)=>new Date(b.exitDate||b.entryDate)-new Date(a.exitDate||a.entryDate))}/>}

        {/* Footer */}
        <div style={{marginTop:36,paddingTop:14,borderTop:"1px solid var(--b)",textAlign:"center",display:"flex",justifyContent:"center",gap:16,alignItems:"center"}}>
          <span style={{fontSize:9,color:"var(--t3)",...S,letterSpacing:"0.1em"}}>APEX JOURNAL · DATA PERSISTS ACROSS SESSIONS</span>
          {trades.length>0&&<button onClick={()=>{if(confirm("Clear all data?"))sv([]);}} style={{fontSize:9,color:R+"70",background:"none",border:"none",cursor:"pointer",...S}}>RESET</button>}
        </div>
      </div>
    </div>
  </>;
}
