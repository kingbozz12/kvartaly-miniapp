const telegram = window.Telegram?.WebApp;
if (telegram) {
  telegram.ready();
  telegram.expand();
  try { telegram.setHeaderColor('#10151b'); telegram.setBackgroundColor('#10151b'); } catch {}
}

let model = null;
let page = 'city';
let activeMove = 0;
let toastTimer;
let busy = false;
const routes = [
  { id: 'city', label: 'Город', icon: '🏠' },
  { id: 'battle', label: 'Бои', icon: '⚔️' },
  { id: 'hero', label: 'Герой', icon: '👤' },
  { id: 'training', label: 'Тренировка', icon: '🏋️' },
  { id: 'map', label: 'Карта', icon: '🗺️' },
];
const img = name => `/assets/${name}.webp`;
const fmt = number => Math.max(0, Math.round(Number(number || 0))).toLocaleString('ru-RU');
const escapeHtml = text => String(text || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (value, max) => `${Math.min(100,Math.max(0,Math.round((value / (max || 1))*100)))}%`;
const progress = (value, max, kind='') => `<div class="progress ${kind}"><i style="width:${pct(value,max)}"></i></div>`;
const timeLeft = timestamp => {
  const seconds = Math.max(0,Math.floor((timestamp - Date.now())/1000));
  return [Math.floor(seconds / 3600),Math.floor(seconds % 3600 / 60),seconds % 60].map(x => String(x).padStart(2,'0')).join(':');
};
const header = document.getElementById('header');
const screen = document.getElementById('screen');
const nav = document.getElementById('bottom-nav');
const toastElement = document.getElementById('toast');
function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('shown'), 3300);
  telegram?.HapticFeedback?.notificationOccurred('success');
}
async function request(method, endpoint, data) {
  const res = await fetch(endpoint, {
    method,
    cache:'no-store',
    headers: {'Content-Type':'application/json', 'X-Telegram-Init-Data':telegram?.initData || ''},
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw Error(json.error || 'Ошибка сервера');
  return json;
}
function renderHeader() {
  if (!model) return;
  const player = model.player;
  header.innerHTML = `
    <div class="logo">КВАРТАЛЫ<small>СВОИ ПРАВИЛА</small></div>
    <div class="wallets">
      <div class="wallet"><span>💵</span><strong>${fmt(player.cash)}</strong></div>
      <div class="wallet"><span>💎</span><strong>${fmt(player.marks)}</strong></div>
    </div>`;
}
function renderNav() {
  nav.innerHTML = routes.map(r => `<button type="button" class="nav-btn ${page===r.id?'active':''}" data-page="${r.id}"><span class="nav-icon">${r.icon}</span>${r.label}</button>`).join('');
}
function profileStrip() {
  const p = model.player;
  return `<div class="panel profile-strip">
    <img class="avatar" src="${img('player_avatar')}" alt="Портрет персонажа" />
    <div class="profile-detail gap4">
      <div class="username">${escapeHtml(p.name)}</div>
      <div class="muted small">Уровень ${fmt(p.level)} · Опыт ${fmt(p.xp)}/${fmt(p.xpNeeded)}</div>
      ${progress(p.xp,p.xpNeeded)}
    </div>
    <span class="tag">★</span>
  </div>`;
}
function energyStrip() {
  const p = model.player;
  return `<div class="statrow panel box" style="margin:10px 0">
   <span style="font-size:21px">⚡</span>
   <div style="flex:1"><div class="statrow"><strong>${fmt(p.energy)} / ${fmt(p.energyMax)}</strong><span class="muted tiny">${p.energy >= p.energyMax?'Заполнено':'Регенерация: 1 / 5 мин'}</span></div>
   ${progress(p.energy,p.energyMax)}</div>
  </div>`;
}
function bossBar() {
  return `${progress(model.boss.hp,model.boss.maxHp,'red')}<div class="statrow tiny" style="margin-top:5px"><b>${fmt(model.boss.hp)} / ${fmt(model.boss.maxHp)} HP</b><span class="muted">⏱ ${timeLeft(model.boss.endsAt)}</span></div>`;
}
function home() {
  return `${profileStrip()}${energyStrip()}
    <div class="scene"><img src="${img('yard')}" alt="Рисованный двор Гранитска" />
      <div class="scene-actions">
        <div class="scene-rail">
          <button data-placeholder="События появятся в следующем обновлении"><span>🏆</span>События</button>
          <button data-placeholder="Ежедневные награды — в следующем обновлении"><span>🎁</span>Награды</button>
          <button data-page="map"><span>🗺️</span>Районы</button>
        </div>
        <div class="scene-rail">
          <button data-page="training"><span>🏋️</span>Тренировка</button>
          <button data-page="hero"><span>🎒</span>Персонаж</button>
          <button data-page="battle"><span>🥊</span>Бои</button>
        </div>
      </div>
      <div class="scene-title"><span>📍 Старые дворы</span><span class="small goldtext">Сменить район ›</span></div>
    </div>
    <div class="panel boss-tile">
      <img src="${img('boss_avatar')}" alt="Босс Бурый"/>
      <div><span class="muted tiny">Босс района</span><h3>Бурый</h3>${bossBar()}</div>
      <button class="btn" data-page="battle">🥊<br>В БОЙ</button>
    </div>
    <div class="heading"><h2>В городе</h2><span class="pill">Первый район</span></div>
    <div class="cols3">
      <button class="action-tile" data-page="training"><span class="bigicon">🏋️</span>Тренировки</button>
      <button class="action-tile" data-page="hero"><span class="bigicon">🧥</span>Герой</button>
      <button class="action-tile" data-page="map"><span class="bigicon">🗺️</span>Карта</button>
    </div>
  `;
}
function battle() {
  const p = model.player;
  return `<div class="heading" style="margin-top:0"><h2>⚔️ Бой с боссом</h2><span class="tag">Ур. 10</span></div>
    <div class="panel box"><div class="boss-head"><img src="${img('boss_avatar')}" alt="Бурый"/><div class="details"><h2 style="margin:0 0 3px">Бурый</h2><div class="muted small" style="margin-bottom:12px">Босс района «Старые дворы»</div>${bossBar()}</div></div></div>
    <div class="space"></div><div class="hero-boss"><img src="${img('boss')}" alt="Бурый на фоне гаражей"/><div class="nameplate">БУРАЯ СИЛА</div></div>
    <div class="space"></div><div class="value-cards"><div class="value-card"><strong>${fmt(p.damage)}</strong>Мой урон</div><div class="value-card"><strong>${fmt(p.attackCount)}</strong>Атак</div><div class="value-card"><strong>10⚡</strong>Стоимость</div></div>
    <div class="heading"><h2>Приём</h2><span class="muted small">Выбери атаку</span></div>
    <div class="battle-actions">
      <button class="battle-move selected" data-move="0"><b>👊</b>Удар</button>
      <button class="battle-move" data-placeholder="Сильный удар будет в следующей версии"><b>💥</b>Сильный удар</button>
      <button class="battle-move" data-placeholder="Комбинации появятся позже"><b>⚡</b>Серия</button>
    </div>
    <div class="space"></div><button class="btn danger wide" data-action="attack" ${p.energy<10?'disabled':''}>👊 АТАКОВАТЬ — 10 ⚡</button>
    <p class="footer-hint">Урон, энергия, опыт и деньги вычисляются на сервере. В первой версии работает обычный удар.</p>`;
}
function hero() {
  const p=model.player;
  const names={strength:'💪 Сила',stamina:'❤️ Выносливость',reaction:'⚡ Реакция',charisma:'⭐ Харизма'};
  return `<h2 class="section-title">Мой персонаж</h2>${profileStrip()}
    <div class="heading"><h2>Экипировка</h2><span class="tag">Ранг: Новичок</span></div>
    <div class="character"><img src="${img('player_full')}" alt="Персонаж в спортивной одежде" /></div>
    <div class="stat-panel panel box"><div class="heading" style="margin-top:0"><h2>Характеристики</h2><span class="pill">Ур. ${p.level}</span></div>
      ${Object.entries(p.stats).map(([key,val])=>`<div class="stat-item"><span class="stat-title">${names[key]}</span><b class="score">${fmt(val)}</b><button class="btn secondary" data-page="training">+ Тренировать</button></div>`).join('')}
    </div>
    <div class="space"></div><button class="btn wide" data-page="training">🏋️ Перейти к тренировкам</button>
  `;
}
function training() {
  const p=model.player;
  const stats=[
    ['strength','💪','Сила','Увеличивает урон по боссам.'],
    ['stamina','❤️','Выносливость','Основа будущей защиты персонажа.'],
    ['reaction','⚡','Реакция','Повышает результативность ударов.'],
    ['charisma','⭐','Харизма','Пригодится для социальных систем.'],
  ];
  return `<h2 class="section-title">🏋️ Тренировочный зал</h2>${energyStrip()}
    <div class="panel box" style="margin-bottom:12px"><div class="statrow"><span class="muted small">Цена одной тренировки</span><b>10 ⚡ + 50 ₽</b></div><div class="statrow" style="margin-top:9px"><span class="muted small">Награда</span><b class="green">+1 навык, +25 опыта</b></div></div>
    ${stats.map(([id,icon,title,subtitle])=>`<div class="panel box" style="margin-bottom:9px"><div class="statrow" style="gap:9px"><span style="font-size:34px">${icon}</span><div style="flex:1"><b>${title}</b><div class="muted small">${subtitle}</div></div><span class="tag">${fmt(p.stats[id])}</span></div><div class="space"></div><button class="btn wide" data-action="train" data-stat="${id}" ${p.energy<10 || p.cash<50?'disabled':''}>ТРЕНИРОВАТЬ +1</button></div>`).join('')}
    <p class="footer-hint">Энергия восстанавливается по 1 единице каждые 5 минут. Прогресс сохраняется на сервере.</p>`;
}
function map() {
  const districts=[
    ['district_old','Старые дворы','1–10',1],
    ['district_market','Рыночный','11–20',11],
    ['district_factory','Заводской','21–35',21],
    ['district_port','Портовый','36–50',36],
    ['district_central','Центральный','51–70',51],
    ['district_high','Высотный','71+',71],
  ];
  return `<h2 class="section-title">🗺️ Карта Гранитска</h2><p class="muted small">Исследуй город, открывай новые районы и встречай уникальных боссов.</p>
  ${districts.map(([asset,name,levels,required])=>`<div class="district ${required===1?'current':'locked'}"><img src="${img(asset)}" alt="${name}"/><div class="district-text"><h3>${name}</h3><div class="lock">Уровни ${levels} · ${required===1?'📍 Доступен':'🔒 В разработке'}</div></div></div>`).join('')}
  <p class="footer-hint">В первой версии доступен район «Старые дворы». Остальные районы представлены как анонс будущего контента.</p>`;
}
function render() {
  if (!model) return;
  renderHeader();
  renderNav();
  const previous = screen.scrollTop;
  screen.innerHTML = ({ city:home,battle,hero,training,map }[page] || home)();
  screen.scrollTop = previous;
}
async function refresh() {
  model = await request('GET','/api/state');
  render();
}
async function runAction(type,stat) {
  if (busy) return;
  busy=true;
  try {
    const result=await request('POST','/api/action',{type,stat});
    model=result;
    render();
    toast(result.message);
  } catch(err) {
    toast(err.message);
    try { await refresh(); } catch {}
  } finally { busy=false; }
}
document.addEventListener('click', event => {
  const button=event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) {
    page=button.dataset.page;
    if (page!=='battle') activeMove=0;
    screen.scrollTop=0;
    telegram?.HapticFeedback?.selectionChanged?.();
    render();
  } else if (button.dataset.action) {
    runAction(button.dataset.action,button.dataset.stat);
  } else if (button.dataset.placeholder) {
    toast(button.dataset.placeholder);
  }
});
async function bootstrap() {
  try { await refresh(); }
  catch(err) {
    screen.innerHTML=`<div class="empty-state"><h2>КВАРТАЛЫ</h2><p>Для входа в игру открой Mini App внутри Telegram.</p><p class="muted small">${escapeHtml(err.message)}</p><p class="small">Для локального тестирования запусти <code>npm run dev</code> и открой http://localhost:3000.</p></div>`;
  }
}
bootstrap();
setInterval(async () => {
  if (!model || busy || document.hidden) return;
  try { await refresh(); } catch {}
},60000);
