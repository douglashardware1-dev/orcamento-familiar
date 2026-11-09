(() => {
const Cap = window.Capacitor;
const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plug = n => native ? Cap.registerPlugin(n) : null;
const Prefs = plug('Preferences'), LN = plug('LocalNotifications'), ShareP = plug('Share'), AppP = plug('App');

const CATS = [
  {k:'receita',  n:'Receitas',           short:'Receita',   num:'1', prev:'Previsto',     real:'Recebido', add:'Adicionar receita', entrada:true},
  {k:'fixas',    n:'Despesas fixas',     short:'Fixas',     num:'2', prev:'Provisionado', real:'Gasto',    add:'Adicionar despesa fixa', conta:true},
  {k:'cartao',   n:'Cartão de crédito',  short:'Cartão',    num:'3', prev:'Provisionado', real:'Gasto',    add:'Adicionar compra no cartão', conta:true},
  {k:'variaveis',n:'Despesas variáveis', short:'Variáveis', num:'4', prev:'Provisionado', real:'Gasto',    add:'Adicionar despesa variável', conta:true},
  {k:'aplicacao',n:'Aplicações',         short:'Aplicações',num:'5', prev:'Planejado',    real:'Aplicado', add:'Adicionar aplicação', invest:true},
];
const CAT = Object.fromEntries(CATS.map(c=>[c.k,c]));
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const brl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt = v => brl.format(v||0);
const nbr = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fn = v => nbr.format(v||0);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
function parseBRL(s){
  s=String(s??'').trim().replace(/[R$\s]/g,'');
  if(!s) return 0;
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  const n=parseFloat(s); return isFinite(n)?Math.round(n*100)/100:0;
}
const toInput = v => v ? String((+v).toFixed(2)).replace('.',',') : '';
const daysIn = (y,m) => new Date(y,m+1,0).getDate();

/* ---------- Armazenamento no aparelho ---------- */
const STORE_KEY = 'orcamento-v1';
let store = {meses:{}, cfg:{notif:false, dias:3, hora:9, semanal:true, tab:'receita', avisoVisto:false}};
async function loadStore(){
  try{
    let raw = null;
    if(Prefs){ raw = (await Prefs.get({key:STORE_KEY})).value; }
    else { try{ raw = localStorage.getItem(STORE_KEY); }catch(e){} }
    if(raw){ const s = JSON.parse(raw); store.meses = s.meses||{}; store.cfg = {...store.cfg, ...(s.cfg||{})}; }
  }catch(e){ toast('Não consegui ler os dados salvos.'); }
}
let saveTimer=null;
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    const raw = JSON.stringify(store);
    try{ if(Prefs) await Prefs.set({key:STORE_KEY, value:raw}); else localStorage.setItem(STORE_KEY, raw); }
    catch(e){ toast('Não consegui salvar. Tente de novo.'); }
    scheduleNotifications();
  }, 300);
}

let now = new Date();
let Y = now.getFullYear(), M = now.getMonth();
let tab = store.cfg.tab;
let data;
let edit = null;      // editor de item
let panel = null;     // 'config' | null
let restoreArmed = false;
let repArmed = false;

const keyOf = (y,m) => `m-${y}-${String(m+1).padStart(2,'0')}`;
const curKey = () => keyOf(Y,M);
const prevYM = () => M===0 ? [Y-1,11] : [Y,M-1];
const addYM = (y,m,k) => { const t=y*12+m+k; return [Math.floor(t/12), ((t%12)+12)%12]; };
const serieOf = i => i.serie || i.id;
function itemAnterior(y,m,i){
  const [py,pm]=addYM(y,m,-1); const p=store.meses[keyOf(py,pm)];
  const q=p?.itens?.find(x=>x.cat==='aplicacao' && serieOf(x)===serieOf(i));
  return q ? {y:py,m:pm,item:q} : null;
}
// Saldo da aplicação antes do mês: vem do mês anterior quando a mesma aplicação existe lá
function saldoAnt(y,m,i,depth=0){
  const a = depth<240 ? itemAnterior(y,m,i) : null;
  return a ? saldoAnt(a.y,a.m,a.item,depth+1)+(+a.item.realizado||0) : (+i.saldo||0);
}
function ultimoMesAntes(k){ return Object.keys(store.meses).filter(x=>/^m-\d{4}-\d{2}$/.test(x) && x<k).sort().pop() || null; }
const ymOfKey = k => { const [,y,m]=/^m-(\d{4})-(\d{2})$/.exec(k); return [+y,+m-1]; };
const mesesEntre = (a,b) => { const [ya,ma]=ymOfKey(a), [yb,mb]=ymOfKey(b); return (yb*12+mb)-(ya*12+ma); };
function openMonth(){ data = store.meses[curKey()] || null; render(); }
function save(){ data.atualizado = new Date().toISOString(); store.meses[curKey()] = data; persist(); render(); }

/* ---------- Cálculos ---------- */
function sums(d,y=Y,m=M){
  const r={};
  CATS.forEach(c=>{ const it=(d?.itens||[]).filter(i=>i.cat===c.k); r[c.k]={p:it.reduce((a,i)=>a+(+i.previsto||0),0), g:it.reduce((a,i)=>a+(+i.realizado||0),0), n:it.length, pagos:it.filter(i=>i.pago).length}; });
  r.desp={p:r.fixas.p+r.cartao.p+r.variaveis.p, g:r.fixas.g+r.cartao.g+r.variaveis.g};
  r.saldo={p:r.receita.p-r.desp.p, g:r.receita.g-r.desp.g};
  r.sobra={p:r.saldo.p-r.aplicacao.p, g:r.saldo.g-r.aplicacao.g};
  r.patrimonio=(d?.itens||[]).filter(i=>i.cat==='aplicacao').reduce((a,i)=>a+saldoAnt(y,m,i)+(+i.realizado||0),0);
  return r;
}
function contasAbertas(y,m,d){
  return (d?.itens||[]).filter(i=>CAT[i.cat]?.conta && !i.pago && i.venc).map(i=>({...i, dia:Math.min(i.venc, daysIn(y,m)), valor:(+i.previsto||0)-(+i.realizado||0)>0?(+i.previsto||0):(+i.previsto||0)}));
}

/* ---------- Criar mês ---------- */
function copiaItens(itens,k){
  const out=[];
  (itens||[]).forEach(i=>{
    const n={...i,id:uid(),serie:serieOf(i),realizado:0,pago:false};
    if(i.cat==='cartao' && i.parcAtual && i.parcTotal){ n.parcAtual=i.parcAtual+k; if(n.parcAtual>i.parcTotal) return; }
    out.push(n);
  });
  return out;
}
function createMonth(how){
  let itens=[];
  const src=ultimoMesAntes(curKey());
  if((how==='copiar'||how==='copiar12') && src) itens=copiaItens(store.meses[src].itens, mesesEntre(src,curKey()));
  data={itens,obs:'',criado:new Date().toISOString()};
  save();
  if(how==='copiar12') replicar(12);
}
// Copia o mês aberto para os próximos n meses que ainda não foram montados
function replicar(n){
  let criados=0, mantidos=0;
  for(let j=1;j<=n;j++){
    const [y,m]=addYM(Y,M,j), k=keyOf(y,m);
    if(store.meses[k]){ mantidos++; continue; }
    store.meses[k]={itens:copiaItens(data.itens,j),obs:'',criado:new Date().toISOString(),auto:true};
    criados++;
  }
  persist(); render();
  const [ly,lm]=addYM(Y,M,n);
  toast(criados ? `${criados} ${criados===1?'mês preenchido':'meses preenchidos'} até ${MESES[lm]}/${ly}${mantidos?` · ${mantidos} já ${mantidos===1?'existia e foi mantido':'existiam e foram mantidos'}`:''}.` : 'Os próximos 12 meses já estavam montados.');
}

/* ---------- Notificações ---------- */
async function notifPermission(ask){
  if(!LN) return 'indisponivel';
  try{
    let p = await LN.checkPermissions();
    if(p.display!=='granted' && ask) p = await LN.requestPermissions();
    return p.display;
  }catch(e){ return 'denied'; }
}
let scheduling=false, scheduleAgain=false;
async function scheduleNotifications(){
  if(!LN) return;
  if(scheduling){ scheduleAgain=true; return; }
  scheduling=true;
  try{
    const pend = await LN.getPending();
    if(pend.notifications?.length) await LN.cancel({notifications: pend.notifications.map(n=>({id:n.id}))});
    if(!store.cfg.notif) return;
    if((await notifPermission(false))!=='granted') return;
    const cfg = store.cfg, nowD = new Date(), list=[]; let id=1;
    const byDate = new Map();
    const add = (date, kind, item) => { if(date<=nowD) return; const k=date.getTime(); if(!byDate.has(k)) byDate.set(k,{date,lead:[],due:[]}); byDate.get(k)[kind].push(item); };
    for(let off=0; off<2; off++){
      const y = nowD.getFullYear() + Math.floor((nowD.getMonth()+off)/12), m=(nowD.getMonth()+off)%12;
      const d = store.meses[keyOf(y,m)]; if(!d) continue;
      contasAbertas(y,m,d).forEach(i=>{
        add(new Date(y,m,i.dia,cfg.hora,0,0), 'due', i);
        if(cfg.dias>0) add(new Date(y,m,i.dia-cfg.dias,cfg.hora,0,0), 'lead', i);
      });
    }
    const linha = i => `${i.nome} – ${fmt(i.previsto)}`;
    [...byDate.values()].sort((a,b)=>a.date-b.date).slice(0,60).forEach(g=>{
      if(g.due.length){
        const tot=g.due.reduce((a,i)=>a+(+i.previsto||0),0);
        list.push({id:id++, title: g.due.length===1?`Vence hoje: ${g.due[0].nome}`:`${g.due.length} contas vencem hoje (${fmt(tot)})`, body: g.due.map(linha).join('\n'), largeBody:g.due.map(linha).join('\n'), schedule:{at:g.date, allowWhileIdle:true}, smallIcon:'ic_stat_notify', iconColor:'#0E6E55'});
      }
      if(g.lead.length){
        const tot=g.lead.reduce((a,i)=>a+(+i.previsto||0),0); const dd=cfg.dias;
        list.push({id:id++, title: g.lead.length===1?`Em ${dd} dia${dd>1?'s':''} vence: ${g.lead[0].nome}`:`${g.lead.length} contas vencem em ${dd} dia${dd>1?'s':''} (${fmt(tot)})`, body: g.lead.map(linha).join('\n'), largeBody:g.lead.map(linha).join('\n'), schedule:{at:g.date, allowWhileIdle:true}, smallIcon:'ic_stat_notify', iconColor:'#0E6E55'});
      }
    });
    if(cfg.semanal){
      const d = store.meses[keyOf(nowD.getFullYear(), nowD.getMonth())];
      if(d){
        const s=sums(d);
        const next = new Date(nowD); next.setHours(cfg.hora,0,0,0);
        do { next.setDate(next.getDate()+1); } while(next.getDay()!==1);
        const abertas = contasAbertas(nowD.getFullYear(), nowD.getMonth(), d);
        const falta = abertas.reduce((a,i)=>a+(+i.previsto||0),0);
        const body = `Saldo realizado: ${fmt(s.saldo.g)} (provisionado ${fmt(s.saldo.p)}). ${abertas.length} conta${abertas.length===1?'':'s'} em aberto: ${fmt(falta)}.`;
        list.push({id:id++, title:`Resumo de ${MESES[nowD.getMonth()]}`, body, largeBody:body, schedule:{at:next, allowWhileIdle:true}, smallIcon:'ic_stat_notify', iconColor:'#0E6E55'});
      }
    }
    if(list.length) await LN.schedule({notifications:list});
  }catch(e){ console.log('notif', e); }
  finally{ scheduling=false; if(scheduleAgain){ scheduleAgain=false; scheduleNotifications(); } }
}

/* ---------- Resumo para WhatsApp ---------- */
function resumoTexto(){
  const s=sums(data); const ab=contasAbertas(Y,M,data).sort((a,b)=>a.dia-b.dia);
  const L=[`*Orçamento – ${MESES[M]}/${Y}*`, '',
    `Receitas: ${fmt(s.receita.g)} recebido de ${fmt(s.receita.p)}`,
    `Despesas: ${fmt(s.desp.g)} gasto de ${fmt(s.desp.p)} provisionado`,
    `Aplicações: ${fmt(s.aplicacao.g)}`,
    `*Saldo realizado: ${fmt(s.saldo.g)}*  (provisionado ${fmt(s.saldo.p)})`];
  if(ab.length){ L.push('', '*Contas em aberto:*'); ab.forEach(i=>L.push(`• dia ${String(i.dia).padStart(2,'0')} – ${i.nome}: ${fmt(i.previsto)}`)); }
  else L.push('', 'Nenhuma conta em aberto.');
  return L.join('\n');
}
async function compartilhar(text, title){
  if(ShareP){ try{ await ShareP.share({title, text, dialogTitle:'Enviar para…'}); return; }catch(e){ if(String(e?.message||'').toLowerCase().includes('cancel')) return; } }
  try{ await navigator.clipboard.writeText(text); toast('Texto copiado. Cole no WhatsApp.'); }catch(e){ window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank'); }
}

/* ---------- Render ---------- */
const $ = id => document.getElementById(id);
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const I_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>';
const I_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

let toastT;
function toast(msg){ let t=$('toast'); if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }

function dueChip(i){
  const c=CAT[i.cat];
  if(i.pago) return `<span class="chip done">${c.entrada?'Recebido':c.invest?'Aplicado':'Pago'}</span>`;
  if(!i.venc) return '';
  const isCur = Y===now.getFullYear() && M===now.getMonth();
  const past = (Y<now.getFullYear()) || (Y===now.getFullYear() && M<now.getMonth());
  if(past) return `<span class="chip late">Em aberto</span>`;
  if(!isCur) return '';
  const diff = Math.min(i.venc,daysIn(Y,M)) - now.getDate();
  if(diff<0) return `<span class="chip late">Atrasado</span>`;
  if(diff===0) return `<span class="chip soon">Vence hoje</span>`;
  if(diff<=3) return `<span class="chip soon">Vence em ${diff} dia${diff>1?'s':''}</span>`;
  return '';
}

function renderHeader(){
  const s=sums(data); const has = data && typeof data==='object';
  $('hdr').innerHTML = `
    <div class="top-actions">
      <button class="iconbtn" id="openCfg">${I_BELL}Lembretes e backup</button>
      ${has?`<button class="iconbtn" id="shareTop">${I_SEND}WhatsApp</button>`:''}
    </div>
    <div class="month">
      <button class="navbtn" id="prevM" aria-label="Mês anterior">‹</button>
      <h1><small>Orçamento familiar</small>${MESES[M]} ${Y}</h1>
      <button class="navbtn" id="nextM" aria-label="Próximo mês">›</button>
    </div>
    ${has?`<div class="saldo">
      <span class="lbl">Saldo realizado</span><span class="lbl" style="text-align:right">Saldo provisionado</span>
      <span class="big num">${fmt(s.saldo.g)}</span><span class="side num">${fmt(s.saldo.p)}</span>
    </div>`:''}`;
  $('prevM').onclick=()=>go(-1); $('nextM').onclick=()=>go(1);
  $('openCfg').onclick=()=>{ panel='config'; restoreArmed=false; renderSheet(); };
  $('shareTop') && ($('shareTop').onclick=()=>compartilhar(resumoTexto(),'Resumo do orçamento'));
}
function go(d){ repArmed=false; M+=d; if(M<0){M=11;Y--} if(M>11){M=0;Y++} openMonth(); window.scrollTo({top:0}); }

function renderTabs(){
  const t=[...CATS.map(c=>({k:c.k,lbl:c.short,n:c.num})),{k:'resumo',lbl:'Fechamento',n:'='}];
  $('tabs').innerHTML = t.map(x=>`<button class="tab ${tab===x.k?'on':''}" data-t="${x.k}" style="--cat:${x.k==='resumo'?'var(--accent)':`var(--c-${x.k})`}"><span class="n">${x.n}</span>${x.lbl}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; store.cfg.tab=tab; persist(); render(); window.scrollTo({top:0}); });
}

function renderStart(){
  const src=ultimoMesAntes(curKey());
  if(!src) return `<div class="start">
    <h2>Monte o seu orçamento de ${MESES[M]}</h2>
    <p>Comece em branco e cadastre as suas receitas, despesas fixas, compras no cartão, despesas variáveis e aplicações, cada uma na sua aba.</p>
    <p class="small">Depois, na aba Fechamento, você pode preencher os próximos 12 meses com essa mesma lista.</p>
    <button class="btn" data-create="vazio">Começar meu orçamento</button>
  </div>`;
  const [sy,sm]=ymOfKey(src);
  return `<div class="start">
    <h2>${MESES[M]} ainda não foi montado</h2>
    <p>Use a lista de ${MESES[sm]} ${sy} como ponto de partida. As linhas e os valores provisionados são mantidos, o gasto começa zerado e as parcelas do cartão avançam.</p>
    <button class="btn" data-create="copiar12">Copiar e preencher os próximos 12 meses</button>
    <button class="btn ghost" data-create="copiar">Copiar só para ${MESES[M]}</button>
    <button class="btn ghost" data-create="vazio">Começar em branco</button>
  </div>`;
}

function notifBanner(){
  if(!LN || store.cfg.notif || store.cfg.avisoVisto) return '';
  return `<div class="banner"><p><b>Quer ser avisado das contas a vencer?</b><br>O app manda uma notificação ${store.cfg.dias} dias antes e no dia do vencimento.</p>
    <div class="two"><button class="btn ghost" id="bnNo">Agora não</button><button class="btn" id="bnYes">Ativar lembretes</button></div></div>`;
}

function renderSection(c){
  const s=sums(data)[c.k];
  const itens=(data.itens||[]).filter(i=>i.cat===c.k).sort((a,b)=>(a.venc??99)-(b.venc??99));
  const pct = s.p>0 ? Math.min(100, s.g/s.p*100) : (s.g>0?100:0);
  const pos = c.entrada||c.invest;
  const over = !pos && s.g>s.p && s.p>0;
  const dif = pos ? s.g-s.p : s.p-s.g;
  const patr = c.invest ? sums(data).patrimonio : 0;
  return `${notifBanner()}<div style="--cat:var(--c-${c.k})">
    <div class="sec-head">
      <span class="eyebrow">${c.num} · ${c.n}</span>
      <div class="totals">
        <div class="tot"><span>${c.prev}</span><b class="num">${fmt(s.p)}</b></div>
        <div class="tot"><span>${c.real}</span><b class="num">${fmt(s.g)}</b></div>
        <div class="tot"><span>${pos?'Diferença':'Margem'}</span><b class="num ${dif<0?'neg':dif>0?'pos':''}">${fmt(dif)}</b></div>
      </div>
      <div class="bar ${over?'over':''}" role="img" aria-label="${Math.round(pct)}% do provisionado"><i style="width:${pct}%"></i></div>
      <span class="small muted">${s.pagos} de ${s.n} ${c.entrada?'recebidos':c.invest?'aplicados':'pagos'}</span>
      ${c.invest?`<div class="patr"><span class="muted">Total guardado<br><span class="small">saldo anterior + aplicado no mês</span></span><b class="num">${fmt(patr)}</b></div>`:''}
    </div>
    <div class="list">
      ${itens.length?'':c.invest?`<div class="empty-sec">Cadastre seus investimentos (ex.: reserva de emergência, CDB, Tesouro) com quanto pretende guardar e quanto de fato aplicou.</div>`:`<div class="empty-sec">${c.k==='cartao'?'Coloque aqui as compras parceladas (ex.: notebook 3/10). A parcela avança sozinha nos meses seguintes.':'Nenhum item ainda.'}</div>`}
      ${itens.map(i=>{
        const ov = !pos && i.realizado>i.previsto && i.previsto>0;
        return `<div class="row">
          <button class="check ${i.pago?'on':''}" data-pay="${i.id}" aria-label="Marcar como ${c.entrada?'recebido':c.invest?'aplicado':'pago'}">${CHECK}</button>
          <button class="r-main" data-edit="${i.id}" style="background:none;border:0;padding:0;text-align:left">
            <div class="r-name">${esc(i.nome)}</div>
            <div class="r-meta">${i.venc?`<span>dia ${i.venc}</span>`:''}${c.invest&&(saldoAnt(Y,M,i)||i.realizado)?`<span>total ${fmt(saldoAnt(Y,M,i)+(+i.realizado||0))}</span>`:''}${i.parcTotal?`<span class="chip">${i.parcAtual||1}/${i.parcTotal}</span>`:''}${dueChip(i)}</div>
          </button>
          <button class="r-vals" data-edit="${i.id}" style="background:none;border:0;padding:0">
            <span class="num">${fmt(i.previsto)}</span>
            <b class="num ${ov?'over':''}">${fmt(i.realizado)}</b>
          </button>
        </div>`}).join('')}
      <button class="add" data-add="${c.k}">+ ${c.add}</button>
    </div>
  </div>`;
}

function renderResumo(){
  const s=sums(data);
  const max=Math.max(1,...CATS.map(c=>Math.max(s[c.k].p,s[c.k].g)));
  const cls=v=>v<0?'neg':v>0?'pos':'';
  const rows=CATS.filter(c=>!c.invest).map(c=>{const x=s[c.k]; const d=c.entrada?x.g-x.p:x.p-x.g; return `<tr style="--cat:var(--c-${c.k})"><td><span class="dot"></span>${c.num}. ${c.n}</td><td class="num">${fn(x.p)}</td><td class="num">${fn(x.g)}</td><td class="num ${cls(d)}">${fn(d)}</td></tr>`}).join('');
  const dd=s.desp.p-s.desp.g, ds=s.saldo.g-s.saldo.p, da=s.aplicacao.g-s.aplicacao.p, dsb=s.sobra.g-s.sobra.p;
  const year = MESES.map((mn,m)=>{ const d=store.meses[keyOf(Y,m)]; if(!d) return ''; const x=sums(d,Y,m);
    return `<button class="yr ${m===M?'cur':''}" data-goto="${m}"><span>${mn}</span><span class="num muted">${fmt(x.saldo.p)}</span><span class="num ${x.saldo.g<0?'neg':''}"><b>${fmt(x.saldo.g)}</b></span></button>`}).join('');
  return `<div class="sec-head" style="--cat:var(--accent)"><span class="eyebrow">Fechamento do mês</span><h2>Provisionado × realizado</h2></div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th>Grupo (R$)</th><th>Previsto</th><th>Real</th><th>Dif.</th></tr></thead>
      <tbody>${rows}
        <tr class="strong"><td>Total despesas (2+3+4)</td><td class="num">${fn(s.desp.p)}</td><td class="num">${fn(s.desp.g)}</td><td class="num ${cls(dd)}">${fn(dd)}</td></tr>
        <tr class="saldo-row"><td>Saldo (1 − despesas)</td><td class="num">${fn(s.saldo.p)}</td><td class="num ${s.saldo.g<0?'neg':''}">${fn(s.saldo.g)}</td><td class="num ${cls(ds)}">${fn(ds)}</td></tr>
        <tr style="--cat:var(--c-aplicacao)"><td><span class="dot"></span>5. Aplicações</td><td class="num">${fn(s.aplicacao.p)}</td><td class="num">${fn(s.aplicacao.g)}</td><td class="num ${cls(da)}">${fn(da)}</td></tr>
        <tr class="strong"><td>Sobra após aplicações</td><td class="num">${fn(s.sobra.p)}</td><td class="num ${s.sobra.g<0?'neg':''}">${fn(s.sobra.g)}</td><td class="num ${cls(dsb)}">${fn(dsb)}</td></tr>
      </tbody></table></div>
    <p class="small muted" style="margin:10px 0 0">Diferença positiva = economizou nas despesas, recebeu ou aplicou mais que o previsto. Total guardado nas aplicações: <b class="num">${fmt(s.patrimonio)}</b>.</p>
  </div>
  <button class="btn wa" id="shareRes" style="width:100%;margin-bottom:12px">Enviar resumo pelo WhatsApp</button>
  <div class="card">
    <h3>Próximos meses</h3>
    <p class="small muted" style="margin:0 0 10px">Copia as linhas e os valores provisionados de ${MESES[M]} para ${MESES[addYM(Y,M,1)[1]]}/${addYM(Y,M,1)[0]} até ${MESES[addYM(Y,M,12)[1]]}/${addYM(Y,M,12)[0]}. Meses que você já montou não mudam, e as parcelas do cartão avançam e saem quando terminam.</p>
    <button class="btn ${repArmed?'':'ghost'}" id="repBtn" style="width:100%">${repArmed?'Confirmar: preencher os próximos 12 meses':'Preencher os próximos 12 meses'}</button>
  </div>
  <div class="card">
    <h3>Por grupo</h3>
    <div class="legend"><span><i class="p"></i>Provisionado</span><span><i></i>Realizado</span></div>
    <div class="cmp">${CATS.map(c=>{const x=s[c.k];return `<div class="cmp-item" style="--cat:var(--c-${c.k})"><div class="cmp-top"><span>${c.n}</span><span class="num muted">${x.p?Math.round(x.g/x.p*100)+'%':'–'}</span></div><div class="cmp-bars"><div class="b p" style="width:${x.p/max*100}%"></div><div class="b" style="width:${x.g/max*100}%"></div></div></div>`}).join('')}</div>
  </div>
  <div class="card">
    <h3>Observações do mês</h3>
    <textarea id="obs" placeholder="Ex.: sobrou R$ 500, vai para a reserva. Gasto extra com farmácia.">${esc(data.obs||'')}</textarea>
  </div>
  <div class="card">
    <h3>${Y} mês a mês</h3>
    <div class="yr" style="background:none;padding-block:0 4px"><span class="small muted">Mês</span><span class="small muted">Provisionado</span><span class="small muted">Realizado</span></div>
    <div class="year">${year||'<span class="muted small">Nenhum mês montado ainda.</span>'}</div>
  </div>`;
}

function render(){
  renderHeader(); renderTabs();
  const main=$('main');
  if(data===undefined) main.innerHTML='<p class="muted" style="padding:20px 2px">Carregando…</p>';
  else if(data===null) main.innerHTML=renderStart();
  else if(tab==='resumo'){
    const keep = document.activeElement?.id==='obs' ? document.activeElement : null;
    main.innerHTML=renderResumo();
    if(keep){ const pos=keep.selectionStart; $('obs').replaceWith(keep); keep.focus(); try{keep.setSelectionRange(pos,pos)}catch(e){} }
  }
  else main.innerHTML=renderSection(CAT[tab]);
  bindMain();
  if(!(edit||panel) || !$('sheetBody')) renderSheet();
}

function bindMain(){
  const main=$('main');
  main.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>createMonth(b.dataset.create));
  $('repBtn') && ($('repBtn').onclick=()=>{ if(!repArmed){ repArmed=true; render(); return; } repArmed=false; replicar(12); });
  main.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{
    const i=data.itens.find(x=>x.id===b.dataset.pay); if(!i) return;
    i.pago=!i.pago; if(i.pago && !i.realizado) i.realizado=i.previsto; save();
  });
  main.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const i=data.itens.find(x=>x.id===b.dataset.edit); if(!i) return;
    edit={cat:i.cat,id:i.id,armed:false,draft:{...i}}; renderSheet();
  });
  main.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
    edit={cat:b.dataset.add,id:null,armed:false,draft:{nome:'',venc:null,previsto:0,realizado:0,pago:false}}; renderSheet();
  });
  main.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>{ M=+b.dataset.goto; openMonth(); });
  const obs=$('obs'); if(obs) obs.oninput=()=>{ data.obs=obs.value; data.atualizado=new Date().toISOString(); store.meses[curKey()]=data; persist(); };
  $('shareRes') && ($('shareRes').onclick=()=>compartilhar(resumoTexto(),'Resumo do orçamento'));
  $('bnNo') && ($('bnNo').onclick=()=>{ store.cfg.avisoVisto=true; persist(); render(); });
  $('bnYes') && ($('bnYes').onclick=async()=>{ store.cfg.avisoVisto=true; await ativarNotif(true); render(); });
}

async function ativarNotif(on){
  if(on){
    const p = await notifPermission(true);
    if(p!=='granted'){ store.cfg.notif=false; persist(); toast('Permita as notificações nas configurações do Android para receber os lembretes.'); return false; }
  }
  store.cfg.notif=on; persist();
  toast(on?'Lembretes ativados.':'Lembretes desativados.');
  return true;
}

/* ---------- Folhas (editor e configurações) ---------- */
function closeSheet(){ edit=null; panel=null; renderSheet(); }
function renderSheet(){
  const root=$('sheetRoot');
  if(panel==='config') return renderConfig(root);
  if(!edit){ root.innerHTML=''; return; }
  const c=CAT[edit.cat], d=edit.draft;
  root.innerHTML=`<div class="scrim" id="scrim"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" style="--cat:var(--c-${c.k})"><form class="sheet-in" id="sheetBody">
    <div class="grip"></div>
    <span class="eyebrow">${c.num} · ${c.n}</span>
    <h2 id="sh-t">${edit.id?'Editar item':c.add}</h2>
    <div class="field"><label for="f-nome">Descrição</label><input id="f-nome" required value="${esc(d.nome)}" placeholder="${c.entrada?'Ex.: Salário':c.invest?'Ex.: CDB, Tesouro, poupança':'Ex.: Conta de luz'}" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label for="f-venc">${c.entrada?'Dia do recebimento':c.invest?'Dia da aplicação':'Dia do vencimento'}</label><input id="f-venc" inputmode="numeric" value="${d.venc??''}" placeholder="10"></div>
      ${c.k==='cartao'?`<div class="field"><label for="f-parc">Parcela (atual/total)</label><input id="f-parc" value="${d.parcTotal?`${d.parcAtual||1}/${d.parcTotal}`:''}" placeholder="3/10"></div>`:'<div></div>'}
    </div>
    <div class="two">
      <div class="field"><label for="f-prev">${c.prev} (R$)</label><input id="f-prev" inputmode="decimal" value="${toInput(d.previsto)}" placeholder="0,00"></div>
      <div class="field"><label for="f-real">${c.real} (R$)</label><input id="f-real" inputmode="decimal" value="${toInput(d.realizado)}" placeholder="0,00"></div>
    </div>
    ${c.invest?(edit.id&&itemAnterior(Y,M,d)?`<div class="field"><label>Saldo antes deste mês</label><div class="num" style="padding:4px 0;font-weight:600">${fmt(saldoAnt(Y,M,d))}</div><span class="small muted">Calculado a partir de ${MESES[itemAnterior(Y,M,d).m]}: saldo anterior + aplicado.</span></div>`:`<div class="field"><label for="f-saldo">Saldo antes deste mês (R$)</label><input id="f-saldo" inputmode="decimal" value="${toInput(d.saldo)}" placeholder="0,00"></div>`):''}
    <button type="button" class="link" id="f-same">${c.real} = ${c.prev.toLowerCase()}</button>
    <div class="actions">
      ${edit.id?`<button type="button" class="btn danger ${edit.armed?'armed':''}" id="f-del">${edit.armed?'Confirmar':'Excluir'}</button>`:`<button type="button" class="btn ghost" id="f-cancel">Cancelar</button>`}
      <button type="submit" class="btn">Salvar</button>
    </div>
  </form></div>`;
  const read=()=>{ d.nome=$('f-nome').value; const v=parseInt($('f-venc').value,10); d.venc=(v>=1&&v<=31)?v:null; d.previsto=parseBRL($('f-prev').value); d.realizado=parseBRL($('f-real').value); if($('f-saldo')) d.saldo=parseBRL($('f-saldo').value);
    if($('f-parc')){ const m=/^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec($('f-parc').value); if(m){d.parcAtual=+m[1];d.parcTotal=+m[2]} else {delete d.parcAtual;delete d.parcTotal} } };
  $('scrim').onclick=closeSheet;
  $('f-cancel')&&($('f-cancel').onclick=closeSheet);
  $('f-same').onclick=()=>{ $('f-real').value=$('f-prev').value; };
  $('f-del')&&($('f-del').onclick=()=>{ if(!edit.armed){ read(); edit.armed=true; renderSheet(); return; } data.itens=data.itens.filter(x=>x.id!==edit.id); edit=null; save(); });
  $('sheetBody').onsubmit=e=>{ e.preventDefault(); read(); if(!d.nome.trim()) return $('f-nome').focus();
    d.nome=d.nome.trim();
    if(d.realizado>0 && !edit.id) d.pago = true;
    if(edit.id){ const i=data.itens.findIndex(x=>x.id===edit.id); if(i>=0) data.itens[i]={...d,cat:edit.cat,id:edit.id}; }
    else data.itens.push({...d,cat:edit.cat,id:uid()});
    edit=null; save(); };
  if(!edit.id && !edit.armed) setTimeout(()=>$('f-nome')?.focus(),50);
}

function renderConfig(root){
  const cfg=store.cfg;
  root.innerHTML=`<div class="scrim" id="scrim"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cfg-t" style="--cat:var(--accent)"><div class="sheet-in" id="sheetBody">
    <div class="grip"></div>
    <h2 id="cfg-t">Lembretes e backup</h2>
    <h3>Notificações no celular</h3>
    <div>
      <div class="opt"><div><div class="t">Avisar contas a vencer</div><div class="d">${LN?'Despesas não pagas que têm dia de vencimento':'Disponível no app instalado no celular'}</div></div>
        <label class="switch"><input type="checkbox" id="c-notif" ${cfg.notif?'checked':''} ${LN?'':'disabled'} aria-label="Avisar contas a vencer"><span></span></label></div>
      <div class="opt"><div><div class="t">Avisar antes</div><div class="d">Além do aviso no dia</div></div>
        <div class="stepper"><button type="button" id="d-" aria-label="Menos dias">−</button><b class="num">${cfg.dias} dia${cfg.dias===1?'':'s'}</b><button type="button" id="d+" aria-label="Mais dias">+</button></div></div>
      <div class="opt"><div><div class="t">Horário do aviso</div></div>
        <div class="stepper"><button type="button" id="h-" aria-label="Mais cedo">−</button><b class="num">${String(cfg.hora).padStart(2,'0')}:00</b><button type="button" id="h+" aria-label="Mais tarde">+</button></div></div>
      <div class="opt"><div><div class="t">Resumo do saldo toda segunda</div><div class="d">Saldo do mês e quanto falta pagar</div></div>
        <label class="switch"><input type="checkbox" id="c-sem" ${cfg.semanal?'checked':''} aria-label="Resumo semanal"><span></span></label></div>
    </div>
    ${LN?`<button type="button" class="btn ghost" id="c-test">Testar notificação agora</button>`:''}
    <h3>WhatsApp</h3>
    <button type="button" class="btn wa" id="c-wa" ${data?'':'disabled'}>Enviar resumo de ${MESES[M]} pelo WhatsApp</button>
    <h3>Backup dos dados</h3>
    <p class="small muted" style="margin:0">Os dados ficam só neste celular. Envie o backup para você mesmo (WhatsApp, e-mail) e, para restaurar, cole o texto abaixo.</p>
    <button type="button" class="btn ghost" id="c-exp">Enviar backup</button>
    <textarea id="c-imp" placeholder="Cole aqui o texto do backup para restaurar"></textarea>
    <button type="button" class="btn danger ${restoreArmed?'armed':''}" id="c-rest">${restoreArmed?'Confirmar: substituir meus dados':'Restaurar backup'}</button>
    <button type="button" class="btn" id="c-close">Fechar</button>
  </div></div>`;
  const step=(k,d,min,max)=>{ cfg[k]=Math.max(min,Math.min(max,cfg[k]+d)); persist(); renderConfig(root); };
  $('scrim').onclick=closeSheet; $('c-close').onclick=closeSheet;
  $('c-notif').onchange=async e=>{ await ativarNotif(e.target.checked); renderConfig(root); };
  $('c-sem').onchange=e=>{ cfg.semanal=e.target.checked; persist(); };
  $('d-').onclick=()=>step('dias',-1,0,10); $('d+').onclick=()=>step('dias',1,0,10);
  $('h-').onclick=()=>step('hora',-1,6,22); $('h+').onclick=()=>step('hora',1,6,22);
  $('c-test') && ($('c-test').onclick=async()=>{
    if((await notifPermission(true))!=='granted') return toast('Permita as notificações nas configurações do Android.');
    await LN.schedule({notifications:[{id:9999, title:'Orçamento Familiar', body:'As notificações estão funcionando.', schedule:{at:new Date(Date.now()+3000)}, smallIcon:'ic_stat_notify', iconColor:'#0E6E55'}]});
    toast('Você vai receber um aviso em 3 segundos.');
  });
  $('c-wa').onclick=()=>data && compartilhar(resumoTexto(),'Resumo do orçamento');
  $('c-exp').onclick=()=>compartilhar(JSON.stringify({app:'orcamento-familiar',v:1,exportado:new Date().toISOString(),meses:store.meses}),'Backup do Orçamento Familiar');
  $('c-imp').oninput=()=>{ if(restoreArmed){ restoreArmed=false; const b=$('c-rest'); b.classList.remove('armed'); b.textContent='Restaurar backup'; } };
  $('c-rest').onclick=()=>{
    let obj; try{ obj=JSON.parse($('c-imp').value.trim()); }catch(e){ return toast('O texto colado não é um backup válido.'); }
    if(!obj || obj.app!=='orcamento-familiar' || typeof obj.meses!=='object') return toast('O texto colado não é um backup do Orçamento Familiar.');
    if(!restoreArmed){ restoreArmed=true; const b=$('c-rest'); b.classList.add('armed'); b.textContent='Confirmar: substituir meus dados'; return; }
    store.meses=obj.meses; restoreArmed=false; persist(); panel=null; openMonth(); toast('Backup restaurado.');
  };
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && (edit||panel)) closeSheet(); });

/* ---------- Início ---------- */
(async ()=>{
  render();
  await loadStore();
  tab = store.cfg.tab || 'receita';
  openMonth();
  scheduleNotifications();
  if(AppP){
    AppP.addListener('backButton', ({canGoBack})=>{ if(edit||panel) closeSheet(); else if(tab!=='receita'){ tab='receita'; render(); } else AppP.exitApp(); });
    AppP.addListener('resume', ()=>{ now=new Date(); render(); scheduleNotifications(); });
  }
})();
})();
