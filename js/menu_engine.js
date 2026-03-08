
function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}}
function getISOWeek(date=new Date()){const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));const dayNum=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-dayNum);const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));return Math.ceil((((d-yearStart)/86400000)+1)/7);}
function pickBest(candidates, rng){if(!candidates.length) return null; const scored=[...candidates].sort((a,b)=>b.__score-a.__score || a.nom.localeCompare(b.nom)); const top=scored.slice(0, Math.min(5, scored.length)); return top[Math.floor(rng()*top.length)];}
function ingredientCore(recipe){return recipe.ingredients.slice(0,3).map(i=>i.ingredient).sort().join('|');}
function generateWeekFromRecipes(recipes, mode='sans_enfants', weekNum=getISOWeek()){
  const rng=mulberry32((mode==='enfants'?1000:2000)+weekNum);
  const days=[
    {key:'lundi', label:'LUN soir', needs:{proteine:'poisson', conservation:'frigo', jour:'lundi'}},
    {key:'mardi', label:'MAR soir', needs:{frigo:true}},
    {key:'mercredi', label:'MER soir', needs:{frigo:true, prefer:['legumineuse','vegetarien','mijote']}},
    {key:'jeudi', label:'JEU soir', needs:{late:true}},
    {key:'vendredi', label:'VEN soir', needs:{late:true}},
    {key:'samedi', label:'SAM soir', needs:{late:true}}
  ];
  const maxPlaisir = mode==='enfants'?2:1;
  const maxFam = mode==='enfants'?3:2;
  const preferCats = mode==='enfants'?{familial:4, plaisir:3, quotidien:1}:{quotidien:4, familial:1, plaisir:-1};
  const usedIds=new Set(); const protCount={}; const baseCount={}; const ingCount={}; let plaisirCount=0, famCount=0, soupCount=0, vegCount=0; const styleCount={};
  const result=[];
  for(const day of days){
    let cands=recipes.filter(r=>r.compatible_lunchbox!==false && !usedIds.has(r.id));
    cands=cands.filter(r=>{
      if(day.needs.proteine && r.proteine_principale!==day.needs.proteine) return false;
      if(day.needs.jour && r.jour_autorise!=='tous' && r.jour_autorise!==day.needs.jour) return false;
      if(day.needs.conservation && r.conservation!==day.needs.conservation) return false;
      if(day.needs.frigo && !(r.conservation==='frigo' || r.conservation==='les_deux')) return false;
      if(day.needs.late && !(r.conservation==='les_deux' || r.conservation==='congelable')) return false;
      if(plaisirCount>=maxPlaisir && r.categorie==='plaisir') return false;
      if(famCount>=maxFam && r.categorie==='familial' && mode==='enfants') return false;
      if((protCount[r.proteine_principale]||0)>=2) return false;
      if((baseCount[r.base_cuisson||'aucun']||0)>=2) return false;
      return true;
    });
    cands=cands.map(r=>{
      let s=0;
      s += (preferCats[r.categorie]||0);
      if(day.needs.prefer){
        if(day.needs.prefer.includes(r.type_plat)) s+=4;
        if(day.needs.prefer.includes(r.proteine_principale)) s+=4;
      }
      if(result.length){
        const prev=result[result.length-1];
        if(prev.type_plat===r.type_plat) s-=3;
        if(prev.base_cuisson===r.base_cuisson) s-=2;
        if(prev.proteine_principale===r.proteine_principale) s-=2;
        if(ingredientCore(prev)===ingredientCore(r)) s-=5;
      }
      for(const ing of r.ingredients.slice(0,3)) s -= (ingCount[ing.ingredient]||0)*1.5;
      if(r.type_plat==='soupe' && soupCount>=1) s-=8;
      // Interdire deux repas légers consécutifs (LB légère + dîner léger = journée creuse)
      if(result.length){
        const prev=result[result.length-1];
        if((prev.kcal_score||50) < 45 && (r.kcal_score||50) < 45) s -= 20; // quasi-interdit
      }
      // Pénaliser les recettes trop légères (dîner+LB < 45% apports Julien)
      if((r.kcal_score||50) < 45) s -= 6;
      if((r.kcal_score||50) < 35) s -= 8; // double pénalité si vraiment léger
      if((r.proteine_principale==='vegetarien' || r.proteine_principale==='legumineuse') && vegCount===0) s+=2;
      return {...r, __score:s};
    });
    let chosen=pickBest(cands, rng);
    if(!chosen){
      chosen=pickBest(recipes.filter(r=>!usedIds.has(r.id)).map(r=>({...r,__score:0})), rng);
    }
    if(!chosen) throw new Error('Impossible de générer la semaine');
    usedIds.add(chosen.id);
    protCount[chosen.proteine_principale]=(protCount[chosen.proteine_principale]||0)+1;
    baseCount[chosen.base_cuisson||'aucun']=(baseCount[chosen.base_cuisson||'aucun']||0)+1;
    styleCount[chosen.type_plat]=(styleCount[chosen.type_plat]||0)+1;
    chosen.ingredients.slice(0,3).forEach(i=> ingCount[i.ingredient]=(ingCount[i.ingredient]||0)+1);
    if(chosen.categorie==='plaisir') plaisirCount++;
    if(chosen.categorie==='familial') famCount++;
    if(chosen.type_plat==='soupe') soupCount++;
    if(chosen.proteine_principale==='vegetarien' || chosen.proteine_principale==='legumineuse') vegCount++;
    result.push(chosen);
  }
  if(vegCount===0){
    // fallback swap mercredi with a veg/soup recipe if possible
    const vegs=recipes.filter(r=>['vegetarien','legumineuse'].includes(r.proteine_principale) && (r.conservation==='frigo'||r.conservation==='les_deux'));
    if(vegs.length) result[2]=vegs[Math.floor(rng()*vegs.length)];
  }
  return result;
}
window.getISOWeek=getISOWeek;
window.generateWeekFromRecipes=generateWeekFromRecipes;
