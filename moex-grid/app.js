'use strict';
const $=id=>document.getElementById(id);
const P={
 IMOEXF:[.5,10,1.5,2,40,.5],
 CNYRUBF:[.001,1000,.58,.005,.20,.005],
 GAZPF:[.01,100,2.88,.05,3,.05],
 SLVRUBF:[.01,100,2.35,.05,4,.05],
 SBERF:[.01,100,8.38,.1,5,.1],
 GLDRUBF:[.1,1,1.51,2,150,2],
 USDRUBF:[.01,1000,3.86,.05,2,.05],
 EURRUBF:[.01,1000,4.54,.05,2,.05],
 RGBIF:[.01,100,.75,.05,2,.05]
};
let bars=[],results=[],sort='cycles',dir=-1,source='',reqId=0;
const f=(x,d=2)=>Number(x).toLocaleString('ru-RU',{maximumFractionDigits:d});
const day=ts=>new Date((ts+3*3600)*1000).toISOString().slice(0,10);
const sec=s=>Date.parse(s+'T00:00:00Z')/1000;
function status(msg,fail=false){$('message').textContent=msg;$('message').style.color=fail?'#ff7777':''}
function presets(){
 const x=P[$('symbol').value];
 ['tick','pointValue','fee','sFrom','sTo','sInc'].forEach((k,i)=>$(k).value=x[i]);
 invalidate();
}
function invalidate(){bars=[];results=[];$('analyze').disabled=true;['summary','charts','daySection','comparison'].forEach(k=>$(k).classList.add('hidden'))}
function dateDefaults(){
 const end=new Date();end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-13);
 const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 $('from').value=iso(start);$('to').value=iso(end);
}
async function json(url){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),16000);
 try{const r=await fetch(url,{signal:abort.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}
 finally{clearTimeout(timer)}
}
async function alor(symbol,from,to,id){
 const out=[];
 const end=sec(to)+86400;
 for(let t=sec(from);t<end;t+=2*86400){
  if(id!==reqId)throw Error('Запрос отменён');
  const u=new URL('https://api.alor.ru/md/v2/history');
  [['symbol',symbol],['exchange','MOEX'],['instrumentGroup','RFUD'],['tf','60'],['from',String(t)],['to',String(Math.min(t+2*86400,end)-1)],['format','Simple']].forEach(([k,v])=>u.searchParams.set(k,v));
  const data=await json(u);
  const rows=data.history||data.bars||data.data?.history||[];
  if(!Array.isArray(rows))throw Error('Ответ АЛОР без массива свечей');
  for(const v of rows){
   const b={t:Number(v.time??v.t),o:Number(v.open??v.o),h:Number(v.high??v.h),l:Number(v.low??v.l),c:Number(v.close??v.c)};
   if([b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.h>=b.l&&b.t>1e9)out.push(b);
  }
  status('АЛОР: '+out.length+' минутных свечей...');
 }
 if(!out.length)throw Error('Нет истории у АЛОР');
 return out;
}
async function moex(symbol,from,to,id){
 const out=[];
 for(let offset=0;offset<130000;){
  if(id!==reqId)throw Error('Запрос отменён');
  const u=new URL('https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/'+encodeURIComponent(symbol)+'/candles.json');
  [['from',from],['till',to],['interval','1'],['start',String(offset)],['iss.meta','off'],['iss.only','candles']].forEach(([k,v])=>u.searchParams.set(k,v));
  const data=await json(u),block=data.candles;
  if(!block?.data||!block?.columns)throw Error('Некорректный ответ ISS');
  const idx=Object.fromEntries(block.columns.map((name,i)=>[name,i]));
  for(const row of block.data){
   const t=Date.parse(String(row[idx.begin]).replace(' ','T')+'+03:00')/1000;
   const b={t,o:Number(row[idx.open]),h:Number(row[idx.high]),l:Number(row[idx.low]),c:Number(row[idx.close])};
   if([b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.h>=b.l)out.push(b);
  }
  offset+=block.data.length;
  status('MOEX: '+out.length+' минутных свечей...');
  if(!block.data.length||block.data.length<100)break;
 }
 if(!out.length)throw Error('Нет минутных свечей ISS');
 return out;
}
async function load(reverse=false){
 const id=++reqId,symbol=$('symbol').value,from=$('from').value,to=$('to').value;
 invalidate();
 if(!from||!to||from>to||sec(to)-sec(from)>31*86400){status('Период: от 1 до 31 дня, даты по порядку.',true);return}
 $('load').disabled=true;$('refresh').disabled=true;status('Запрашиваю реальные минутные котировки...');
 const methods=reverse?[['АЛОР',alor],['MOEX ISS',moex]]:[['MOEX ISS',moex],['АЛОР',alor]];
 const errs=[];
 try{
  for(const [name,fn] of methods){
   try{
    const got=await fn(symbol,from,to,id);
    if(id!==reqId)return;
    const uniq=new Map(got.map(b=>[b.t,b]));
    bars=[...uniq.values()].sort((a,b)=>a.t-b.t);source=name;
    if(bars.length<2)throw Error('Слишком мало свечей');
    $('source').textContent='Источник: '+name;
    status(name+': '+f(bars.length,0)+' реальных M1 свечей. Начинаю расчёт.');
    $('analyze').disabled=false;analyze();
    return;
   }catch(e){errs.push(name+': '+e.message);status(name+' недоступен, пробую резервный источник...')}
  }
  status('Нет котировок. '+errs.join(' | ')+'. Значения не подменяются демонстрационными.',true);
 }finally{$('load').disabled=false;$('refresh').disabled=false}
}
function simulation(step,c){
 const longs=new Set(),shorts=new Set(),counts=new Map();
 let cycles=0,executions=0;
 const anchor=Math.round(bars[0].c/c.tick)*c.tick;
 const eps=Math.max(1e-11,c.tick/1e5);
 const record=(t)=>{const key=day(t);if(!counts.has(key))counts.set(key,0);counts.set(key,counts.get(key)+1)};
 for(let i=1;i<bars.length;i++){
  const a=bars[i-1],b=bars[i];
  // No invented execution inside gaps or across minutes with missing history.
  if(b.t-a.t>90||b.t<=a.t)continue;
  const x=a.c,y=b.c;
  if(y>x+eps){
   let k=Math.floor((x-anchor)/step+eps)+1;
   const end=Math.floor((y-anchor)/step+eps);
   if(end-k>10000)throw Error('Шаг слишком мал');
   for(;k<=end;k++){
    executions++;
    if(longs.delete(k)){cycles++;record(b.t)}
    else if(!shorts.has(k-1))shorts.add(k-1);
   }
  }else if(y<x-eps){
   let k=Math.ceil((x-anchor)/step-eps)-1;
   const end=Math.ceil((y-anchor)/step-eps);
   if(k-end>10000)throw Error('Шаг слишком мал');
   for(;k>=end;k--){
    executions++;
    if(shorts.delete(k)){cycles++;record(b.t)}
    else if(!longs.has(k+1))longs.add(k+1);
   }
  }
 }
 const dates=[...new Set(bars.map(b=>day(b.t)))].sort();
 const nums=dates.map(d=>counts.get(d)||0),ordered=[...nums].sort((a,b)=>a-b);
 const median=ordered.length?(ordered.length%2?ordered[ordered.length>>1]:(ordered[ordered.length/2-1]+ordered[ordered.length/2])/2):0;
 const netUnit=(step*c.pointValue-2*c.fee)*c.qty;
 return{step,cycles,executions,opened:longs.size+shorts.size,avg:cycles/dates.length,median,fees:cycles*2*c.fee*c.qty,gross:cycles*step*c.pointValue*c.qty,net:cycles*netUnit,netUnit,days:dates.map(d=>({date:d,count:counts.get(d)||0}))};
}
function canvas(id,labels,values){
 const el=$(id),width=Math.max(250,el.clientWidth),height=el.clientHeight||210,pixel=window.devicePixelRatio||1;
 el.width=width*pixel;el.height=height*pixel;
 const ctx=el.getContext('2d');ctx.scale(pixel,pixel);
 const left=54,right=14,top=12,bottom=28;
 let lo=Math.min(0,...values),hi=Math.max(1,...values);
 if(hi===lo)hi=lo+1;
 const pad=(hi-lo)*.07;lo-=pad;hi+=pad;
 const px=i=>left+(width-left-right)*(labels.length<2?.5:i/(labels.length-1));
 const py=v=>top+(height-top-bottom)*(hi-v)/(hi-lo);
 ctx.font='11px system-ui';ctx.lineWidth=1;ctx.fillStyle='#a2afbc';
 for(let t=0;t<=4;t++){
  const y=top+(height-top-bottom)*t/4;
  ctx.strokeStyle='#3c4857';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();
  ctx.fillText(f(hi-(hi-lo)*t/4,1),4,y+4);
 }
 ctx.strokeStyle='#60a5fa';ctx.lineWidth=2;ctx.beginPath();
 values.forEach((v,i)=>i?ctx.lineTo(px(i),py(v)):ctx.moveTo(px(i),py(v)));ctx.stroke();
 ctx.fillStyle='#a2afbc';
 for(let t=0;t<Math.min(labels.length,6);t++){
  const i=Math.round(t*(labels.length-1)/(Math.min(labels.length,6)-1));
  ctx.fillText(String(labels[i]).slice(-7),Math.max(left,px(i)-18),height-8);
 }
}
function render(){
 const sorted=[...results].sort((a,b)=>(a[sort]===b[sort]?0:(a[sort]>b[sort]?1:-1)*dir));
 $('rows').innerHTML=sorted.map(r=>'<tr><td>'+f(r.step,5)+'</td><td>'+r.cycles+'</td><td>'+f(r.avg)+'</td><td>'+f(r.median)+'</td><td>'+r.executions+'</td><td>'+r.opened+'</td><td>'+f(r.gross)+'</td><td>'+f(r.fees)+'</td><td class="'+(r.net<0?'bad':'good')+'">'+f(r.net)+'</td></tr>').join('');
}
function showDay(){
 const selected=Number($('dayStep').value);
 const row=results.find(r=>Math.abs(r.step-selected)<1e-9)||results[0];
 if(!row)return;
 $('dayRows').innerHTML=row.days.map(d=>'<tr><td>'+d.date+'</td><td>'+d.count+'</td><td>'+f(d.count*row.netUnit)+'</td></tr>').join('');
 canvas('dayChart',row.days.map(x=>x.date.slice(5)),row.days.map(x=>x.count));
}
function analyze(){
 if(!bars.length)return;
 try{
  const c={tick:Number($('tick').value),pointValue:Number($('pointValue').value),fee:Number($('fee').value),qty:Number($('qty').value)};
  const start=Number($('sFrom').value),end=Number($('sTo').value),inc=Number($('sInc').value);
  if(!(c.tick>0&&c.pointValue>0&&c.fee>=0&&c.qty>=1&&start>0&&end>=start&&inc>0))throw Error('Некорректные параметры');
  if((end-start)/inc>1000)throw Error('Слишком много шагов (макс. 1000)');
  const steps=new Map();
  for(let n=0;start+n*inc<=end+inc*1e-7;n++){
   const step=Math.round((start+n*inc)/c.tick)*c.tick;
   if(step>0&&!steps.has(step))steps.set(step,simulation(step,c));
  }
  results=[...steps.values()].sort((a,b)=>a.step-b.step);
  if(!results.length)throw Error('Нет шагов');
  const bc=[...results].sort((a,b)=>b.cycles-a.cycles||b.net-a.net)[0];
  const bp=[...results].sort((a,b)=>b.net-a.net||b.cycles-a.cycles)[0];
  $('topCount').textContent=f(bc.step,5)+' → '+bc.cycles;
  $('topProfit').textContent=f(bp.step,5)+' → '+f(bp.net)+' ₽';
  $('count').textContent=f(bars.length,0)+' / '+bc.days.length;
  $('origin').textContent=source;
  $('dayStep').innerHTML=results.map(x=>'<option value="'+x.step+'">'+f(x.step,5)+'</option>').join('');
  $('dayStep').value=String(bc.step);
  ['summary','charts','daySection','comparison'].forEach(k=>$(k).classList.remove('hidden'));
  render();canvas('stepChart',results.map(x=>x.step),results.map(x=>x.avg));canvas('profitChart',results.map(x=>x.step),results.map(x=>x.net/x.days.length));showDay();
  status('Расчёт завершён: '+f(bars.length,0)+' M1 свечей из '+source+'. Результаты моделирования не являются подтверждёнными исполнениями.');
 }catch(e){status('Ошибка анализа: '+e.message,true)}
}
$('symbol').addEventListener('change',presets);
$('from').addEventListener('change',invalidate);$('to').addEventListener('change',invalidate);
$('load').addEventListener('click',()=>load(false));
$('refresh').addEventListener('click',()=>load(true));
$('analyze').addEventListener('click',analyze);
$('dayStep').addEventListener('change',showDay);
document.querySelectorAll('th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(sort===k)dir=-dir;else{sort=k;dir=-1}render()}));
window.addEventListener('resize',()=>{if(!results.length)return;canvas('stepChart',results.map(x=>x.step),results.map(x=>x.avg));canvas('profitChart',results.map(x=>x.step),results.map(x=>x.net/x.days.length));showDay()});
dateDefaults();presets();load(false);