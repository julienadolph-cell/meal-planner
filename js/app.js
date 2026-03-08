
(function(){
  const DAY_KEYS=['lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const DAY_LABELS=['LUN soir','MAR soir','MER soir','JEU soir','VEN soir','SAM soir'];
  const SHORT_DAYS=['Lun','Mar','Mer','Jeu','Ven'];
  const state={weekNum:null, mode:null, recipes:null, extras:null, index:null, nutrition:null, generated:{}};

  // ─── PROFILS & PORTIONS CIBLES ──────────────────────────────────────────
  // Portions en grammes CUITS par personne par repas
  // lunchbox:true = Julien + AC uniquement
  const PROFILS = {
    julien: {
      label:'Julien', emoji:'👨', color:'#F5A623', lunchbox:true,
      portions:    { feculent:200, proteine:150, legume:150, huile:10 },
      portions_lb: { feculent:250, proteine:180, legume:150, huile:10 },
      kcal_jour:2150, prot_jour:100, gluc_jour:260, lip_jour:70,
    },
    ac: {
      label:'AC', emoji:'👩', color:'#E91E8C', lunchbox:true,
      portions:    { feculent:150, proteine:130, legume:150, huile:8 },
      portions_lb: { feculent:200, proteine:150, legume:150, huile:8 },
      kcal_jour:1850, prot_jour:80, gluc_jour:240, lip_jour:60,
    },
    lucas: {
      label:'Lucas', emoji:'🧒', color:'#4EA8DE', lunchbox:false,
      // Perte douce — 14a 177cm 92kg — plus légumes, moins féculents
      portions:    { feculent:150, proteine:150, legume:200, huile:8 },
      portions_lb: null,
      kcal_jour:2350, prot_jour:120, gluc_jour:300, lip_jour:75,
    },
    tim: {
      label:'Tim', emoji:'👦', color:'#4CAF50', lunchbox:false,
      // Croissance — 12a 145cm 45kg
      portions:    { feculent:150, proteine:120, legume:150, huile:5 },
      portions_lb: null,
      kcal_jour:2000, prot_jour:80, gluc_jour:250, lip_jour:65,
    },
  };

  // Laitage servi au dîner uniquement (pas lunchbox)
  const COMPLEMENT_REPAS = [
    { ingredient:'fromage',       quantite:30,  unite:'g', label:'🧀 Fromage' },
    { ingredient:'yaourt_nature', quantite:125, unite:'g', label:'🥛 Yaourt'  },
  ];

  // Classification des ingrédients pour appliquer les portions cibles
  const TYPE_ING = {
    feculent: ['riz_blanc','quinoa','pate_blanche','lentille_corail','lentille_verte',
               'pois_chiche','haricot_rouge','pomme_de_terre','patate_douce'],
    proteine: ['poulet_cru','cabillaud','saumon','colin','boeuf_hache',
               'boeuf_morceau','veau','tofu'],
    legume:   ['brocoli','carotte','courgette','tomate','tomate_concassee','oignon',
               'oignon_rouge','champignon','poivron_rouge','epinard','courge',
               'poireau','petit_pois','haricot_vert','chou_fleur','chou','celeri'],
    huile:    ['huile_olive','huile_sesame','huile_coco'],
  };
  function getTypeIng(nom){
    for(const [type,liste] of Object.entries(TYPE_ING)){
      if(liste.includes(nom)) return type;
    }
    return 'autre';
  }

  // Calcule la portion personnalisée d'un profil pour une recette
  function calcPortionProfil(recette, profilKey, isLunchbox){
    const profil = PROFILS[profilKey];
    const nb = recette.portions_base || 4;
    const cibles = isLunchbox ? profil.portions_lb : profil.portions;
    if(!cibles) return null; // pas de lunchbox pour ce profil

    const nutri = state.nutrition;
    let kcal=0, prot=0, gluc=0, lip=0, fib=0;

    const ings = recette.ingredients.map(ing => {
      if(ing.unite !== 'g'){
        // unités non-grammes (pièces, pots…) → proportion neutre
        return {...ing, quantite: Math.round(ing.quantite / nb * 10) / 10};
      }
      const type = getTypeIng(ing.ingredient);
      // Appliquer la cible du profil si le type est connu, sinon proportion neutre
      const q = (cibles[type] !== undefined)
        ? cibles[type]
        : Math.round(ing.quantite / nb * 10) / 10;
      const n = nutri[ing.ingredient];
      if(n){
        kcal += n.kcal       * q / 100;
        prot += n.proteines  * q / 100;
        gluc += n.glucides   * q / 100;
        lip  += n.lipides    * q / 100;
        fib  += (n.fibres||0)* q / 100;
      }
      return {...ing, quantite: q};
    });

    // Laitage au dîner uniquement
    const extras = isLunchbox ? [] : COMPLEMENT_REPAS.map(c=>({...c}));
    extras.forEach(c => {
      const n = nutri[c.ingredient];
      if(n && c.unite==='g'){
        kcal += n.kcal      * c.quantite / 100;
        prot += n.proteines * c.quantite / 100;
        gluc += n.glucides  * c.quantite / 100;
        lip  += n.lipides   * c.quantite / 100;
      }
    });

    return {
      ingredients: [...ings, ...extras],
      kcal: Math.round(kcal),
      prot: Math.round(prot),
      gluc: Math.round(gluc),
      lip:  Math.round(lip),
      fib:  Math.round(fib),
    };
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────
  function slugMode(type){return type==='avec'?'enfants':'sans_enfants';}
  function prettyMode(type){return type==='avec'?'Avec enfants':'Sans enfants';}
  function currentType(){return state.mode==='enfants'?'avec':'sans';}
  function clone(o){return JSON.parse(JSON.stringify(o));}
  function getRotationIndex(){return ((state.weekNum||1)-1)%4;}
  function recipeScale(type){return type==='avec'?1.5:1;}
  function escapeHtml(str){return String(str).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
  function displayQty(item){
    const q=item.quantite;
    const u=item.unite;
    if(item.ingredient==='oeuf') return q===1?'1 œuf':`${q} œufs`;
    if(u==='piece') return `${q} pièce${q>1?'s':''}`;
    if(u==='pot') return `${q} pot${q>1?'s':''}`;
    if(u==='pain') return `${q} pain${q>1?'s':''}`;
    if(u==='paquet') return `${q} paquet${q>1?'s':''}`;
    if(u==='bouteille') return `${q} bouteille${q>1?'s':''}`;
    return `${Math.round(q*10)/10}${u}`;
  }
  function humanIngredient(name){
    return name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
      .replace('Oeuf','Œuf').replace('Pain Complet','Pain complet').replace('Yaourt Nature','Yaourt nature');
  }
  function getRayon(name){
    const n=name.toLowerCase();
    // Viandes & poissons en premier
    if(/poulet|boeuf|veau|jambon|chorizo/.test(n)) return '🥩 Viandes';
    if(/saumon|cabillaud|colin/.test(n)) return '🐟 Poissons';
    // Produits frais
    if(/yaourt|fromage|lait|feta|mozzarella|emmental|ricotta|burrata|beurre/.test(n)) return '🥛 Produits frais';
    // Légumes AVANT fruits (poireau, pomme_de_terre, tomate avant pomme)
    if(/courgette|carotte|brocoli|oignon|tomate|champignon|courge|poivron|citron|poireau|pomme_de_terre|patate_douce|epinard|haricot_vert|chou|celeri|fenouil|aubergine|courgette|betterave/.test(n)) return '🥕 Légumes';
    // Fruits
    if(/^pomme$|banane|kiwi|orange|poire|raisin|fruit|mangue|ananas|fraise|framboise|cerise|peche|abricot|melon|pastèque/.test(n)) return '🍎 Fruits';
    if(/riz|quinoa|pate|farine|pain|galette/.test(n)) return '🌾 Féculents';
    if(/lentille|pois_chiche|haricot|tofu|houmous/.test(n)) return '🥫 Épicerie salée';
    if(/miel|sucre|confiture|chocolat|compote|biscuit|sirop/.test(n)) return '🍯 Épicerie sucrée';
    if(/huile|sauce|curry|paprika|gingembre|cumin|curcuma|cannelle|poivre|sel|vinaigre|moutarde|soja|tahini|coriandre|basilic|persil|thym|laurier/.test(n)) return '🧂 Assaisonnements';
    return '🧺 Divers';
  }
  function aggregateItems(items, map, factor=1){
    items.forEach(item=>{
      const key=item.ingredient;
      if(!map[key]) map[key]={ingredient:key, quantite:0, unite:item.unite};
      map[key].quantite += item.quantite * factor;
    });
  }
  function getExtras(type){
    const bucket=state.extras[slugMode(type)];
    const rot=getRotationIndex();
    return {
      petits_dej_labels: bucket.petits_dej_labels,
      petits_dej_items:  bucket.petits_dej_items,
      brunch_label:      bucket.brunch_label,
      brunch_items:      bucket.brunch_items,
      gouters_labels: type==='avec' ? bucket.gouters_rotations[rot].labels : [],
      gouters_items:  type==='avec' ? bucket.gouters_rotations[rot].items  : []
    };
  }
  function getGeneratedWeek(type){
    if(state.generated[type]) return state.generated[type];
    const weekSeed = type==='avec'
      ? (state.weekNum%2===1 ? state.weekNum : state.weekNum+1)
      : (state.weekNum%2===0 ? state.weekNum : state.weekNum+1);
    state.generated[type]=window.generateWeekFromRecipes(state.recipes, slugMode(type), weekSeed);
    return state.generated[type];
  }

  // ─── LISTE DE COURSES ───────────────────────────────────────────────────
  function computeCourses(type){
    const week=getGeneratedWeek(type);
    const totals={};
    const factor=recipeScale(type);
    week.forEach(r=> aggregateItems(r.ingredients, totals, factor));
    // Ajouter laitage dîner (fromage 30g + yaourt 125g) × 6 dîners × nb personnes
    const isEnfants=(type==='avec');
    const nbPersonnes=isEnfants?4:2;
    const nbDiners=6;
    COMPLEMENT_REPAS.forEach(c=>{
      if(!totals[c.ingredient]) totals[c.ingredient]={ingredient:c.ingredient, quantite:0, unite:c.unite};
      totals[c.ingredient].quantite += c.quantite * nbPersonnes * nbDiners;
    });
    const extras=getExtras(type);
    aggregateItems(extras.petits_dej_items, totals, 1);
    aggregateItems(extras.brunch_items,     totals, 1);
    aggregateItems(extras.gouters_items,    totals, 1);
    return totals;
  }
  function renderCoursesModal(type){
    const totals=computeCourses(type);
    const byRayon={};
    Object.values(totals).forEach(item=>{
      const rayon=getRayon(item.ingredient);
      (byRayon[rayon]||(byRayon[rayon]=[])).push(item);
    });
    const order=['🥕 Légumes','🍎 Fruits','🥩 Viandes','🐟 Poissons','🥛 Produits frais','🌾 Féculents','🥫 Épicerie salée','🍯 Épicerie sucrée','🧂 Assaisonnements','🧺 Divers'];
    const modal=document.getElementById('courses-modal');
    document.getElementById('courses-title').textContent=`🛒 Courses Semaine ${state.weekNum} — ${prettyMode(type)}`;
    const content=document.getElementById('courses-content');
    content.innerHTML='';
    let txt=`🛒 LISTE DE COURSES — Semaine ${state.weekNum}\n${prettyMode(type)}\n\n`;
    order.forEach(rayon=>{
      const items=(byRayon[rayon]||[]).sort((a,b)=>humanIngredient(a.ingredient).localeCompare(humanIngredient(b.ingredient),'fr'));
      if(!items.length) return;
      txt += `${rayon}\n`;
      const wrap=document.createElement('div');
      wrap.style.marginBottom='14px';
      wrap.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:1px;padding:6px 0;margin-bottom:4px;border-bottom:1px solid var(--border);">${rayon}</div>`;
      items.forEach(item=>{
        const label=humanIngredient(item.ingredient);
        const qty=displayQty(item);
        txt += `□ ${label} — ${qty}\n`;
        const row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;padding:4px 0 4px 10px;border-bottom:1px solid var(--border);font-size:12px;';
        row.innerHTML=`<input type="checkbox" style="accent-color:var(--green);width:13px;height:13px;flex-shrink:0;"><span style="flex:1;color:var(--text);">${label}</span><span style="color:var(--green);font-weight:700;font-size:12px;">${qty}</span>`;
        wrap.appendChild(row);
      });
      content.appendChild(wrap);
    });
    document.getElementById('btn-gmail').onclick=()=>{
      const subject=encodeURIComponent(`Courses Semaine ${state.weekNum} — ${prettyMode(type)}`);
      const body=encodeURIComponent(txt);
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`,'_blank');
    };
    modal.style.display='flex';
  }

  // ─── MENU TABLE ─────────────────────────────────────────────────────────
  function renderMenuTable(type){
    const week=getGeneratedWeek(type);
    const extras=getExtras(type);
    const body=document.getElementById(type==='avec'?'menu-avec-body':'menu-sans-body');
    const label=document.getElementById(type==='avec'?'week-label-avec':'week-label-sans');
    if(!body) return;
    body.innerHTML='';
    week.forEach((r,idx)=>{
      const tr=document.createElement('tr');
      const conserv = idx<=2 ? '❄️ Frigo' : '🧊 Congélateur';
      const lb = idx<5 ? `→ Lunchbox ${DAY_LABELS[idx+1].split(' ')[0]}` : '—';
      const pdej = extras.petits_dej_labels[idx] || '—';
      tr.innerHTML=`<td style="padding:6px 10px;font-weight:600;color:var(--amber);font-size:11px;white-space:nowrap;">${DAY_LABELS[idx]}</td>
      <td style="padding:6px 10px;font-size:12px;color:var(--text);cursor:pointer;">${escapeHtml(r.nom)}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--muted);">${escapeHtml(pdej)}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text);">${lb}</td>
      <td style="padding:6px 10px;font-size:11px;color:${idx<=2?'var(--green)':'var(--blue,#4EA8DE)'};white-space:nowrap;">${conserv}</td>`;
      tr.children[1].onclick=()=>window.showMeal(r.nom, type);
      body.appendChild(tr);
    });
    if(label){ label.textContent=`Semaine ${state.weekNum} · ${type==='avec'?'Avec enfants':'Sans enfants'} · génération automatique`; }
  }
  function renderGouters(){
    const tbody=document.getElementById('gouters-body');
    if(!tbody) return;
    tbody.innerHTML='';
    const labels=getExtras('avec').gouters_labels;
    labels.forEach((g,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);';
      row.innerHTML=`<span style="min-width:28px;font-weight:600;color:var(--orange);font-size:11px;">${SHORT_DAYS[i]}</span><span style="font-size:12px;color:var(--text);">${escapeHtml(g)}</span>`;
      tbody.appendChild(row);
    });
  }
  function renderPrepTab(){
    const menu=getGeneratedWeek(currentType());
    const container=document.getElementById('prep-repas');
    if(!container) return;
    container.innerHTML = menu.map((r,idx)=>`<div onclick="showMeal('${String(r.nom).replace(/'/g,"\\'")}', '${currentType()}')" style="cursor:pointer;padding:10px 14px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px;background:var(--s2);display:flex;justify-content:space-between;align-items:center;"><span style="font-size:13px;color:var(--text);font-weight:500;">${DAY_LABELS[idx]} — ${escapeHtml(r.nom)}</span><span style="font-size:10px;color:var(--muted);">voir ingrédients →</span></div>`).join('');
    const ordre=document.getElementById('prep-ordre-cuisson');
    if(ordre){
      ordre.innerHTML='<div style="font-size:12px;color:var(--muted);line-height:1.6;">1. Sors tous les ingrédients et contenants.<br>2. Lance d\'abord les féculents mutualisables (riz, quinoa, pâtes).<br>3. Enchaîne les plats du frigo (lun→mer), puis les plats à congeler (jeu→sam).<br>4. Portionne immédiatement dîner / lunchbox / congélation.</div>';
    }
  }

  // ─── BOÎTES PAR PROFIL ──────────────────────────────────────────────────
  function renderCarteBoite(profil, portion, isLunchbox){
    const c = profil.color;
    const ings = portion.ingredients
      .filter(it => it.quantite >= 0.5)
      .map(it=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid #ffffff08;">
        <span style="color:var(--muted);">${humanIngredient(it.ingredient)}</span>
        <span style="color:var(--text);font-weight:600;">${displayQty(it)}</span>
      </div>`).join('');
    return `<div style="background:var(--s2);border:1px solid ${c}33;border-left:3px solid ${c};border-radius:6px;padding:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span style="font-size:15px;">${profil.emoji}</span>
        <span style="font-size:12px;font-weight:700;color:${c};">${profil.label}</span>
        ${isLunchbox ? '<span style="font-size:10px;color:var(--muted);margin-left:auto;">🥡 lunch</span>' : ''}
      </div>
      <div style="margin-bottom:6px;">${ings}</div>
      <div style="background:var(--bg);border-radius:4px;padding:6px;margin-top:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;color:var(--muted);">Énergie</span>
          <span style="font-size:13px;font-weight:700;color:${c};">${portion.kcal} kcal</span>
          <span style="font-size:10px;color:var(--muted);">P${portion.prot}g G${portion.gluc}g L${portion.lip}g</span>
        </div>
      </div>
    </div>`;
  }
  function renderBoites(){
    const container=document.getElementById('boites-container');
    if(!container) return;
    const type=currentType();
    const week=getGeneratedWeek(type);
    const isEnfants=(type==='avec');
    const profilsActifs = isEnfants ? ['julien','ac','lucas','tim'] : ['julien','ac'];
    const wb=document.getElementById('week-banner-boites');
    if(wb) wb.textContent=`Semaine ${state.weekNum} · ${prettyMode(type)}`;
    let html='';
    week.forEach((recette,idx)=>{
      html+=`<div style="margin-bottom:28px;">
        <div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border);">
          🥡 ${escapeHtml(recette.nom)}
          <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px;">${DAY_LABELS[idx]}</span>
        </div>`;
      // Dîner — tous les profils actifs
      html+=`<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🍽️ Dîner</div>`;
      html+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:10px;margin-bottom:14px;">`;
      profilsActifs.forEach(pk=>{
        const portion=calcPortionProfil(recette, pk, false);
        if(portion) html+=renderCarteBoite(PROFILS[pk], portion, false);
      });
      html+=`</div>`;
      // Lunchbox Julien + AC uniquement, pas samedi
      if(idx < 5){
        const nextJour = DAY_LABELS[idx+1] ? DAY_LABELS[idx+1].split(' ')[0] : '';
        html+=`<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🥡 Lunchbox → ${nextJour}</div>`;
        html+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:10px;margin-bottom:8px;">`;
        ['julien','ac'].forEach(pk=>{
          const portion=calcPortionProfil(recette, pk, true);
          if(portion) html+=renderCarteBoite(PROFILS[pk], portion, true);
        });
        html+=`</div>`;
      }
      html+=`</div>`;
    });
    container.innerHTML=html;
  }

  // ─── BANNERS & MODALS ───────────────────────────────────────────────────
  function updateBanners(){
    const menu=getGeneratedWeek(currentType());
    const bannerText=document.getElementById('week-banner-text');
    const bannerSub=document.getElementById('week-banner-sub');
    const headerBadge=document.getElementById('header-week-badge');
    if(bannerText) bannerText.textContent=`Semaine ${state.weekNum} · ${prettyMode(currentType())} · ${menu[0].nom}`;
    if(bannerSub) bannerSub.textContent='Menus automatiques basés sur les recettes, la conservation et les profils.';
    if(headerBadge) headerBadge.textContent=`Semaine ${state.weekNum} — ${prettyMode(currentType())}`;
  }
  window.showMeal=function(mealName, type=currentType()){
    const week=getGeneratedWeek(type);
    const recipe=week.find(r=>r.nom===mealName) || state.recipes.find(r=>r.nom===mealName);
    if(!recipe) return;
    const factor=recipeScale(type);
    const body=document.getElementById('meal-body');
    const title=document.getElementById('meal-title');
    title.textContent=recipe.nom;
    body.innerHTML=`<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">${recipe.categorie} · ${recipe.type_plat} · ${recipe.conservation} · portions ${type==='avec'?6:4}</div>`
      + recipe.ingredients.map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span style="color:var(--text);">${humanIngredient(it.ingredient)}</span><span style="color:var(--green);font-weight:700;">${displayQty({ingredient:it.ingredient,quantite:Math.round(it.quantite*factor*10)/10,unite:it.unite})}</span></div>`).join('');
    document.getElementById('meal-modal').style.display='flex';
  };
  window.openShoppingList=function(){ renderCoursesModal(currentType()); };
  window.openShoppingListFor=function(type){ renderCoursesModal(type); };
  window.closeShoppingList=function(){ const m=document.getElementById('courses-modal'); if(m) m.style.display='none'; };

  function patchWeekToggleDefault(){
    document.getElementById('week-sans').style.display = state.mode==='sans_enfants' ? 'flex' : 'none';
    document.getElementById('week-avec').style.display = state.mode==='enfants' ? 'flex' : 'none';
    document.querySelectorAll('.wt-btn').forEach(btn=>btn.classList.remove('active'));
    const btns=document.querySelectorAll('.week-header .wt-btn');
    if(state.mode==='sans_enfants' && btns[0]) btns[0].classList.add('active');
    if(state.mode==='enfants' && btns[1]) btns[1].classList.add('active');
  }
  function disableLegacyInfluence(){
    const indicators=document.querySelectorAll('#week-indicator-avec, #week-indicator-sans');
    indicators.forEach(el=>{ if(el) el.style.display=''; });
  }

  // ─── INIT ───────────────────────────────────────────────────────────────
  async function init(){
    const [recipes, extras, index, nutrition] = await Promise.all([
      fetch('data/recettes.json').then(r=>r.json()),
      fetch('data/repas_hors_diners.json').then(r=>r.json()),
      fetch('data/recettes_index.json').then(r=>r.json()),
      fetch('data/nutrition_ingredients.json').then(r=>r.json())
    ]);
    state.recipes=recipes; state.extras=extras; state.index=index; state.nutrition=nutrition;
    state.weekNum=window.getISOWeek(new Date());
    state.mode = state.weekNum % 2 === 0 ? 'sans_enfants' : 'enfants';
    disableLegacyInfluence();
    renderMenuTable('sans');
    renderMenuTable('avec');
    renderGouters();
    renderPrepTab();
    renderBoites();
    updateBanners();
    patchWeekToggleDefault();
  }
  window.addEventListener('load', init);
})();
// v10-courses-fix
