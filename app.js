/**
 * app.js
 * Logique applicative principale du planificateur de repas.
 * Dépend de : menu_engine.js (window.getISOWeek, window.generateWeekFromRecipes)
 *
 * Architecture :
 *   state       — état centralisé unique
 *   DataLoader  — chargement des JSON via fetch()
 *   Formatter   — fonctions de formatage et d'affichage
 *   ShoppingList— calcul et rendu de la liste de courses
 *   Renderer    — rendu des sections UI
 *   App         — initialisation et câblage des événements
 */

'use strict';

(function () {
  /* ═══════════════════════════════════════════════
     ÉTAT CENTRALISÉ
     Toutes les données de l'application passent par ici.
     Jamais de variables globales éparpillées.
  ═══════════════════════════════════════════════ */
  const state = {
    weekNum: null,      // numéro ISO de la semaine courante
    mode: null,         // 'enfants' | 'sans_enfants'
    recipes: null,      // tableau des recettes
    extras: null,       // repas_hors_diners.json
    index: null,        // recettes_index.json
    nutrition: null,    // nutrition_ingredients.json
    generated: {},      // cache : { 'enfants': [...], 'sans_enfants': [...] }
  };

  /* ═══════════════════════════════════════════════
     CONSTANTES UI
  ═══════════════════════════════════════════════ */
  const DAY_LABELS = ['LUN soir', 'MAR soir', 'MER soir', 'JEU soir', 'VEN soir', 'SAM soir'];
  const SHORT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

  // Ordre des rayons pour la liste de courses
  const RAYONS_ORDER = [
    '🥕 Légumes',
    '🍎 Fruits',
    '🥩 Viandes',
    '🐟 Poissons',
    '🥚 Œufs & Produits laitiers',
    '🌾 Féculents',
    '🥫 Épicerie salée',
    '🍯 Épicerie sucrée',
    '🧂 Condiments',
    '🧺 Divers',
  ];

  /* ═══════════════════════════════════════════════
     HELPERS — SÉMANTIQUE
  ═══════════════════════════════════════════════ */
  /** 'avec' → 'enfants' ; 'sans' → 'sans_enfants' */
  function slugMode(type) {
    return type === 'avec' ? 'enfants' : 'sans_enfants';
  }

  /** 'avec' | 'sans' | 'enfants' | 'sans_enfants' → label lisible */
  function prettyMode(type) {
    const normalized = type === 'avec' || type === 'enfants' ? 'avec' : 'sans';
    return normalized === 'avec' ? 'Avec enfants' : 'Sans enfants';
  }

  /** Retourne le type court de la semaine courante ('avec' | 'sans') */
  function currentType() {
    return state.mode === 'enfants' ? 'avec' : 'sans';
  }

  /** Facteur de quantité selon le mode (×1.5 avec enfants) */
  function recipeScale(type) {
    return type === 'avec' || type === 'enfants' ? 1.5 : 1;
  }

  /** Index de rotation (0–3) basé sur la semaine */
  function getRotationIndex() {
    return ((state.weekNum || 1) - 1) % 4;
  }

  /** Sécurisation HTML simple */
  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"]/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
    );
  }

  /* ═══════════════════════════════════════════════
     FORMATTER — AFFICHAGE DES QUANTITÉS
  ═══════════════════════════════════════════════ */
  const Formatter = {
    /**
     * Formate une quantité avec son unité.
     * Règle spéciale : les œufs sont toujours en pièces, jamais en grammes.
     */
    qty(item) {
      const q = item.quantite;
      const u = item.unite;
      const name = item.ingredient || '';

      // Règle œuf — jamais en grammes
      if (name === 'oeuf' || name === 'oeuf_dur') {
        const n = u === 'g' ? Math.max(1, Math.round(q / 60)) : Math.round(q);
        return n === 1 ? '1 œuf' : `${n} œufs`;
      }

      // Unités comptables
      const unitLabels = {
        piece: (n) => `${n} pièce${n > 1 ? 's' : ''}`,
        pot: (n) => `${n} pot${n > 1 ? 's' : ''}`,
        pain: (n) => `${n} pain${n > 1 ? 's' : ''}`,
        paquet: (n) => `${n} paquet${n > 1 ? 's' : ''}`,
        bouteille: (n) => `${n} bouteille${n > 1 ? 's' : ''}`,
        tranche: (n) => `${n} tranche${n > 1 ? 's' : ''}`,
      };

      if (unitLabels[u]) {
        return unitLabels[u](Math.round(q));
      }

      // Grandeur numérique avec unité (g, ml, kg, l…)
      return `${Math.round(q * 10) / 10}${u}`;
    },

    /**
     * Transforme un nom d'ingrédient snake_case en libellé lisible.
     * oeuf → Œuf, pain_complet → Pain complet, etc.
     */
    ingredientLabel(name) {
      return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bOeuf\b/g, 'Œuf')
        .replace(/\bOeufs\b/g, 'Œufs');
    },
  };

  /* ═══════════════════════════════════════════════
     RAYON — CLASSEMENT DES INGRÉDIENTS PAR RAYON
  ═══════════════════════════════════════════════ */
  function getRayon(name) {
    const n = name.toLowerCase();
    if (/poulet|boeuf|bœuf|veau|jambon|chorizo|viande|porc|saucisse|lardons/.test(n))
      return '🥩 Viandes';
    if (/saumon|cabillaud|colin|thon|crevette|daurade|maquereau|sardine|poisson/.test(n))
      return '🐟 Poissons';
    if (/oeuf|yaourt|fromage|lait|feta|mozzarella|emmental|ricotta|burrata|beurre|creme|quark|kefir/.test(n))
      return '🥚 Œufs & Produits laitiers';
    if (/pomme|banane|kiwi|orange|poire|raisin|mangue|fruit|ananas|cerise|fraise|myrtille|abricot|peche|prune|citron/.test(n))
      return '🍎 Fruits';
    if (/courgette|carotte|brocoli|oignon|tomate|champignon|courge|patate|pomme_de_terre|poivron|epinard|haricot_vert|chou|ail|poireau|navet|betterave|celeri|aubergine|fenouil|radis|asperge|artichaut|avocat|concombre|salade|laitue/.test(n))
      return '🥕 Légumes';
    if (/riz|quinoa|pate|farine|pain|galette|semoule|boulgour|polenta|fecule|chapelure|biscottes|mais/.test(n))
      return '🌾 Féculents';
    if (/lentille|pois_chiche|haricot_rouge|haricot_blanc|tofu|houmous|boite|conserve|bouillon|sauce_soja|miso|soupe/.test(n))
      return '🥫 Épicerie salée';
    if (/miel|sucre|confiture|chocolat|compote|biscuit|sirop|vanille|cacao|farine_de_riz/.test(n))
      return '🍯 Épicerie sucrée';
    if (/huile|vinaigre|sauce|curry|paprika|gingembre|curcuma|cumin|herbe|epice|sel|poivre|moutarde|mayonnaise|ketchup/.test(n))
      return '🧂 Condiments';
    return '🧺 Divers';
  }

  /* ═══════════════════════════════════════════════
     SHOPPING LIST — CALCUL DES COURSES
  ═══════════════════════════════════════════════ */
  const ShoppingList = {
    /**
     * Agrège une liste d'items dans une map {ingredient → {quantite, unite}}.
     * @param items   — tableau d'ingrédients [{ingredient, quantite, unite}]
     * @param map     — objet de cumul (modifié en place)
     * @param factor  — multiplicateur de quantité (ex : 1.5 avec enfants)
     */
    aggregate(items, map, factor = 1) {
      items.forEach((item) => {
        const key = item.ingredient;
        if (!map[key]) {
          map[key] = { ingredient: key, quantite: 0, unite: item.unite };
        }
        map[key].quantite += item.quantite * factor;
      });
    },

    /**
     * Calcule la liste de courses complète pour un type de semaine.
     * Inclut : dîners + lunchboxes (via factor) + petits-déj + goûters + brunch.
     */
    compute(type) {
      const week = App.getGeneratedWeek(type);
      const factor = recipeScale(type);
      const extras = getExtras(type);
      const totals = {};

      // Dîners et lunchboxes (les quantités des recettes couvrent déjà les 2)
      week.forEach((r) => ShoppingList.aggregate(r.ingredients, totals, factor));

      // Petits-déjeuners
      ShoppingList.aggregate(extras.petits_dej_items, totals, 1);

      // Goûters (uniquement semaine avec enfants)
      if (extras.gouters_items && extras.gouters_items.length > 0) {
        ShoppingList.aggregate(extras.gouters_items, totals, 1);
      }

      // Brunch dimanche
      ShoppingList.aggregate(extras.brunch_items, totals, 1);

      return totals;
    },

    /**
     * Groupe les ingrédients par rayon et retourne un objet trié.
     */
    groupByRayon(totals) {
      const byRayon = {};
      Object.values(totals).forEach((item) => {
        const rayon = getRayon(item.ingredient);
        if (!byRayon[rayon]) byRayon[rayon] = [];
        byRayon[rayon].push(item);
      });
      // Trier chaque rayon par nom
      Object.keys(byRayon).forEach((rayon) => {
        byRayon[rayon].sort((a, b) =>
          Formatter.ingredientLabel(a.ingredient).localeCompare(
            Formatter.ingredientLabel(b.ingredient),
            'fr'
          )
        );
      });
      return byRayon;
    },

    /**
     * Génère le texte brut de la liste (pour export Gmail).
     */
    toText(byRayon, weekNum, type) {
      let txt = `🛒 LISTE DE COURSES — Semaine ${weekNum}\n${prettyMode(type)}\n`;
      txt += `Inclut : dîners + lunchboxes + petits-déj + goûters + brunch\n\n`;

      RAYONS_ORDER.forEach((rayon) => {
        const items = byRayon[rayon] || [];
        if (!items.length) return;
        txt += `${rayon}\n`;
        items.forEach((item) => {
          txt += `□ ${Formatter.ingredientLabel(item.ingredient)} — ${Formatter.qty(item)}\n`;
        });
        txt += '\n';
      });
      return txt;
    },

    /**
     * Rend la liste de courses dans le modal.
     */
    render(type) {
      const totals = ShoppingList.compute(type);
      const byRayon = ShoppingList.groupByRayon(totals);
      const weekNum = state.weekNum;

      // Mise à jour du titre
      const titleEl = document.getElementById('courses-title');
      if (titleEl)
        titleEl.textContent = `Semaine ${weekNum} — ${prettyMode(type)}`;

      // Rendu du contenu
      const content = document.getElementById('courses-content');
      if (!content) return;
      content.innerHTML = '';

      RAYONS_ORDER.forEach((rayon) => {
        const items = byRayon[rayon] || [];
        if (!items.length) return;

        const section = document.createElement('div');
        section.className = 'courses-rayon';

        const header = document.createElement('div');
        header.className = 'courses-rayon-title';
        header.textContent = rayon;
        section.appendChild(header);

        items.forEach((item) => {
          const row = document.createElement('label');
          row.className = 'courses-row';
          row.innerHTML = `
            <input type="checkbox" class="courses-check">
            <span class="courses-item-name">${Formatter.ingredientLabel(item.ingredient)}</span>
            <span class="courses-item-qty">${Formatter.qty(item)}</span>
          `;
          section.appendChild(row);
        });

        content.appendChild(section);
      });

      // Bouton Gmail
      const txt = ShoppingList.toText(byRayon, weekNum, type);
      const btnGmail = document.getElementById('btn-gmail');
      if (btnGmail) {
        const subject = encodeURIComponent(`Courses Semaine ${weekNum} — ${prettyMode(type)}`);
        const body = encodeURIComponent(txt);
        btnGmail.href = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`;
      }

      // Afficher le modal
      const modal = document.getElementById('courses-modal');
      if (modal) modal.style.display = 'flex';
    },
  };

  /* ═══════════════════════════════════════════════
     EXTRAS — ACCÈS AUX REPAS HORS DÎNERS
  ═══════════════════════════════════════════════ */
  function getExtras(type) {
    const normalizedSlug = type === 'avec' || type === 'enfants' ? 'enfants' : 'sans_enfants';
    const bucket = state.extras[normalizedSlug];
    if (!bucket) {
      console.error(`Extras introuvables pour le mode "${normalizedSlug}"`);
      return { petits_dej_labels: [], petits_dej_items: [], brunch_label: '', brunch_items: [], gouters_labels: [], gouters_items: [] };
    }
    const rot = getRotationIndex();
    const hasGouters = normalizedSlug === 'enfants' && bucket.gouters_rotations;
    return {
      petits_dej_labels: bucket.petits_dej_labels || [],
      petits_dej_items: bucket.petits_dej_items || [],
      brunch_label: bucket.brunch_label || '',
      brunch_items: bucket.brunch_items || [],
      gouters_labels: hasGouters ? (bucket.gouters_rotations[rot]?.labels || []) : [],
      gouters_items: hasGouters ? (bucket.gouters_rotations[rot]?.items || []) : [],
    };
  }

  /* ═══════════════════════════════════════════════
     APP — GESTION DU CACHE ET DE LA GÉNÉRATION
  ═══════════════════════════════════════════════ */
  const App = {
    /**
     * Retourne la semaine générée pour un type, avec mise en cache.
     * Utilise toujours un weekNum "canonique" (pair pour sans_enfants,
     * impair pour enfants) afin de garantir la cohérence.
     */
    getGeneratedWeek(type) {
      const slug = type === 'avec' || type === 'enfants' ? 'enfants' : 'sans_enfants';
      if (state.generated[slug]) return state.generated[slug];

      // Forcer un seed pair/impair selon le mode
      let seed;
      if (slug === 'enfants') {
        seed = state.weekNum % 2 === 1 ? state.weekNum : state.weekNum + 1;
      } else {
        seed = state.weekNum % 2 === 0 ? state.weekNum : state.weekNum + 1;
      }

      state.generated[slug] = window.generateWeekFromRecipes(
        state.recipes,
        slug,
        seed
      );
      return state.generated[slug];
    },
  };

  /* ═══════════════════════════════════════════════
     RENDERER — RENDU DES SECTIONS UI
  ═══════════════════════════════════════════════ */
  const Renderer = {
    /**
     * Met à jour tous les bandeaux d'information de la semaine.
     */
    banners() {
      const week = App.getGeneratedWeek(currentType());
      const text = `Semaine ${state.weekNum} · ${prettyMode(currentType())} · ${week[0]?.nom || ''}`;
      const sub = 'Menus générés automatiquement — stables toute la semaine';

      const ids = ['week-banner-text', 'week-banner-sub', 'header-week-badge'];
      const vals = [text, sub, `Semaine ${state.weekNum} — ${prettyMode(currentType())}`];
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.textContent = vals[i];
      });
    },

    /**
     * Rend le tableau de menus pour un type ('avec' | 'sans').
     */
    menuTable(type) {
      const week = App.getGeneratedWeek(type);
      const extras = getExtras(type);
      const bodyId = type === 'avec' ? 'menu-avec-body' : 'menu-sans-body';
      const labelId = type === 'avec' ? 'week-label-avec' : 'week-label-sans';
      const body = document.getElementById(bodyId);
      const label = document.getElementById(labelId);
      if (!body) return;

      body.innerHTML = '';
      week.forEach((r, idx) => {
        const conserv = idx <= 2 ? '❄️ Frigo' : '🧊 Congélateur';
        const lb = idx < 5 ? `→ Lunchbox ${DAY_LABELS[idx + 1].split(' ')[0]}` : '—';
        const pdej = extras.petits_dej_labels[idx] || '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="menu-day">${DAY_LABELS[idx]}</td>
          <td class="menu-recette" data-recipe="${escapeHtml(r.nom)}" data-type="${type}">${escapeHtml(r.nom)}</td>
          <td class="menu-pdej">${escapeHtml(pdej)}</td>
          <td class="menu-lb">${lb}</td>
          <td class="menu-conserv ${idx <= 2 ? 'conserv-frigo' : 'conserv-congel'}">${conserv}</td>
        `;
        tr.querySelector('.menu-recette').addEventListener('click', (e) => {
          Renderer.mealModal(e.target.dataset.recipe, e.target.dataset.type);
        });
        body.appendChild(tr);
      });

      if (label)
        label.textContent = `Semaine ${state.weekNum} · ${prettyMode(type)} · génération automatique`;
    },

    /**
     * Rend la liste des goûters (section Planning).
     */
    gouters() {
      const tbody = document.getElementById('gouters-body');
      if (!tbody) return;
      tbody.innerHTML = '';
      const labels = getExtras('avec').gouters_labels;
      labels.forEach((g, i) => {
        const row = document.createElement('div');
        row.className = 'gouter-row';
        row.innerHTML = `<span class="gouter-day">${SHORT_DAYS[i]}</span><span class="gouter-label">${escapeHtml(g)}</span>`;
        tbody.appendChild(row);
      });
    },

    /**
     * Rend la section Lundi Prep.
     */
    prepTab() {
      const week = App.getGeneratedWeek(currentType());

      // Bandeau
      const title = document.getElementById('prep-title');
      const sub = document.getElementById('prep-subtitle');
      if (title) title.textContent = `LUNDI — MEAL PREP · Semaine ${state.weekNum}`;
      if (sub) sub.textContent = `${prettyMode(currentType())} · ${week.length} repas à préparer`;

      // Liste des repas
      const container = document.getElementById('prep-repas');
      if (container) {
        container.innerHTML = week
          .map((r, idx) => `
            <div class="prep-repas-row" data-recipe="${escapeHtml(r.nom)}" data-type="${currentType()}">
              <span class="prep-repas-label">${DAY_LABELS[idx]} — ${escapeHtml(r.nom)}</span>
              <span class="prep-repas-hint">voir ingrédients →</span>
            </div>
          `)
          .join('');
        container.querySelectorAll('.prep-repas-row').forEach((el) => {
          el.addEventListener('click', () =>
            Renderer.mealModal(el.dataset.recipe, el.dataset.type)
          );
        });
      }

      // Ordre de préparation
      const ordre = document.getElementById('prep-ordre-cuisson');
      if (ordre) {
        ordre.innerHTML = `
          <div class="prep-ordre-text">
            1. Sors tous les ingrédients et contenants.<br>
            2. Lance d'abord les féculents mutualisables (riz, quinoa, pâtes).<br>
            3. Enchaîne les plats frigo (lun→mer), puis les plats congélation (jeu→sam).<br>
            4. Portionne immédiatement : dîner / lunchbox / congélation.
          </div>
        `;
      }

      // Goûters (si semaine avec enfants)
      const gSection = document.getElementById('prep-gouters-section');
      const gContainer = document.getElementById('prep-gouters');
      const gOrdre = document.getElementById('prep-gouters-ordre');
      if (state.mode === 'enfants') {
        const labels = getExtras('avec').gouters_labels;
        if (gSection) gSection.style.display = 'block';
        if (gOrdre) gOrdre.style.display = 'block';
        if (gContainer) {
          gContainer.innerHTML = labels
            .map((g, i) => `
              <div class="gouter-prep-row">
                <span class="gouter-day">${SHORT_DAYS[i]}</span>
                <span>${escapeHtml(g)}</span>
              </div>
            `)
            .join('');
        }
      } else {
        if (gSection) gSection.style.display = 'none';
        if (gOrdre) gOrdre.style.display = 'none';
      }
    },

    /**
     * Rend la section Boîtes (détail ingrédients par repas).
     */
    boites() {
      const container = document.getElementById('boites-container');
      if (!container) return;

      const type = currentType();
      const factor = recipeScale(type);
      const week = App.getGeneratedWeek(type);

      const wb = document.getElementById('week-banner-boites');
      if (wb) wb.textContent = `Semaine ${state.weekNum} · ${prettyMode(type)}`;

      container.innerHTML = week
        .map((r, idx) => {
          const items = r.ingredients
            .map((it) => {
              const qty = Formatter.qty({
                ingredient: it.ingredient,
                quantite: Math.round(it.quantite * factor * 10) / 10,
                unite: it.unite,
              });
              return `
                <div class="boite-ingredient-row">
                  <span class="boite-ingredient-name">${Formatter.ingredientLabel(it.ingredient)}</span>
                  <span class="boite-ingredient-qty">${qty}</span>
                </div>
              `;
            })
            .join('');

          return `
            <div class="boite-card" data-recipe="${escapeHtml(r.nom)}" data-type="${type}">
              <div class="boite-header">
                <span class="boite-title">🥡 ${escapeHtml(r.nom)}</span>
                <span class="boite-day">${DAY_LABELS[idx]}</span>
              </div>
              <div class="boite-ingredients">${items}</div>
            </div>
          `;
        })
        .join('');

      container.querySelectorAll('.boite-card').forEach((el) => {
        el.addEventListener('click', () =>
          Renderer.mealModal(el.dataset.recipe, el.dataset.type)
        );
      });
    },

    /**
     * Ouvre le modal de détail d'un repas.
     */
    mealModal(mealName, type = currentType()) {
      const week = App.getGeneratedWeek(type);
      const recipe =
        week.find((r) => r.nom === mealName) ||
        state.recipes.find((r) => r.nom === mealName);
      if (!recipe) return;

      const factor = recipeScale(type);
      const portions = type === 'avec' || type === 'enfants' ? 6 : 4;

      const titleEl = document.getElementById('meal-title');
      const bodyEl = document.getElementById('meal-body');
      if (!titleEl || !bodyEl) return;

      titleEl.textContent = recipe.nom;
      bodyEl.innerHTML = `
        <div class="meal-meta">${recipe.categorie} · ${recipe.type_plat} · ${recipe.conservation} · ${portions} portions</div>
        ${recipe.ingredients
          .map((it) => {
            const qty = Formatter.qty({
              ingredient: it.ingredient,
              quantite: Math.round(it.quantite * factor * 10) / 10,
              unite: it.unite,
            });
            return `
              <div class="meal-ingredient-row">
                <span class="meal-ingredient-name">${Formatter.ingredientLabel(it.ingredient)}</span>
                <span class="meal-ingredient-qty">${qty}</span>
              </div>
            `;
          })
          .join('')}
      `;

      const modal = document.getElementById('meal-modal');
      if (modal) modal.style.display = 'flex';
    },

    /**
     * Synchronise l'affichage des semaines avec/sans selon le mode courant.
     */
    weekToggle() {
      const isSans = state.mode === 'sans_enfants';
      const sansEl = document.getElementById('week-sans');
      const avecEl = document.getElementById('week-avec');
      if (sansEl) sansEl.style.display = isSans ? 'block' : 'none';
      if (avecEl) avecEl.style.display = !isSans ? 'block' : 'none';

      document.querySelectorAll('.wt-btn').forEach((btn) =>
        btn.classList.remove('active')
      );
      const activeIdx = isSans ? 0 : 1;
      const btns = document.querySelectorAll('.week-toggle .wt-btn');
      if (btns[activeIdx]) btns[activeIdx].classList.add('active');
    },
  };

  /* ═══════════════════════════════════════════════
     API PUBLIQUE (window.*) — Appelée depuis le HTML
  ═══════════════════════════════════════════════ */
  window.showSection = function (id, btn) {
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    const section = document.getElementById(id);
    if (section) section.classList.add('active');
    if (btn) btn.classList.add('active');

    // Lazy render des sections lourdes
    if (id === 'boites') Renderer.boites();
    if (id === 'prep') Renderer.prepTab();
  };

  window.showWeek = function (type, btn) {
    document.querySelectorAll('.wt-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const sansEl = document.getElementById('week-sans');
    const avecEl = document.getElementById('week-avec');
    if (sansEl) sansEl.style.display = type === 'sans' ? 'block' : 'none';
    if (avecEl) avecEl.style.display = type === 'avec' ? 'block' : 'none';
  };

  window.openShoppingList = function () {
    ShoppingList.render(currentType());
  };

  window.openShoppingListFor = function (type) {
    ShoppingList.render(type);
  };

  window.closeShoppingList = function () {
    const m = document.getElementById('courses-modal');
    if (m) m.style.display = 'none';
  };

  window.closeMealModal = function () {
    const m = document.getElementById('meal-modal');
    if (m) m.style.display = 'none';
  };

  // Compatibilité avec les appels directs depuis ancien HTML
  window.showMeal = function (mealName, type = currentType()) {
    Renderer.mealModal(mealName, type);
  };

  // Exposer buildBoitesTab pour compatibilité avec l'onclick du tab HTML
  window.buildBoitesTab = function () {
    Renderer.boites();
  };

  /* ═══════════════════════════════════════════════
     DATA LOADER — CHARGEMENT DES JSON
  ═══════════════════════════════════════════════ */
  async function loadData() {
    // Chemin relatif compatible GitHub Pages
    const BASE = 'data/';
    const [recipes, extras, index, nutrition] = await Promise.all([
      fetch(`${BASE}recettes.json`).then((r) => {
        if (!r.ok) throw new Error(`Erreur chargement recettes.json (${r.status})`);
        return r.json();
      }),
      fetch(`${BASE}repas_hors_diners.json`).then((r) => {
        if (!r.ok) throw new Error(`Erreur chargement repas_hors_diners.json (${r.status})`);
        return r.json();
      }),
      fetch(`${BASE}recettes_index.json`).then((r) => {
        if (!r.ok) throw new Error(`Erreur chargement recettes_index.json (${r.status})`);
        return r.json();
      }),
      fetch(`${BASE}nutrition_ingredients.json`).then((r) => {
        if (!r.ok) throw new Error(`Erreur chargement nutrition_ingredients.json (${r.status})`);
        return r.json();
      }),
    ]);
    return { recipes, extras, index, nutrition };
  }

  /* ═══════════════════════════════════════════════
     INITIALISATION
  ═══════════════════════════════════════════════ */
  async function init() {
    // Afficher l'état de chargement
    const loadingEl = document.getElementById('loading-state');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      const data = await loadData();
      state.recipes = data.recipes;
      state.extras = data.extras;
      state.index = data.index;
      state.nutrition = data.nutrition;
      state.weekNum = window.getISOWeek(new Date());
      // Règle : semaine impaire → avec enfants, semaine paire → sans enfants
      state.mode = state.weekNum % 2 === 1 ? 'enfants' : 'sans_enfants';

      // Masquer le chargement
      if (loadingEl) loadingEl.style.display = 'none';

      // Rendu initial
      Renderer.menuTable('sans');
      Renderer.menuTable('avec');
      Renderer.gouters();
      Renderer.prepTab();
      Renderer.banners();
      Renderer.weekToggle();

    } catch (err) {
      console.error('Erreur initialisation :', err);
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div style="text-align:center;color:var(--red);padding:40px;">
            <div style="font-size:24px;margin-bottom:12px;">⚠️</div>
            <div style="font-size:14px;font-weight:600;">Erreur de chargement</div>
            <div style="font-size:12px;color:var(--muted);margin-top:8px;">${err.message}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Vérifiez que les fichiers JSON sont présents dans /data/</div>
          </div>
        `;
        loadingEl.style.display = 'flex';
      }
    }
  }

  window.addEventListener('load', init);
})();
