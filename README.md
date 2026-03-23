# Deployment Dashboard (GitHub Pages)

Jednoduchý **vanilla JS** dashboard v koreňovom `index.html`, ktorý zobrazuje posledné nasadenia z **GitHub Deployments API** pre repozitáre uvedené v `config.json`. Štýly sú v `styles.css`, dáta sa načítavajú priamo v prehliadači (bez backendu).

---

## Čo treba mať na GitHube

| Položka | Popis                                                                                     |
|--------|-------------------------------------------------------------------------------------------|
| **Repozitár** | Repozitár (API bez tokenu má limity; súkromné repozitáre vyžadujú autentifikáciu.         |
| **GitHub Pages** | Zapnuté pre tento repozitár.                                                              |
| **`config.json`** | `organization` (owner org alebo používateľ) + `repositories` (zoznam názvov repozitárov). |
| **Nasadenia** | Repozitáre musíš mať právo aspoň čítať cez API.                                           |

---

## Presun / použitie v inej organizácii (alebo účte)

### 1. Repozitár

- **Možnosť A – fork:** Forkni tento repozitár do cieľovej org/používateľa.
- **Možnosť B – nový repozitár:** Vytvor prázdny repozitár, skopíruj súbory (`index.html`, `styles.css`, `config.json`) a pushni.

### 2. Názov repozitára a GitHub Pages

- **User/Org stránka:** repozitár musí byť **`názov-org.github.io`** (jedna stránka na účet). Obsah ide zvyčajne z vetvy `main` z koreňa alebo z `/docs`.
- **Projektová stránka:** ľubovoľný názov repozitára → **Settings → Pages** → zdroj napr. `Deploy from a branch`, branch `main`, folder `/ (root)`.

Uprav URL v prehliadači podľa toho, čo GitHub zobrazí po zapnutí Pages (napr. `https://moja-org.github.io/` alebo `https://moja-org.github.io/moj-repo/`).

### 3. `config.json`

Uprav **organization** a **repositories**, ktoré chceš sledovať:

```json
{
  "organization": "moja-organizacia",
  "repositories": ["repo-jeden", "repo-dva"]
}
```

- **`organization`:** GitHub **login** organizácie alebo používateľa (owner), pod ktorým repozitáre existujú.
- **`repositories`:** len **názvy** repozitárov (bez `owner/`).

Po každej zmene musí byť `config.json` v repozitári **commitnutý a nasadený** (nový deploy stránky), aby sa dashboard načítal s novou konfiguráciou.

### 4. GitHub API – limity a CORS

- Volania idú z **prehliadača** na `api.github.com` (CORS je pre tento endpoint povolený pri verejných dátach).
- **Neautentifikovaný** limit je cca **60 požiadaviek za hodinu na IP**. Pri viacerých repozitároch a prostrediach sa počet volaní zvyšuje – pri vývoji to môže rýchlo naraziť na limit.
- Ak budeš potrebovať vyšší limit, treba doplniť autentifikáciu (napr. GitHub App, proxy server, alebo token cez backend) – **aktuálna verzia to neobsahuje**.

### 5. Prostredia (staging, development, …)

- V **Settings → Environments** v každom sledovanom repozitári** vytvor názvy prostredí, ktoré používaš vo workflow.
- Workflow súbory v `.github/workflows/` nastavujú `environment:` – po behu workflow vzniknú záznamy v Deployments, ktoré dashboard číta.

---

## Štruktúra projektu (prehľad)

```
├── index.html          # Dashboard + logika načítania dát a filtra
├── styles.css          # Vzhľad tabuliek a filtra
├── config.json         # Sledované repozitáre (owner + zoznam)
├── README.md           # Táto príručka
└── .github/workflows/  # Voliteľné workflow pre prostredia (staging, development, …)
```

---

## TODO – rozbehnutie v novej organizácii

- [ ] Vytvor repozitár (alebo fork) v cieľovej **organizácii / účte**.
- [ ] Zapni **GitHub Pages** (Settings → Pages) na správnej vetve a priečinku.
- [ ] Uprav **`config.json`**: `organization` + `repositories` podľa skutočných mien.
- [ ] Over, že sledované repozitáre sú **verejné** (alebo máš plán na autentifikáciu API).
- [ ] (Voliteľné) V každom sledovanom repozitári vytvor **Environments** a workflow, ak chceš mať nasadenia v konkrétnych prostrediach.
- [ ] Pushni zmeny na `main` (alebo na vetvu nasadenia Pages).
- [ ] Otvor URL Pages a over načítanie dashboardu a dát.
- [ ] Pri problémoch s prázdnymi dátami skontroluj **limity API** (počet repozitárov × počet volaní) a konzolu prehliadača (F12 → Console / Network).

---
