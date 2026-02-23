async function loadDict(lang){
  const res = await fetch(`/i18n/${lang}.json`, {cache:'no-store'});
  if(!res.ok) throw new Error('i18n load failed');
  return res.json();
}

function getLang(){
  const url = new URL(location.href);
  const q = url.searchParams.get('lang');
  if(q === 'en' || q === 'ru') return q;
  const saved = localStorage.getItem('lang');
  if(saved === 'en' || saved === 'ru') return saved;
  return 'en';
}

function setLang(lang){
  localStorage.setItem('lang', lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  history.replaceState({}, '', url);
}

function applyDict(dict){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if(dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    const key = el.getAttribute('data-i18n-placeholder');
    if(dict[key]) el.setAttribute('placeholder', dict[key]);
  });
}

async function initI18n(){
  const lang = getLang();
  setLang(lang);

  document.querySelectorAll('[data-lang]').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-lang')===lang);
    btn.addEventListener('click', ()=>{
      const next = btn.getAttribute('data-lang');
      setLang(next);
      location.reload();
    });
  });

  const dict = await loadDict(lang);
  applyDict(dict);
  return lang;
}

window.__initI18n = initI18n;
