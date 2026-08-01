/* Visual Element Editor — bookmarklet
   Klik op elk element op een pagina om het visueel te bewerken (kleuren, randen,
   ronding, lettergrootte, padding, positie). Exporteert de wijzigingen als CSS
   die je terug kan sturen om in het echte bestand te laten verwerken.
*/
(function () {
  if (window.__vveActive) { window.__vveDeactivate && window.__vveDeactivate(); return; }
  window.__vveActive = true;

  const PREFIX = '__vve_';
  let selected = null;
  let idCounter = 0;
  const changes = new Map(); // selector -> { css:{}, tx:0, ty:0 }
  let dragging = false, dragStart = null, dragOrigin = null;

  // ---------- styles for the editor UI itself ----------
  const style = document.createElement('style');
  style.id = PREFIX + 'style';
  style.textContent = `
    .${PREFIX}hover-outline{ outline:2px dashed #4da3ff !important; outline-offset:1px; cursor:crosshair !important; }
    .${PREFIX}selected-outline{ outline:2px solid #ff5a3c !important; outline-offset:1px; }
    #${PREFIX}panel{
      position:fixed; top:16px; right:16px; width:260px; max-height:calc(100vh - 32px);
      overflow-y:auto; background:#1f1e1c; color:#eee; font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
      border:1px solid #444; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.5);
      z-index:2147483000; padding:14px;
    }
    #${PREFIX}panel h3{ margin:0 0 10px; font-size:14px; }
    #${PREFIX}panel label{ display:block; font-size:11px; color:#aaa; margin:10px 0 4px; text-transform:uppercase; letter-spacing:.03em; }
    #${PREFIX}panel input[type=color]{ width:100%; height:28px; padding:0; border:1px solid #555; border-radius:6px; background:none; }
    #${PREFIX}panel input[type=range]{ width:100%; }
    #${PREFIX}panel input[type=number]{ width:100%; background:#2a2926; color:#eee; border:1px solid #555; border-radius:6px; padding:5px 7px; }
    #${PREFIX}panel .row{ display:flex; gap:8px; }
    #${PREFIX}panel .row > div{ flex:1; }
    #${PREFIX}panel button{
      font-size:12px; font-weight:600; padding:7px 10px; border-radius:6px; border:1px solid #555;
      background:#2a2926; color:#eee; cursor:pointer; margin-top:8px; width:100%;
    }
    #${PREFIX}panel button.primary{ background:#c0392b; border-color:#c0392b; color:#fff; }
    #${PREFIX}panel .hint{ font-size:11px; color:#888; margin-top:10px; line-height:1.5; }
    #${PREFIX}panel textarea{
      width:100%; min-height:140px; background:#111; color:#9fe39f; font:11px/1.4 monospace;
      border:1px solid #555; border-radius:6px; padding:8px; margin-top:8px;
    }
    #${PREFIX}badge{
      position:fixed; bottom:16px; left:16px; z-index:2147483000;
      background:#c0392b; color:#fff; font:12px -apple-system,Segoe UI,sans-serif;
      padding:8px 12px; border-radius:20px; box-shadow:0 4px 14px rgba(0,0,0,.4);
      cursor:pointer;
    }
  `;
  document.head.appendChild(style);

  // ---------- helpers ----------
  function px(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function rgbToHex(rgb){
    if(!rgb || rgb.indexOf('rgb') === -1) return '#000000';
    const m = rgb.match(/\d+/g).map(Number);
    return '#' + m.slice(0,3).map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function isEditorNode(el){
    return el && (el.id === PREFIX+'panel' || el.id === PREFIX+'badge' || (el.closest && el.closest('#'+PREFIX+'panel')));
  }
  function getSelector(el){
    if(el.id) return '#' + el.id;
    if(el.dataset.vveId) return `[data-vve-id="${el.dataset.vveId}"]`;
    idCounter++;
    el.dataset.vveId = idCounter;
    return `[data-vve-id="${idCounter}"]`;
  }
  function recordChange(el, prop, value){
    const sel = getSelector(el);
    if(!changes.has(sel)) changes.set(sel, { css:{}, tx:0, ty:0 });
    changes.get(sel).css[prop] = value;
  }

  // ---------- hover + selection ----------
  function onMouseOver(e){
    if(dragging || isEditorNode(e.target)) return;
    e.target.classList.add(PREFIX+'hover-outline');
  }
  function onMouseOut(e){
    e.target.classList.remove(PREFIX+'hover-outline');
  }
  function onClick(e){
    if(isEditorNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(e.target);
  }

  function selectElement(el){
    if(selected) selected.classList.remove(PREFIX+'selected-outline');
    selected = el;
    selected.classList.add(PREFIX+'selected-outline');
    renderPanel();
  }

  // ---------- dragging (mousedown + move > 5px = drag; else = click/select) ----------
  function onMouseDown(e){
    if(isEditorNode(e.target)) return;
    dragStart = { x: e.clientX, y: e.clientY };
    dragOrigin = e.target;
  }
  function onMouseMove(e){
    if(!dragStart || isEditorNode(dragOrigin)) return;
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if(!dragging && Math.hypot(dx,dy) > 5){
      dragging = true;
      selectElement(dragOrigin);
      const sel = getSelector(selected);
      if(!changes.has(sel)) changes.set(sel, { css:{}, tx:0, ty:0 });
    }
    if(dragging){
      const sel = getSelector(selected);
      const c = changes.get(sel);
      c.tx += dx; c.ty += dy;
      selected.style.transform = `translate(${c.tx}px, ${c.ty}px)`;
      dragStart = { x: e.clientX, y: e.clientY };
      updatePosInputs(c.tx, c.ty);
    }
  }
  function onMouseUp(){
    dragStart = null; dragOrigin = null;
    setTimeout(()=>{ dragging = false; }, 0);
  }

  function updatePosInputs(tx, ty){
    const xi = document.getElementById(PREFIX+'posx');
    const yi = document.getElementById(PREFIX+'posy');
    if(xi) xi.value = Math.round(tx);
    if(yi) yi.value = Math.round(ty);
  }

  function alignElement(mode){
    if(!selected || !selected.parentElement) return;
    const parent = selected.parentElement;
    const sel = getSelector(selected);
    const c = changes.get(sel) || { css:{}, tx:0, ty:0 };

    // Measure without the current x-offset, so alignment is computed from the
    // element's natural (untranslated) position each time.
    const savedTransform = selected.style.transform;
    selected.style.transform = `translate(0px, ${c.ty}px)`;

    if(mode === 'justify'){
      const pr = parent.getBoundingClientRect();
      const csEl = getComputedStyle(parent);
      const innerWidth = pr.width - px(csEl.paddingLeft) - px(csEl.paddingRight);
      selected.style.width = innerWidth + 'px';
      selected.style.boxSizing = 'border-box';
      recordChange(selected, 'width', innerWidth + 'px');
      recordChange(selected, 'box-sizing', 'border-box');
    }

    const er = selected.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    let tx = 0;
    if(mode === 'left' || mode === 'justify'){
      tx = pr.left - er.left;
    } else if(mode === 'center'){
      tx = (pr.left + pr.width/2) - (er.left + er.width/2);
    } else if(mode === 'right'){
      tx = pr.right - er.right;
    }

    c.tx = tx;
    changes.set(sel, c);
    selected.style.transform = `translate(${tx}px, ${c.ty}px)`;
    updatePosInputs(tx, c.ty);
  }

  // ---------- panel UI ----------
  function renderPanel(){
    let panel = document.getElementById(PREFIX+'panel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = PREFIX+'panel';
      document.body.appendChild(panel);
    }
    if(!selected){
      panel.innerHTML = `<h3>🎨 Visual Editor</h3><p class="hint">Klik op een element op de pagina om het te bewerken. Klik-en-sleep om te verplaatsen.</p>
        <button class="primary" id="${PREFIX}exportBtn">Exporteer wijzigingen</button>`;
      document.getElementById(PREFIX+'exportBtn').onclick = showExport;
      return;
    }

    const cs = getComputedStyle(selected);
    const sel = getSelector(selected);
    const c = changes.get(sel) || { tx:0, ty:0 };

    panel.innerHTML = `
      <h3>🎨 Visual Editor</h3>
      <div class="hint">Geselecteerd: <code>${selected.tagName.toLowerCase()}${selected.className ? '.'+String(selected.className).split(' ').filter(x=>!x.startsWith(PREFIX)).join('.') : ''}</code></div>

      <label>Achtergrondkleur</label>
      <input type="color" id="${PREFIX}bg" value="${rgbToHex(cs.backgroundColor)}">

      <label>Tekstkleur</label>
      <input type="color" id="${PREFIX}fg" value="${rgbToHex(cs.color)}">

      <div class="row">
        <div><label>Randkleur</label><input type="color" id="${PREFIX}bc" value="${rgbToHex(cs.borderColor)}"></div>
        <div><label>Randdikte (px)</label><input type="number" id="${PREFIX}bw" min="0" max="20" value="${px(cs.borderWidth)}"></div>
      </div>

      <label>Ronding (px)</label>
      <input type="range" id="${PREFIX}br" min="0" max="60" value="${px(cs.borderRadius)}">

      <label>Lettergrootte (px)</label>
      <input type="range" id="${PREFIX}fs" min="8" max="60" value="${px(cs.fontSize)}">

      <label>Padding (px)</label>
      <input type="range" id="${PREFIX}pd" min="0" max="60" value="${px(cs.paddingTop)}">

      <div class="row">
        <div><label>Positie X (px)</label><input type="number" id="${PREFIX}posx" value="${Math.round(c.tx)}"></div>
        <div><label>Positie Y (px)</label><input type="number" id="${PREFIX}posy" value="${Math.round(c.ty)}"></div>
      </div>

      <label>Uitlijnen (t.o.v. omliggend element)</label>
      <div class="row" style="gap:6px;">
        <button id="${PREFIX}alignLeft" title="Links uitlijnen" style="margin-top:0;">⯇</button>
        <button id="${PREFIX}alignCenter" title="Centreren" style="margin-top:0;">▣</button>
        <button id="${PREFIX}alignRight" title="Rechts uitlijnen" style="margin-top:0;">⯈</button>
        <button id="${PREFIX}alignJustify" title="Uitvullen (volledige breedte)" style="margin-top:0;">☰</button>
      </div>

      <button id="${PREFIX}editTextBtn">✏️ Tekst bewerken</button>
      <button id="${PREFIX}hideBtn">🙈 Verberg element</button>
      <button id="${PREFIX}deselectBtn">Deselecteren</button>
      <button class="primary" id="${PREFIX}exportBtn">Exporteer wijzigingen</button>
    `;

    document.getElementById(PREFIX+'bg').oninput = e => { selected.style.backgroundColor = e.target.value; recordChange(selected,'background-color', e.target.value); };
    document.getElementById(PREFIX+'fg').oninput = e => { selected.style.color = e.target.value; recordChange(selected,'color', e.target.value); };
    document.getElementById(PREFIX+'bc').oninput = e => { selected.style.borderColor = e.target.value; selected.style.borderStyle = selected.style.borderStyle || 'solid'; recordChange(selected,'border-color', e.target.value); recordChange(selected,'border-style','solid'); };
    document.getElementById(PREFIX+'bw').oninput = e => { selected.style.borderWidth = e.target.value+'px'; selected.style.borderStyle = selected.style.borderStyle || 'solid'; recordChange(selected,'border-width', e.target.value+'px'); recordChange(selected,'border-style','solid'); };
    document.getElementById(PREFIX+'br').oninput = e => { selected.style.borderRadius = e.target.value+'px'; recordChange(selected,'border-radius', e.target.value+'px'); };
    document.getElementById(PREFIX+'fs').oninput = e => { selected.style.fontSize = e.target.value+'px'; recordChange(selected,'font-size', e.target.value+'px'); };
    document.getElementById(PREFIX+'pd').oninput = e => { selected.style.padding = e.target.value+'px'; recordChange(selected,'padding', e.target.value+'px'); };
    document.getElementById(PREFIX+'posx').oninput = e => {
      const cc = changes.get(sel) || { css:{}, tx:0, ty:0 }; cc.tx = px(e.target.value); changes.set(sel, cc);
      selected.style.transform = `translate(${cc.tx}px, ${cc.ty}px)`;
    };
    document.getElementById(PREFIX+'posy').oninput = e => {
      const cc = changes.get(sel) || { css:{}, tx:0, ty:0 }; cc.ty = px(e.target.value); changes.set(sel, cc);
      selected.style.transform = `translate(${cc.tx}px, ${cc.ty}px)`;
    };
    document.getElementById(PREFIX+'editTextBtn').onclick = () => {
      selected.setAttribute('contenteditable', 'true');
      selected.focus();
    };
    document.getElementById(PREFIX+'alignLeft').onclick = () => alignElement('left');
    document.getElementById(PREFIX+'alignCenter').onclick = () => alignElement('center');
    document.getElementById(PREFIX+'alignRight').onclick = () => alignElement('right');
    document.getElementById(PREFIX+'alignJustify').onclick = () => alignElement('justify');
    document.getElementById(PREFIX+'hideBtn').onclick = () => {
      selected.style.display = 'none';
      recordChange(selected, 'display', 'none');
      selected = null;
      renderPanel();
    };
    document.getElementById(PREFIX+'deselectBtn').onclick = () => {
      selected.classList.remove(PREFIX+'selected-outline');
      selected = null;
      renderPanel();
    };
    document.getElementById(PREFIX+'exportBtn').onclick = showExport;
  }

  function showExport(){
    let css = '';
    changes.forEach((val, sel) => {
      const props = Object.assign({}, val.css);
      if(val.tx || val.ty) props['transform'] = `translate(${Math.round(val.tx)}px, ${Math.round(val.ty)}px)`;
      const propLines = Object.entries(props).map(([k,v]) => `  ${k}: ${v};`).join('\n');
      if(propLines) css += `${sel} {\n${propLines}\n}\n\n`;
    });
    if(!css) css = '/* Nog geen wijzigingen gemaakt */';

    const panel = document.getElementById(PREFIX+'panel');
    panel.innerHTML = `
      <h3>📋 Wijzigingen</h3>
      <p class="hint">Kopieer dit blok en stuur het naar Claude, samen met de naam van de pagina — dan wordt het in het echte bestand verwerkt.</p>
      <textarea readonly id="${PREFIX}exportArea">${css}</textarea>
      <button class="primary" id="${PREFIX}copyBtn">Kopieer</button>
      <button id="${PREFIX}backBtn">Terug</button>
    `;
    document.getElementById(PREFIX+'copyBtn').onclick = () => {
      const ta = document.getElementById(PREFIX+'exportArea');
      ta.select();
      navigator.clipboard.writeText(ta.value).catch(()=>{});
    };
    document.getElementById(PREFIX+'backBtn').onclick = renderPanel;
  }

  // ---------- badge (deactivate button) ----------
  const badge = document.createElement('div');
  badge.id = PREFIX+'badge';
  badge.textContent = '🎨 Visual Editor actief — klik om te stoppen';
  badge.onclick = deactivate;
  document.body.appendChild(badge);

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('click', onClick, true);

  function deactivate(){
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('click', onClick, true);
    document.querySelectorAll('.'+PREFIX+'hover-outline').forEach(el=>el.classList.remove(PREFIX+'hover-outline'));
    document.querySelectorAll('.'+PREFIX+'selected-outline').forEach(el=>el.classList.remove(PREFIX+'selected-outline'));
    const panel = document.getElementById(PREFIX+'panel'); if(panel) panel.remove();
    badge.remove();
    style.remove();
    window.__vveActive = false;
  }
  window.__vveDeactivate = deactivate;

  renderPanel();
})();
