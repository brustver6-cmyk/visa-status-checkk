(async function(){
  const lang = await window.__initI18n();

  const form = document.querySelector('#checkForm');
  const codeEl = document.querySelector('#code');
  const btn = document.querySelector('#btnCheck');
  const hint = document.querySelector('#hint');

  const modal = document.querySelector('#modal');
  const closeBtn = document.querySelector('#closeModal');

  const vCode = document.querySelector('#vCode');
  const vStatus = document.querySelector('#vStatus');
  const vUpdated = document.querySelector('#vUpdated');
  const vMessage = document.querySelector('#vMessage');

  function openModal(){ modal.classList.add('show'); }
  function closeModal(){ modal.classList.remove('show'); }
  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });

  async function check(code){
    const res = await fetch('/api/check', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code, lang })
    });

    if(res.status === 429){
      hint.textContent = (lang==='ru')
        ? 'Слишком много попыток. Попробуйте позже.'
        : 'Too many attempts. Try again later.';
      return;
    }

    const data = await res.json();
    if(!res.ok){
      hint.textContent = data?.message || ((lang==='ru') ? 'Ошибка' : 'Error');
      return;
    }

    hint.textContent = '';
    vCode.textContent = data.code;
    vStatus.textContent = data.status_display;
    vUpdated.textContent = data.updated_at_display;
    vMessage.textContent = data.message_display || '—';
    openModal();
  }

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const code = (codeEl.value || '').trim();
    if(!code){
      hint.textContent = (lang==='ru') ? 'Введите код.' : 'Enter a code.';
      return;
    }
    btn.disabled = true;
    try{ await check(code); }
    finally{ btn.disabled = false; }
  });
})();
