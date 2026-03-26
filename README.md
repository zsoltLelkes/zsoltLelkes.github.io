# Deployment Dashboard (GitHub Pages)

**Vanilla JS** dashboard (`index.html`) zobrazuje nasadenia zo súboru **`deployment-data.json`**. Tento súbor **generuje GitHub Actions** podľa **`config.json`** – volania **GitHub API** nebežia v prehliadači (token ostáva v **Actions secrets**, nie v kóde).

---

## Ako to funguje

1. **`config.json`** – `organization` + pole `repositories` (ktoré repozitáre sledovať).
2. **Workflow** `.github/workflows/sync-deployment-data.yml` – podľa **cronu každých 15 minút** a ručne cez *Actions → Sync deployment data → Run workflow* spustí `node scripts/sync-deployments.mjs`.
3. Skript načíta token z prostredia a zapíše **`deployment-data.json`** do koreňa repozitára; ďalší krok urobí **commit + push** (správa obsahuje `[skip ci]`, aby sa nespúšťali zbytočné workflow). V riadkoch, kde aktuálny stav nie je `success`, doplní **`last_success_at`**: najprv **dynamicky** – prejde nedávne úspešné workflow behy v danom repozitári a v **joboch** hľadá rovnaký **GitHub Environment** ako pri nasadení (zodpovedá `environment:` vo workflow); ak to API nevráti alebo nič nesedí, použije sa záloha (história deployment statusov + Actions podľa `head_sha`). Voliteľné pole **`run_url`** obsahuje odkaz na príslušný workflow run (z `target_url` deployment statusu alebo z Actions API podľa `head_sha` commitu nasadenia).
4. **`index.html`** cez `fetch("deployment-data.json")` vykreslí tabuľky a klientske filtre.

**Poznámka:** Plánovaný beh (**cron**) na GitHub beží len z **predvolenej vetvy** repozitára; workflow súbor musí byť na tejto vetve.

---

## Secrets (Settings → Secrets and variables → Actions)

Ukladaj ako **Repository secrets** (nie Variables) – hodnoty sú maskované v logoch.

| Secret | Kedy |
|--------|------|
| *(žiadny extra)* | Ak v `config.json` sleduješ **iba repozitár, v ktorom tento workflow beží**, často stačí vstavaný **`GITHUB_TOKEN`**. |
| **`DEPLOYMENTS_SYNC_TOKEN`** | **Potrebné** pri sledovaní **iných** repozitárov (aj v tej istej org): default **`GITHUB_TOKEN`** na ne nemá právo → API vráti **403** („Resource not accessible by integration“). Vytvor **PAT** na svojom účte (ten musí mať aspoň read na tie repá) a ulož ho ako tento secret. Skript použije `DEPLOYMENTS_SYNC_TOKEN`, ak je nastavený, inak `GITHUB_TOKEN`. |

**PAT (odporúčané minimum):** *Fine-grained* token – Resource owner = org alebo účet, vybrané repozitáre, **Deployments: Read-only** a **Actions: Read** (Actions je potrebné na doplnenie `last_success_at` a `run_url`, keď GitHub nevyplní históriu deployment statusov rovnako ako pri čistých Actions nasadeniach). Classic PAT so scope **`repo`** to zvyčajne pokrýva. Pri org s **SSO** token po vytvorení **autorizuj** pre danú organizáciu.

Pre **súkromné** repozitáre musí mať účet, pod ktorým PAT vytváraš, prístup na všetky uvedené repá; token nepridá oprávnenia nad rámec účtu.

---

## Súbory (aktuálna štruktúra – koreň repozitára)

```
├── index.html
├── styles.css
├── config.json                    # Číta sync skript
├── deployment-data.json           # Generuje Actions; prvý push môže byť prázdny / 0 riadkov
├── scripts/
│   └── sync-deployments.mjs
└── .github/workflows/
    ├── sync-deployment-data.yml   # synchronizácia deployment-data.json
    ├── deploy-staging.yml         # príklad: environment staging (simulovaný deploy)
    └── deploy-development.yml     # príklad: environment development (simulovaný deploy)
```

---

## Všetko v priečinku mimo root

Ak máš stránku a dáta mimo root (napr. GitHub Pages z `/docs`):

- V **workflow** zmeň:
  - `run: node *cesta*/scripts/sync-deployments.mjs` (alebo iná cesta k `.mjs`),
  - `git add *cesta*/deployment-data.json` namiesto `git add deployment-data.json`.

---

## Lokálne spustenie skriptu (voliteľné)

Z koreňa repozitára (alebo uprav cesty podľa umiestnenia skriptu):

```bash
# Windows (PowerShell): $env:GITHUB_TOKEN="ghp_..." alebo $env:DEPLOYMENTS_SYNC_TOKEN="..."
export GITHUB_TOKEN=ghp_xxx          # alebo DEPLOYMENTS_SYNC_TOKEN pre viac repozitárov
node scripts/sync-deployments.mjs
```

---

## GitHub Pages

V **Settings → Pages** nastav zdroj (vetva a priečinok **/** alebo **/docs**) tak, aby root stránky obsahoval `index.html` a aby `deployment-data.json` bol na **tej istej úrovni relatívnych ciest** ako v `fetch()` v `index.html`.

---

## Ďalšie workflow súbory

`deploy-staging.yml` a `deploy-development.yml` sú v tomto repozitári **ukážkové** (simulácia deployu cez environments). Na samotný dashboard a sync **nie sú nutné** – môžeš ich zmazať alebo nahradiť vlastnými pipeline.

---

## Checklist rozbehnutia

- [ ] Upraviť **`config.json`** (`organization`, `repositories`).
- [ ] Ak sleduješ **viac repozitárov** (alebo súkromné repá mimo „aktuálneho“): pridať **repository secret** **`DEPLOYMENTS_SYNC_TOKEN`** (PAT s prístupom k deployments).
- [ ] Zapnúť **Actions** a **Pages**; workflow so **schedule** musí byť na **default vetve**.
- [ ] Spustiť workflow *Sync deployment data* ručne alebo počkať na cron; overiť commit `deployment-data.json`.
- [ ] Otvoriť stránku a overiť dashboard.
