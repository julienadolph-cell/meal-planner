
(function(){
  const DAY_LABELS=['LUN soir','MAR soir','MER soir','JEU soir','VEN soir','SAM soir'];
  const SHORT_DAYS=['Lun','Mar','Mer','Jeu','Ven'];
  const state={weekNum:null, mode:null, recipes:null, extras:null, index:null, nutrition:null, generated:{}};

  // ─── PROFILS NUTRITIONNELS ────────────────────────────────────────────────
  // Répartition journalière : 35% dîner / 35% lunchbox / 20% petit-déj / 10% goûter
  // Macros cibles dîner calculées depuis les objectifs journaliers (profil nutrition)
  const PROFILS = {
    julien: {
      label:'Julien', emoji:'👨', color:'#F5A623', kcal_jour:2150, lunchbox:true,
      diner_kcal:753,  lb_kcal:753,
      prot_diner:53,  gluc_diner:98,  lip_diner:25, fibres_diner:11
    },
    ac: {
      label:'AC', emoji:'👩', color:'#E91E8C', kcal_jour:1850, lunchbox:true,
      diner_kcal:648,  lb_kcal:648,
      prot_diner:46,  gluc_diner:84,  lip_diner:22, fibres_diner:9
    },
    lucas: {
      label:'Lucas', emoji:'🧒', color:'#4EA8DE', kcal_jour:2350, lunchbox:false,
      diner_kcal:823,  lb_kcal:0,
      prot_diner:58,  gluc_diner:107, lip_diner:27, fibres_diner:12
    },
    tim: {
      label:'Tim', emoji:'👦', color:'#4CAF50', kcal_jour:1800, lunchbox:false,
      diner_kcal:630,  lb_kcal:0,
      prot_diner:44,  gluc_diner:82,  lip_diner:21, fibres_diner:9
    },
  };

  // ─── HELPERS ─────────────────────────────────────────────────────────────
  function slugMode(type){return type==='avec'?'enfants':'sans_enfants';}
  function prettyMode(type){return type==='avec'?'Avec enfants':'Sans enfants';}
  function currentType(){return state.mode==='enfants'?'avec':'sans';}
  function getRotationIndex(){return ((state.weekNum||1)-1)%4;}
  function recipeScale(type){return type==='avec'?1.5:1;}
  function escapeHtml(str){return String(str).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

  function displayQty(item){
    const q=item.quantite, u=item.unite;
    if(item.ingredient==='oeuf') return Math.round(q)<=1?'1 \u0153uf':`${Math.round(q)} \u0153ufs`;
    if(u==='piece')   return `${Math.round(q)} pi\u00e8ce${q>1?'s':''}`;
    if(u==='pot')     return `${Math.round(q)} pot${q>1?'s':''}`;
    if(u==='pain')    return `${Math.round(q)} pain${q>1?'s':''}`;
    if(u==='paquet')  return `${Math.round(q)} paquet${q>1?'s':''}`;
    if(u==='bouteille') return `${Math.round(q)} bouteille${q>1?'s':''}`;
    return `${Math.round(q*10)/10}${u}`;
  }

  function humanIngredient(name){
    return name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
      .replace('Oeuf','\u0152uf').replace('Pain Complet','Pain complet').replace('Yaourt Nature','Yaourt nature');
  }

  function getRayon(name){
    const n=name.toLowerCase();
    if(/poulet|boeuf|veau|jambon|chorizo/.test(n)) return '\ud83e\udd69 Viandes';
    if(/saumon|cabillaud|colin/.test(n)) return '\ud83d\udc1f Poissons';
    if(/yaourt|fromage|lait|feta|mozzarella|emmental|ricotta|burrata|beurre/.test(n)) return '\ud83e\udd5b Produits frais';
    if(/pomme|banane|kiwi|orange|poire|raisin|fruit/.test(n)) return '\ud83c\udf4e Fruits';
    if(/courgette|carotte|brocoli|oignon|tomate|champignon|courge|patate|poivron|citron/.test(n)) return '\ud83e\udd55 L\u00e9gumes';
    if(/riz|quinoa|pate|farine|pain|galette/.test(n)) return '\ud83c\udf3e F\u00e9culents';
    if(/lentille|pois|haricot|tofu|houmous/.test(n)) return '\ud83e\udd6b \u00c9picerie sal\u00e9e';
    if(/miel|sucre|confiture|chocolat|compote|biscuit|sirop/.test(n)) return '\ud83c\udf6f \u00c9picerie sucr\u00e9e';
    if(/huile|sauce|curry|paprika|gingembre/.test(n)) return '\ud83e\uddc2 Assaisonnements';
    return '\ud83e\uddf5 Divers';
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

  // ─── CALCUL MACROS ────────────────────────────────────────────────────────
  function calcMacrosRecette(recette){
    const nutri=state.nutrition;
    let kcal=0, prot=0, gluc=0, lip=0, fib=0;
    recette.ingredients.forEach(ing=>{
      const n=nutri[ing.ingredient];
      if(!n || ing.unite!=='g') return;
      const f=ing.quantite/100;
      kcal+=n.kcal*f; prot+=n.proteines*f; gluc+=n.glucides*f; lip+=n.lipides*f; fib+=(n.fibres||0)*f;
    });
    return {kcal:Math.round(kcal), prot:Math.round(prot), gluc:Math.round(gluc), lip:Math.round(lip), fib:Math.round(fib)};
  }

  // Calcule la portion d'un profil pour une recette
  // Ratio = kcal_cible_profil / kcal_total_recette → appliqué à chaque ingrédient
  function calcPortionProfil(recette, profilKey, isLunchbox){
    const profil=PROFILS[profilKey];
    const macros=calcMacrosRecette(recette);
    if(macros.kcal===0) return null;
    const cible = isLunchbox ? profil.lb_kcal : profil.diner_kcal;
    const ratio = cible / macros.kcal;
    return {
      ingredients: recette.ingredients.map(ing=>({
        ...ing, quantite: Math.round(ing.quantite * ratio * 10) / 10
      })),
      kcal: Math.round(macros.kcal * ratio),
      prot: Math.round(macros.prot * ratio),
      gluc: Math.round(macros.gluc * ratio),
      lip:  Math.round(macros.lip  * ratio),
      fib:  Math.round(macros.fib  * ratio),
    };
  }

  // ─── LISTE DE COURSES ─────────────────────────────────────────────────────
  function computeCourses(type){
    const week=getGeneratedWeek(type);
    const totals={};
    const factor=recipeScale(type);
    week.forEach(r=> aggregateItems(r.ingredients, totals, factor));
    const extras=getExtras(type);
    aggregateItems(extras.petits_dej_items, totals, 1);
    aggregateItems(extras.brunch_items, totals, 1);
    aggregateItems(extras.gouters_items, totals, 1);
    return totals;
  }

  function renderCoursesModal(type){
    const totals=computeCourses(type);
    const byRayon={};
    Object.values(totals).forEach(item=>{
      const rayon=getRayon(item.ingredient);
      (byRayon[rayon]||(byRayon[rayon]=[])).push(item);
    });
    const order=['\ud83e\udd55 L\u00e9gumes','\ud83c\udf4e Fruits','\ud83e\udd69 Viandes','\ud83d\udc1f Poissons','\ud83e\udd5b Produits frais','\ud83c\udf3e F\u00e9culents','\ud83e\udd6b \u00c9picerie sal\u00e9e','\ud83c\udf6f \u00c9picerie sucr\u00e9e','\ud83e\uddc2 Assaisonnements','\ud83e\uddf5 Divers'];
    document.getElementById('courses-title').textContent=`\ud83d\uded2 Courses Semaine ${state.weekNum} \u2014 ${prettyMode(type)}`;
    const content=document.getElementById('courses-content');
    content.innerHTML='';
    let txt=`\ud83d\uded2 LISTE DE COURSES \u2014 Semaine ${state.weekNum}\n${prettyMode(type)}\n\n`;
    order.forEach(rayon=>{
      const items=(byRayon[rayon]||[]).sort((a,b)=>humanIngredient(a.ingredient).localeCompare(humanIngredient(b.ingredient),'fr'));
      if(!items.length) return;
      txt+=`${rayon}\n`;
      const wrap=document.createElement('div');
      wrap.style.marginBottom='14px';
      wrap.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:1px;padding:6px 0;margin-bottom:4px;border-bottom:1px solid var(--border);">${rayon}</div>`;
      items.forEach(item=>{
        const label=humanIngredient(item.ingredient);
        const qty=displayQty(item);
        txt+=`\u25a1 ${label} \u2014 ${qty}\n`;
        const row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;padding:4px 0 4px 10px;border-bottom:1px solid var(--border);font-size:12px;';
        row.innerHTML=`<input type="checkbox" style="accent-color:var(--green);width:13px;height:13px;flex-shrink:0;"><span style="flex:1;color:var(--text);">${label}</span><span style="color:var(--green);font-weight:700;font-size:12px;">${qty}</span>`;
        wrap.appendChild(row);
      });
      content.appendChild(wrap);
    });
    document.getElementById('btn-gmail').onclick=()=>{
      const subject=encodeURIComponent(`Courses Semaine ${state.weekNum} \u2014 ${prettyMode(type)}`);
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${encodeURIComponent(txt)}`,'_blank');
    };
    document.getElementById('courses-modal').style.display='flex';
  }

  // ─── MENU TABLE ───────────────────────────────────────────────────────────
  function renderMenuTable(type){
    const week=getGeneratedWeek(type);
    const extras=getExtras(type);
    const body=document.getElementById(type==='avec'?'menu-avec-body':'menu-sans-body');
    const label=document.getElementById(type==='avec'?'week-label-avec':'week-label-sans');
    if(!body) return;
    body.innerHTML='';
    week.forEach((r,idx)=>{
      const tr=document.createElement('tr');
      const conserv = idx<=2 ? '\u2744\ufe0f Frigo' : '\ud83e\uddca Cong\u00e9lateur';
      const lb = idx<5 ? `\u2192 Lunchbox ${DAY_LABELS[idx+1].split(' ')[0]}` : '\u2014';
      const pdej = extras.petits_dej_labels[idx] || '\u2014';
      tr.innerHTML=`<td style="padding:6px 10px;font-weight:600;color:var(--amber);font-size:11px;white-space:nowrap;">${DAY_LABELS[idx]}</td>
        <td style="padding:6px 10px;font-size:12px;color:var(--text);cursor:pointer;">${escapeHtml(r.nom)}</td>
        <td style="padding:6px 10px;font-size:11px;color:var(--muted);">${escapeHtml(pdej)}</td>
        <td style="padding:6px 10px;font-size:11px;color:var(--text);">${lb}</td>
        <td style="padding:6px 10px;font-size:11px;color:${idx<=2?'var(--green)':'var(--blue,#4EA8DE)'};white-space:nowrap;">${conserv}</td>`;
      tr.children[1].onclick=()=>window.showMeal(r.nom, type);
      body.appendChild(tr);
    });
    if(label) label.textContent=`Semaine ${state.weekNum} \u00b7 ${type==='avec'?'Avec enfants':'Sans enfants'} \u00b7 g\u00e9n\u00e9ration automatique`;
  }

  function renderGouters(){
    const tbody=document.getElementById('gouters-body');
    if(!tbody) return;
    tbody.innerHTML='';
    getExtras('avec').gouters_labels.forEach((g,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);';
      row.innerHTML=`<span style="min-width:28px;font-weight:600;color:var(--orange);font-size:11px;">${SHORT_DAYS[i]}</span><span style="font-size:12px;color:var(--text);">${escapeHtml(g)}</span>`;
      tbody.appendChild(row);
    });
  }

  // ─── LUNDI PREP — ORDRE DYNAMIQUE PAR CUISSON ────────────────────────────
  function renderPrepTab(){
    const type=currentType();
    const menu=getGeneratedWeek(type);
    const container=document.getElementById('prep-repas');
    if(!container) return;

    container.innerHTML = menu.map((r,idx)=>`
      <div onclick="showMeal('${String(r.nom).replace(/'/g,"\\'")}','${type}')"
        style="cursor:pointer;padding:10px 14px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px;background:var(--s2);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;color:var(--text);font-weight:500;">${DAY_LABELS[idx]} \u2014 ${escapeHtml(r.nom)}</span>
        <span style="font-size:10px;color:var(--muted);">voir ingr\u00e9dients \u2192</span>
      </div>`).join('');

    const ordre=document.getElementById('prep-ordre-cuisson');
    if(!ordre) return;

    const BASE_LABELS = {riz:'Riz', quinoa:'Quinoa', lentilles:'Lentilles', pate:'P\u00e2tes', legumes_rotis:'L\u00e9gumes r\u00f4tis'};

    const groupes = {
      feculents:  {label:'\u23f1\ufe0f \u00c9TAPE 1 \u2014 F\u00e9culents (simultan\u00e9, ~20 min)', color:'#F5A623', items:[]},
      four:       {label:'\ud83d\udd25 \u00c9TAPE 2 \u2014 Four (pendant les f\u00e9culents, ~25 min)',  color:'#E53935', items:[]},
      poele:      {label:'\ud83c\udf73 \u00c9TAPE 3 \u2014 Po\u00eale (encha\u00eener)',                   color:'#FF9800', items:[]},
      mijote:     {label:'\ud83e\uded5 \u00c9TAPE 4 \u2014 Mijot\u00e9s & Soupes (~30 min)',           color:'#4CAF50', items:[]},
      assemblage: {label:'\ud83e\udd61 \u00c9TAPE 5 \u2014 Assemblage & Conditionnement',              color:'#4EA8DE', items:[]},
    };

    // Collecter les féculents avec déduplications
    const feculentsMap = {};
    menu.forEach((r,idx)=>{
      const jour=DAY_LABELS[idx].split(' ')[0];
      if(r.base_cuisson && BASE_LABELS[r.base_cuisson]){
        const bl=BASE_LABELS[r.base_cuisson];
        if(!feculentsMap[bl]) feculentsMap[bl]=[];
        feculentsMap[bl].push(jour);
      }
      if(r.base_cuisson==='legumes_rotis') groupes.four.items.push(`L\u00e9gumes r\u00f4tis <span style="color:var(--muted)">(${jour})</span>`);
      const tp=r.type_plat;
      if(tp==='four')   groupes.four.items.push(`${escapeHtml(r.nom)} <span style="color:var(--muted)">(${jour})</span>`);
      else if(tp==='poele')  groupes.poele.items.push(`${escapeHtml(r.nom)} <span style="color:var(--muted)">(${jour})</span>`);
      else if(tp==='mijote'||tp==='soupe') groupes.mijote.items.push(`${escapeHtml(r.nom)} <span style="color:var(--muted)">(${jour})</span>`);
      else groupes.assemblage.items.push(`${escapeHtml(r.nom)} <span style="color:var(--muted)">(${jour})</span>`);
    });
    groupes.feculents.items = Object.entries(feculentsMap).map(([b,jours])=>
      `${b} <span style="color:var(--muted)">(${jours.join(', ')})</span>`);
    groupes.assemblage.items.push('Portionner d\u00eener / lunchbox / cong\u00e9lation');
    groupes.assemblage.items.push('\u00c9tiqueter les bo\u00eetes cong\u00e9lateur avec le jour destination');

    let html=`<div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Ordre optimis\u00e9 pour la semaine \u00b7 tout cuisiner en parall\u00e8le le lundi</div>`;
    Object.values(groupes).forEach(g=>{
      if(!g.items.length) return;
      html+=`<div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:${g.color};text-transform:uppercase;letter-spacing:1px;padding:5px 0;margin-bottom:6px;border-bottom:1px solid var(--border);">${g.label}</div>
        ${g.items.map(item=>`<div style="font-size:12px;color:var(--text);padding:3px 0 3px 12px;border-left:2px solid ${g.color}55;margin-bottom:3px;">\u2192 ${item}</div>`).join('')}
      </div>`;
    });
    ordre.innerHTML=html;
  }

  // ─── BOÎTES PAR PROFIL ────────────────────────────────────────────────────
  function renderBoites(){
    const container=document.getElementById('boites-container');
    if(!container) return;
    const type=currentType();
    const week=getGeneratedWeek(type);
    const isEnfants=(type==='avec');
    const profilsActifs=isEnfants ? ['julien','ac','lucas','tim'] : ['julien','ac'];

    const wb=document.getElementById('week-banner-boites');
    if(wb) wb.textContent=`Semaine ${state.weekNum} \u00b7 ${prettyMode(type)}`;

    let html='';
    week.forEach((recette,idx)=>{
      const hasLunchbox=(idx<5);
      html+=`<div style="margin-bottom:28px;">
        <div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border);">
          \ud83e\udd61 ${escapeHtml(recette.nom)}
          <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px;">${DAY_LABELS[idx]}</span>
        </div>`;

      // Dîner — tous les profils actifs
      html+=`<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">\ud83c\udf7d\ufe0f D\u00eener</div>`;
      html+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:10px;margin-bottom:14px;">`;
      profilsActifs.forEach(pk=>{
        const portion=calcPortionProfil(recette, pk, false);
        if(portion) html+=renderCarteBoite(PROFILS[pk], portion, false);
      });
      html+=`</div>`;

      // Lunchbox — Julien + AC seulement, sauf samedi
      if(hasLunchbox){
        const nextJour=DAY_LABELS[idx+1] ? DAY_LABELS[idx+1].split(' ')[0] : '';
        html+=`<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">\ud83e\udd61 Lunchbox \u2192 ${nextJour}</div>`;
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

  function renderCarteBoite(profil, portion, isLunchbox){
    const c=profil.color;
    const bar=(val,max,col)=>{
      const pct=Math.min(100,Math.round(val/max*100));
      return `<div style="background:var(--border);border-radius:3px;height:3px;margin-top:2px;"><div style="width:${pct}%;background:${col};height:3px;border-radius:3px;"></div></div>`;
    };
    const ings=portion.ingredients.filter(it=>it.quantite>=0.5)
      .map(it=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid #ffffff08;">
        <span style="color:var(--muted);">${humanIngredient(it.ingredient)}</span>
        <span style="color:var(--text);font-weight:600;">${displayQty(it)}</span>
      </div>`).join('');
    return `<div style="background:var(--s2);border:1px solid ${c}33;border-left:3px solid ${c};border-radius:6px;padding:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span style="font-size:15px;">${profil.emoji}</span>
        <span style="font-size:12px;font-weight:700;color:${c};">${profil.label}</span>
        ${isLunchbox?`<span style="font-size:10px;color:var(--muted);margin-left:auto;">\ud83e\udd61 lunch</span>`:''}
      </div>
      <div style="margin-bottom:8px;">${ings}</div>
      <div style="background:var(--bg);border-radius:4px;padding:6px;margin-top:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:10px;color:var(--muted);">\u00c9nergie</span>
          <span style="font-size:13px;font-weight:700;color:${c};">${portion.kcal} kcal</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:10px;">
          <div><div style="display:flex;justify-content:space-between;color:var(--muted);"><span>Prot\u00e9ines</span><span style="color:var(--text);font-weight:600;">${portion.prot}g</span></div>${bar(portion.prot,profil.prot_diner,'#4CAF50')}</div>
          <div><div style="display:flex;justify-content:space-between;color:var(--muted);"><span>Glucides</span><span style="color:var(--text);font-weight:600;">${portion.gluc}g</span></div>${bar(portion.gluc,profil.gluc_diner,'#F5A623')}</div>
          <div><div style="display:flex;justify-content:space-between;color:var(--muted);"><span>Lipides</span><span style="color:var(--text);font-weight:600;">${portion.lip}g</span></div>${bar(portion.lip,profil.lip_diner,'#E91E8C')}</div>
          <div><div style="display:flex;justify-content:space-between;color:var(--muted);"><span>Fibres</span><span style="color:var(--text);font-weight:600;">${portion.fib}g</span></div>${bar(portion.fib,profil.fibres_diner,'#4EA8DE')}</div>
        </div>
      </div>
    </div>`;
  }

  // ─── BANNERS & MODALS ─────────────────────────────────────────────────────
  function updateBanners(){
    const menu=getGeneratedWeek(currentType());
    const bannerText=document.getElementById('week-banner-text');
    const bannerSub=document.getElementById('week-banner-sub');
    const headerBadge=document.getElementById('header-week-badge');
    if(bannerText) bannerText.textContent=`Semaine ${state.weekNum} \u00b7 ${prettyMode(currentType())} \u00b7 ${menu[0].nom}`;
    if(bannerSub) bannerSub.textContent='Menus g\u00e9n\u00e9r\u00e9s automatiquement \u2014 stables toute la semaine';
    if(headerBadge) headerBadge.textContent=`Semaine ${state.weekNum} \u2014 ${prettyMode(currentType())}`;
  }

  window.showMeal=function(mealName, type=currentType()){
    const week=getGeneratedWeek(type);
    const recipe=week.find(r=>r.nom===mealName)||state.recipes.find(r=>r.nom===mealName);
    if(!recipe) return;
    const factor=recipeScale(type);
    const macros=calcMacrosRecette(recipe);
    const title=document.getElementById('meal-title');
    const body=document.getElementById('meal-body');
    title.textContent=recipe.nom;
    body.innerHTML=`<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">${recipe.categorie} \u00b7 ${recipe.type_plat} \u00b7 ${recipe.conservation} \u00b7 ${type==='avec'?6:4} portions</div>`
      +recipe.ingredients.map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <span style="color:var(--text);">${humanIngredient(it.ingredient)}</span>
          <span style="color:var(--green);font-weight:700;">${displayQty({ingredient:it.ingredient,quantite:Math.round(it.quantite*factor*10)/10,unite:it.unite})}</span>
        </div>`).join('')
      +`<div style="margin-top:10px;padding:8px;background:var(--s2);border-radius:4px;font-size:11px;color:var(--muted);">
          Total recette \u00b7 ${macros.kcal} kcal \u00b7 P ${macros.prot}g \u00b7 G ${macros.gluc}g \u00b7 L ${macros.lip}g \u00b7 F ${macros.fib}g
        </div>`;
    document.getElementById('meal-modal').style.display='flex';
  };

  window.openShoppingList=function(){ renderCoursesModal(currentType()); };
  window.openShoppingListFor=function(type){ renderCoursesModal(type); };
  window.closeShoppingList=function(){ const m=document.getElementById('courses-modal'); if(m) m.style.display='none'; };

  function patchWeekToggleDefault(){
    document.getElementById('week-sans').style.display=state.mode==='sans_enfants'?'flex':'none';
    document.getElementById('week-avec').style.display=state.mode==='enfants'?'flex':'none';
    document.querySelectorAll('.wt-btn').forEach(btn=>btn.classList.remove('active'));
    const btns=document.querySelectorAll('.week-header .wt-btn');
    if(state.mode==='sans_enfants'&&btns[0]) btns[0].classList.add('active');
    if(state.mode==='enfants'&&btns[1]) btns[1].classList.add('active');
  }

  function disableLegacyInfluence(){
    document.querySelectorAll('#week-indicator-avec, #week-indicator-sans')
      .forEach(el=>{ if(el) el.style.display=''; });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  async function init(){
    const [recipes,extras,index,nutrition]=await Promise.all([
      fetch('data/recettes.json').then(r=>r.json()),
      fetch('data/repas_hors_diners.json').then(r=>r.json()),
      fetch('data/recettes_index.json').then(r=>r.json()),
      fetch('data/nutrition_ingredients.json').then(r=>r.json())
    ]);
    state.recipes=recipes; state.extras=extras; state.index=index; state.nutrition=nutrition;
    state.weekNum=window.getISOWeek(new Date());
    state.mode=state.weekNum%2===0?'sans_enfants':'enfants';
    disableLegacyInfluence();
    renderMenuTable('sans');
    renderMenuTable('avec');
    renderGouters();
    renderPrepTab();
    renderBoites();
    updateBanners();
    patchWeekToggleDefault();
  }

  window.addEventListener('load',init);
})();
