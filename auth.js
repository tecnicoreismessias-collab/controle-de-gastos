const SUPABASE_URL = "https://rggcptzeptbnrcmjkcwc.supabase.co";
const SUPABASE_KEY = "sb_publishable_AIZk-z4jrZhdKr0PbdFmlw_bWWXVTNk";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ACTIVE_USER_KEY = 'gastos_app_usuario_ativo';

// O localStorage é usado somente para identificar a sessão local do usuário.
// Dados financeiros, metas, perfil e histórico têm o Supabase como fonte oficial.
function userStorageKey(base){
  const uid = localStorage.getItem(ACTIVE_USER_KEY);
  return uid ? `${base}_${uid}` : base;
}

function setActiveUser(user){
  if(user?.id) localStorage.setItem(ACTIVE_USER_KEY, user.id);
}

function clearActiveUser(){
  localStorage.removeItem(ACTIVE_USER_KEY);
}

// Compatibilidade com as páginas da aplicação: mantém somente o identificador da sessão local.
// Nenhum dado financeiro é armazenado aqui.
async function prepareUserSpace(user){
  if(user?.id) setActiveUser(user);
  return user || null;
}

let APP_PROFILE={name:'',startDate:'',year:new Date().getFullYear()};
let APP_GOALS={annual:0,monthly:0};

async function loadCloudProfile(){
  const user=await getCurrentUser();
  if(!user) throw new Error('AUTH_REQUIRED');
  const {data,error}=await supabaseClient.from('profiles').select('id,name,start_date,active_year').eq('id',user.id).maybeSingle();
  if(error) throw error;
  const year=Number(data?.active_year)||new Date().getFullYear();
  APP_PROFILE={name:data?.name||'',startDate:data?.start_date||'',year};
  return APP_PROFILE;
}

function getAppProfile(){ return {...APP_PROFILE}; }
function setAppProfile(p){ APP_PROFILE={...APP_PROFILE,...p}; }
function getAppGoals(){ return {...APP_GOALS}; }
function setAppGoals(g){ APP_GOALS={annual:Number(g?.annual)||0,monthly:Number(g?.monthly)||0}; }

async function saveCloudProfile(p){
  const user=await getCurrentUser();
  if(!user) throw new Error('AUTH_REQUIRED');
  const payload={id:user.id,name:p?.name||'',start_date:p?.startDate||null,active_year:Number(p?.year)||new Date().getFullYear()};
  const {error}=await supabaseClient.from('profiles').upsert(payload,{onConflict:'id'});
  if(error) throw error;
  setAppProfile({name:payload.name,startDate:payload.start_date||'',year:payload.active_year});
  return getAppProfile();
}

async function requireAuth(){
  const {data:{session}} = await supabaseClient.auth.getSession();
  if(!session){
    clearActiveUser();
    window.location.href = location.pathname.includes('/meses/') ? '../login.html' : 'login.html';
    return null;
  }
  await prepareUserSpace(session.user);
  return session;
}

async function signOut(){
  clearActiveUser();
  await supabaseClient.auth.signOut();
  window.location.href = location.pathname.includes('/meses/') ? '../login.html' : 'login.html';
}


async function getCurrentUser(){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session) return null;
  setActiveUser(session.user);
  return session.user;
}

function blankDataFromInitial(initial){
  const out={};
  for(const [month, d] of Object.entries(initial||{})){
    out[month]={
      fixed:(d.fixed||[]).map(x=>({...x})),
      extra:(d.extra||[]).map(x=>({...x})),
      entries:(d.entries||[]).map(x=>({...x})),
      debts:[]
    };
  }
  return out;
}

async function ensureAnnualCycle(year, goals={annual:0,monthly:0}){
  const user=await getCurrentUser();
  if(!user) throw new Error('AUTH_REQUIRED');
  const payload={user_id:user.id,year:Number(year)||new Date().getFullYear(),monthly_goal:Number(goals.monthly)||0,annual_goal:Number(goals.annual)||0};
  const {data,error}=await supabaseClient.from('annual_cycles').upsert(payload,{onConflict:'user_id,year'}).select('id,year,monthly_goal,annual_goal').single();
  if(error) throw error;
  return data;
}

async function cloudLoadData(initial, year){
  const user=await getCurrentUser();
  if(!user) throw new Error('AUTH_REQUIRED');
  const cycle=await supabaseClient.from('annual_cycles').select('id,year,monthly_goal,annual_goal').eq('user_id',user.id).eq('year',Number(year)).maybeSingle();
  if(cycle.error) throw cycle.error;
  if(!cycle.data) return {data:null,goals:{annual:0,monthly:0}};
  const mr=await supabaseClient.from('monthly_records').select('id,month').eq('user_id',user.id).eq('annual_cycle_id',cycle.data.id).order('month');
  if(mr.error) throw mr.error;
  if(!mr.data?.length) return {data:null,goals:{annual:Number(cycle.data.annual_goal)||0,monthly:Number(cycle.data.monthly_goal)||0}};
  const ids=mr.data.map(x=>x.id);
  const ex=await supabaseClient.from('expenses').select('id,monthly_record_id,category,description,amount,status,recurring_id').in('monthly_record_id',ids).order('created_at');
  if(ex.error) throw ex.error;
  const inc=await supabaseClient.from('incomes').select('id,monthly_record_id,description,amount').in('monthly_record_id',ids).order('created_at');
  if(inc.error) throw inc.error;
  const data={};
  for(const month of Object.keys(initial||{})) data[month]={fixed:[],extra:[],entries:[],debts:[]};
  const monthById=Object.fromEntries(mr.data.map(r=>[r.id,Object.keys(initial)[Number(r.month)-1]]));
  for(const row of ex.data||[]){
    const m=monthById[row.monthly_record_id]; if(!m) continue;
    const item={id:String(row.id),desc:row.description||'',value:Number(row.amount)||0,status:row.status||'PAGO'}; if(row.recurring_id) item.recurringId=String(row.recurring_id);
    if(row.category==='fixed') data[m].fixed.push(item); else if(row.category==='extra') data[m].extra.push(item);
  }
  for(const row of inc.data||[]){
    const m=monthById[row.monthly_record_id]; if(!m) continue;
    data[m].entries.push({id:String(row.id),desc:row.description||'',value:Number(row.amount)||0});
  }
  return {data,goals:{annual:Number(cycle.data.annual_goal)||0,monthly:Number(cycle.data.monthly_goal)||0}};
}

async function cloudSaveData(data, year, goals={annual:0,monthly:0}, monthsToSave=null){
  const user=await getCurrentUser();
  if(!user) throw new Error('AUTH_REQUIRED');
  const cycle=await ensureAnnualCycle(year,goals);
  const months=Object.keys(data||{});
  const monthRows=months.map((name,i)=>({user_id:user.id,annual_cycle_id:cycle.id,month:i+1}));
  const up=await supabaseClient.from('monthly_records').upsert(monthRows,{onConflict:'user_id,annual_cycle_id,month'});
  if(up.error) throw up.error;
  const mr=await supabaseClient.from('monthly_records').select('id,month').eq('user_id',user.id).eq('annual_cycle_id',cycle.id).order('month');
  if(mr.error) throw mr.error;
  const byMonth=Object.fromEntries((mr.data||[]).map(r=>[r.month,r.id]));
  const wanted=monthsToSave?months.filter(m=>monthsToSave.includes(m)):months;
  for(const m of wanted){
    const idx=months.indexOf(m)+1, recordId=byMonth[idx]; if(!recordId) continue;
    const d=data[m]||{fixed:[],extra:[],entries:[]};
    const delE=await supabaseClient.from('expenses').delete().eq('monthly_record_id',recordId); if(delE.error) throw delE.error;
    const delI=await supabaseClient.from('incomes').delete().eq('monthly_record_id',recordId); if(delI.error) throw delI.error;
    const expenses=[...(d.fixed||[]).map(x=>({user_id:user.id,monthly_record_id:recordId,category:'fixed',description:x.desc||'',amount:Number(x.value)||0,status:x.status==='DEVENDO'?'DEVENDO':'PAGO',recurring_id:x.recurringId||null})),...(d.extra||[]).map(x=>({user_id:user.id,monthly_record_id:recordId,category:'extra',description:x.desc||'',amount:Number(x.value)||0,status:x.status==='DEVENDO'?'DEVENDO':'PAGO'}))];
    if(expenses.length){const q=await supabaseClient.from('expenses').insert(expenses); if(q.error) throw q.error;}
    const incomes=(d.entries||[]).map(x=>({user_id:user.id,monthly_record_id:recordId,description:x.desc||'',amount:Number(x.value)||0}));
    if(incomes.length){const q=await supabaseClient.from('incomes').insert(incomes); if(q.error) throw q.error;}
  }
  return cycle;
}

async function cloudBoot(initial, year){
  const remote=await cloudLoadData(initial,year);
  if(remote.data){
    setAppGoals(remote.goals||{annual:0,monthly:0});
    return remote;
  }
  const seed=blankDataFromInitial(initial);
  const goals={annual:0,monthly:0};
  await cloudSaveData(seed,year,goals);
  setAppGoals(goals);
  return {data:seed,goals};
}
