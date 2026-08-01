/* Anderz Auto-invuller — bookmarklet
   Plak de verzamellijst (gekopieerd vanuit de Vrijdaglunch-tool) en laat 'm
   automatisch de juiste producten + aantallen + varianten in het mandje zetten
   op bestellen.eetsalonanderz.nl. Rondt NOOIT zelf af/betaalt niet — dat doe jij.
*/
(function () {
  if (window.__afActive) { window.__afDeactivate && window.__afDeactivate(); return; }
  window.__afActive = true;

  const PREFIX = '__af_';
  let stopRequested = false;

  const style = document.createElement('style');
  style.id = PREFIX + 'style';
  style.textContent = `
    #${PREFIX}panel{
      position:fixed; top:16px; right:16px; width:320px; max-height:calc(100vh - 32px);
      overflow-y:auto; background:#1f1e1c; color:#eee; font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
      border:1px solid #444; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.5);
      z-index:2147483000; padding:14px;
    }
    #${PREFIX}panel h3{ margin:0 0 8px; font-size:14px; }
    #${PREFIX}panel textarea{
      width:100%; min-height:140px; background:#111; color:#e9e5dc; font:11px/1.4 monospace;
      border:1px solid #555; border-radius:6px; padding:8px; box-sizing:border-box;
    }
    #${PREFIX}panel button{
      font-size:12px; font-weight:600; padding:8px 10px; border-radius:6px; border:1px solid #555;
      background:#2a2926; color:#eee; cursor:pointer; margin-top:8px; width:100%;
    }
    #${PREFIX}panel button.primary{ background:#b23a2e; border-color:#b23a2e; color:#fff; }
    #${PREFIX}panel .hint{ font-size:11px; color:#999; margin-top:8px; line-height:1.5; }
    #${PREFIX}log{ margin-top:10px; font-size:11px; max-height:220px; overflow-y:auto; }
    #${PREFIX}log .row{ padding:4px 0; border-bottom:1px solid #333; display:flex; justify-content:space-between; gap:6px; }
    #${PREFIX}log .ok{ color:#8fd18a; }
    #${PREFIX}log .fail{ color:#e08a8a; }
    #${PREFIX}log .pending{ color:#999; }
    #${PREFIX}badge{
      position:fixed; bottom:16px; left:16px; z-index:2147483000;
      background:#b23a2e; color:#fff; font:12px -apple-system,Segoe UI,sans-serif;
      padding:8px 12px; border-radius:20px; box-shadow:0 4px 14px rgba(0,0,0,.4); cursor:pointer;
    }
    .${PREFIX}found-flash{ outline:3px solid #4da3ff !important; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = PREFIX + 'panel';
  panel.innerHTML = `
    <h3>🛒 Anderz Auto-invuller</h3>
    <textarea id="${PREFIX}input" placeholder="Plak hier de verzamellijst (Kopieer voor auto-invullen)"></textarea>
    <button class="primary" id="${PREFIX}start">Start invullen</button>
    <button id="${PREFIX}stop" style="display:none">Stop</button>
    <div id="${PREFIX}log"></div>
    <div class="hint">Dit klikt zelf producten en varianten aan in het mandje. Het rondt nooit zelf af of betaalt — dat blijft altijd bij jou. Controleer het mandje na afloop.</div>
  `;
  document.body.appendChild(panel);

  const badge = document.createElement('div');
  badge.id = PREFIX + 'badge';
  badge.textContent = '🛒 Auto-invuller actief — klik om te stoppen';
  badge.onclick = deactivate;
  document.body.appendChild(badge);

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function logRow(text, status){
    const log = document.getElementById(PREFIX + 'log');
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${text}</span><span class="${status}">${status === 'ok' ? '✓' : status === 'fail' ? '✕' : '…'}</span>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function updateRow(row, status){
    row.querySelector('span:last-child').className = status;
    row.querySelector('span:last-child').textContent = status === 'ok' ? '✓' : status === 'fail' ? '✕' : '…';
  }

  function parseList(raw){
    return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(\d+)\s*x\s+(.+?)(?:::(.*))?$/i);
      if(!m) return null;
      return { qty: parseInt(m[1]), name: m[2].trim(), note: (m[3]||'').trim() };
    }).filter(Boolean);
  }

  // Find the smallest element whose own visible text matches the product name closely.
  function findProductCard(name){
    const target = name.toLowerCase().trim();
    const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,span,div,p'));
    let best = null, bestLen = Infinity;
    for(const el of all){
      if(el.children.length > 2) continue; // prefer leaf-ish text nodes
      const text = (el.textContent || '').trim().toLowerCase();
      if(!text) continue;
      if(text === target || text.startsWith(target)){
        if(text.length < bestLen){ best = el; bestLen = text.length; }
      }
    }
    return best;
  }

  function findAddButton(fromEl){
    // Walk up a few ancestor levels looking for a clickable "+" / add control nearby.
    let node = fromEl;
    for(let depth = 0; depth < 6 && node; depth++){
      const candidates = node.querySelectorAll('button, [role="button"], a');
      for(const c of candidates){
        const t = (c.textContent || '').trim();
        const aria = (c.getAttribute('aria-label') || '').toLowerCase();
        if(t === '+' || aria.includes('toevoegen') || aria.includes('add')) return c;
      }
      node = node.parentElement;
    }
    return null;
  }

  // After clicking add, a variant modal may appear. Try to find and select an
  // option matching `note`, then click a confirm/add button inside the modal.
  async function handlePossibleModal(note){
    await sleep(400);
    // Heuristic: look for a newly-visible container with many button/option-like children.
    const modalCandidates = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="Modal"]'));
    let modal = modalCandidates.find(m => m.offsetParent !== null) || null;
    if(!modal){
      // Fallback: no modal detected, nothing more to do.
      return true;
    }
    if(note){
      const options = Array.from(modal.querySelectorAll('button, [role="button"], label, div'));
      const match = options.find(o => (o.textContent||'').trim().toLowerCase() === note.toLowerCase());
      if(match){ match.click(); await sleep(200); }
    }
    // Try to find a confirm/add-to-cart button inside the modal.
    const confirmBtn = Array.from(modal.querySelectorAll('button')).find(b=>{
      const t = (b.textContent||'').toLowerCase();
      return t.includes('toevoegen') || t.includes('bestellen') || t.includes('mandje');
    });
    if(confirmBtn){ confirmBtn.click(); await sleep(300); }
    return true;
  }

  async function processItem(item){
    const row = logRow(`${item.qty}x ${item.name}${item.note ? ' ('+item.note+')' : ''}`, 'pending');
    const card = findProductCard(item.name);
    if(!card){ updateRow(row, 'fail'); return; }
    card.classList.add(PREFIX + 'found-flash');
    for(let i = 0; i < item.qty; i++){
      if(stopRequested) break;
      const btn = findAddButton(card);
      if(!btn){ updateRow(row, 'fail'); return; }
      btn.click();
      await handlePossibleModal(item.note);
      await sleep(300);
    }
    card.classList.remove(PREFIX + 'found-flash');
    updateRow(row, 'ok');
  }

  async function run(){
    const raw = document.getElementById(PREFIX + 'input').value;
    const items = parseList(raw);
    if(items.length === 0){ alert('Geen items herkend. Plak de tekst zoals gekopieerd uit de lunchtool.'); return; }
    document.getElementById(PREFIX + 'log').innerHTML = '';
    document.getElementById(PREFIX + 'start').style.display = 'none';
    document.getElementById(PREFIX + 'stop').style.display = 'block';
    stopRequested = false;
    for(const item of items){
      if(stopRequested) break;
      await processItem(item);
    }
    document.getElementById(PREFIX + 'start').style.display = 'block';
    document.getElementById(PREFIX + 'stop').style.display = 'none';
  }

  document.getElementById(PREFIX + 'start').onclick = run;
  document.getElementById(PREFIX + 'stop').onclick = () => { stopRequested = true; };

  function deactivate(){
    panel.remove();
    badge.remove();
    style.remove();
    window.__afActive = false;
  }
  window.__afDeactivate = deactivate;
})();
