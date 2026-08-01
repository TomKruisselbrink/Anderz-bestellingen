/* Anderz Auto-invuller — bookmarklet (v2, gebaseerd op de echte site-structuur)
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
    #${PREFIX}log .warn{ color:#e0c060; }
    #${PREFIX}log .pending{ color:#999; }
    #${PREFIX}badge{
      position:fixed; bottom:16px; left:16px; z-index:2147483000;
      background:#b23a2e; color:#fff; font:12px -apple-system,Segoe UI,sans-serif;
      padding:8px 12px; border-radius:20px; box-shadow:0 4px 14px rgba(0,0,0,.4); cursor:pointer;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = PREFIX + 'panel';
  panel.innerHTML = `
    <h3>🛒 Anderz Auto-invuller</h3>
    <textarea id="${PREFIX}input" placeholder="Plak hier de verzamellijst (Kopieer voor auto-invullen), óf plak direct de rijen uit je Google Sheet"></textarea>
    <div class="hint" style="margin-top:0">Beide formats werken: de opgetelde lijst uit de lunchtool, of losse Sheet-rijen (per persoon) — die worden dan automatisch bij elkaar opgeteld.</div>
    <button class="primary" id="${PREFIX}start">Start invullen</button>
    <button id="${PREFIX}stop" style="display:none">Stop</button>
    <div id="${PREFIX}log"></div>
    <div class="hint">Zet producten en varianten in het mandje. Rondt nooit zelf af of betaalt — dat blijft altijd bij jou. Controleer het mandje na afloop.</div>
  `;
  document.body.appendChild(panel);

  const badge = document.createElement('div');
  badge.id = PREFIX + 'badge';
  badge.textContent = '🛒 Auto-invuller actief — klik om te stoppen';
  badge.onclick = deactivate;
  document.body.appendChild(badge);

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
  async function waitFor(cond, timeout){
    const start = Date.now();
    while(Date.now() - start < timeout){
      if(cond()) return true;
      await sleep(50);
    }
    return false;
  }
  function normalize(s){ return (s||'').trim().toLowerCase().replace(/\.+$/,'').replace(/\s+/g,' '); }
  function normalizeLoose(s){ return normalize(s).replace(/\s*saus\.?$/,'').trim(); }

  function logRow(text){
    const log = document.getElementById(PREFIX + 'log');
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${text}</span><span class="pending">…</span>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function updateRow(row, status, note){
    const s = row.querySelector('span:last-child');
    s.className = status;
    const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✕';
    s.textContent = icon + (note ? ' ' + note : '');
  }

  function parseSheetRows(raw){
    const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const agg = {};
    const order = [];
    lines.forEach(line=>{
      const cols = line.split('\t').map(c=>c.trim());
      if(cols.length < 4) return;
      if(cols[0].toLowerCase() === 'tijdstip') return; // header row
      const name = cols[1];
      if(!name || /—\s*totaal/i.test(name)) return; // skip TOTAAL rows and blanks
      const qty = parseInt(cols[2]);
      const itemName = cols[3];
      const note = cols[4] || '';
      if(!qty || !itemName) return;
      const key = itemName + '::' + note;
      if(!(key in agg)){ agg[key] = 0; order.push(key); }
      agg[key] += qty;
    });
    return order.map(key => {
      const idx = key.indexOf('::');
      return { qty: agg[key], name: key.slice(0, idx), note: key.slice(idx+2) };
    });
  }

  function parseList(raw){
    if(raw.includes('\t')){
      return parseSheetRows(raw);
    }
    return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(\d+)\s*x\s+(.+?)(?:::(.*))?$/i);
      if(!m) return null;
      return { qty: parseInt(m[1]), name: m[2].trim(), note: (m[3]||'').trim() };
    }).filter(Boolean);
  }

  function findProductCard(name){
    const target = normalize(name);
    const cards = Array.from(document.querySelectorAll('li.cell.product'));
    let card = cards.find(c => {
      const h3 = c.querySelector('footer.card-footer h3');
      return h3 && normalize(h3.textContent) === target;
    });
    if(!card){
      card = cards.find(c => {
        const h3 = c.querySelector('footer.card-footer h3');
        return h3 && normalize(h3.textContent).startsWith(target);
      });
    }
    return card;
  }

  function findCartItem(name, note){
    const items = Array.from(document.querySelectorAll('.cart-item'));
    const targetName = normalize(name);
    const targetNote = normalize(note);
    return items.find(it=>{
      const t = normalize(it.textContent);
      return t.includes(targetName) && (!targetNote || t.includes(targetNote));
    });
  }

  async function processItem(item){
    const row = logRow(`${item.qty}x ${item.name}${item.note ? ' ('+item.note+')' : ''}`);

    const card = findProductCard(item.name);
    if(!card){ updateRow(row, 'fail', 'niet gevonden op pagina'); return; }

    const addBtn = card.querySelector('.add-to-cart');
    if(!addBtn){ updateRow(row, 'fail', 'geen +knop gevonden'); return; }
    const cartCountBefore = document.querySelectorAll('.cart-item').length;
    addBtn.click();
    await waitFor(() =>
      document.querySelector('.modal.additionals.modal-show') ||
      document.querySelectorAll('.cart-item').length !== cartCountBefore,
      4000
    );
    await sleep(150); // let the modal/cart finish rendering its content

    let optionWarning = '';
    const modal = document.querySelector('.modal.additionals.modal-show');
    if(modal){
      if(item.note){
        const targetNote = normalize(item.note);
        const targetLoose = normalizeLoose(item.note);
        const labels = Array.from(modal.querySelectorAll('li.cell.small label'));
        let match = labels.find(l => normalize(l.textContent) === targetNote);
        if(!match) match = labels.find(l => normalize(l.textContent).includes(targetNote) || targetNote.includes(normalize(l.textContent)));
        if(!match) match = labels.find(l => normalizeLoose(l.textContent) === targetLoose);
        if(!match) match = labels.find(l => normalizeLoose(l.textContent).includes(targetLoose) || targetLoose.includes(normalizeLoose(l.textContent)));
        if(match){ match.click(); await sleep(200); }
        else {
          // Don't skip the whole item over a missing modifier — add it anyway and flag for a manual check.
          optionWarning = `optie "${item.note}" niet gevonden — controleer handmatig`;
        }
      }
      const confirmBtn = modal.querySelector('.button-add');
      if(!confirmBtn){ updateRow(row, 'fail', 'geen bevestigknop'); return; }
      const cartCountBeforeConfirm = document.querySelectorAll('.cart-item').length;
      confirmBtn.click();
      await waitFor(() =>
        !document.querySelector('.modal.additionals.modal-show') &&
        document.querySelectorAll('.cart-item').length !== cartCountBeforeConfirm,
        4000
      );
      await sleep(150);
    }

    if(item.qty > 1){
      const cartItem = await (async () => {
        let ci = null;
        await waitFor(() => (ci = findCartItem(item.name, optionWarning ? '' : item.note)), 3000);
        return ci;
      })();
      if(cartItem){
        const inc = cartItem.querySelector('.increment');
        if(inc){
          for(let i = 1; i < item.qty; i++){
            if(stopRequested) break;
            inc.click();
            await sleep(300); // stepper updates in place; a short fixed pause is reliable here
          }
        }
      }
    }

    await sleep(200); // small buffer before moving to the next item
    updateRow(row, optionWarning ? 'warn' : 'ok', optionWarning);
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
      try{
        await processItem(item);
      } catch(err){
        const row = logRow(`${item.qty}x ${item.name}${item.note ? ' ('+item.note+')' : ''}`);
        updateRow(row, 'fail', 'onverwachte fout: ' + (err && err.message ? err.message : err));
        // Try to close any stray open modal so the next item can start cleanly.
        const stray = document.querySelector('.modal.additionals.modal-show .button-cancel');
        if(stray){ stray.click(); await sleep(300); }
      }
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

