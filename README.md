# Deployment Dashboard (GitHub Pages)

**Vanilla JS** dashboard (`index.html`) zobrazuje nasadenia z lokálneho súboru **`deployment-data.json`**. Tento súbor **generuje GitHub Actions** podľa `config.json` – volania **GitHub API** nebežia v prehliadači (vhodné pre súkromné repozitáre: token v **Secrets**, nie v kóde).

---

## Ako to funguje

1. **`config.json`** – `organization` + `repositories` (čo sledovať).
2. **Workflow** `.github/workflows/sync-deployment-data.yml` – každých **15 minút** (a ručne cez *Actions → Sync deployment data → Run workflow*) spustí `scripts/sync-deployments.mjs`.
3. Skript použije token z prostredia a zapíše **`deployment-data.json`** (commit + push, správa obsahuje `[skip ci]` aby sa zbytočne nespúšťali ostatné workflow).
4. **`index.html`** načíta len `deployment-data.json` a vykreslí tabuľky + klientsky filter.

---

## Secrets (repo Settings → Secrets and variables → Actions)

| Secret | Kedy |
|--------|------|
| *(žiadny extra)* | Ak máš v `config.json` **len tento istý** repozitár ako dashboard, stačí vstavaný **`GITHUB_TOKEN`** z workflow. |
| **`DEPLOYMENTS_SYNC_TOKEN`** | **Odporúčané**, ak sleduješ **viac repozitárov** v org (alebo cudzie repá): vytvor **Personal Access Token** (classic) s `repo` (čítanie) a ulož ho ako tento secret. Skript použije ho namiesto `GITHUB_TOKEN`, ak je nastavený. |

Pre **súkromné** repozitáre musí mať token používateľ/service prístup na všetky uvedené repozitáre.

---

## Súbory

```
├── index.html              # Dashboard (číta deployment-data.json)
├── deployment-data.json    # Generované Actions; po prvom push môže byť prázdne
├── config.json             # Ktoré repozitáre sledovať
├── styles.css
├── scripts/
│   └── sync-deployments.mjs
└── .github/workflows/
    ├── sync-deployment-data.yml
    ├── deploy-staging.yml      # voliteľné
    └── deploy-development.yml
```

---

## Lokálne spustenie skriptu (voliteľné)

```bash
export GITHUB_TOKEN=ghp_xxx   # alebo PAT s prístupom k repozitárom
node scripts/sync-deployments.mjs
```

---

## GitHub Pages – limity buildov

Pri publikovaní cez **vlastný** Actions workflow sa **soft limit ~10 buildov/h** nevzťahuje rovnako ako pri starom „len branch“ modeli. Synchronizácia každých **15 minút** je rozumná frekvencia; pozor na **minúty Actions** podľa plánu účtu.

---

## Presun do inej organizácie

- Uprav **`config.json`**, pushni.
- Nastav **Secrets** podľa potreby.
- Zapni **Actions** a **Pages** (zdroj z vetvy s `index.html`, zvyčajne root `/`).
- Spusti workflow **Sync deployment data** ručne prvýkrát, alebo počkaj na cron.

---

## TODO – rozbehnutie

- [ ] Upraviť `config.json` (organization + repositories).
- [ ] Pre viac repozitárov pridať **DEPLOYMENTS_SYNC_TOKEN** (PAT).
- [ ] Zapnúť GitHub Pages a Actions.
- [ ] Spustiť workflow *Sync deployment data* a overiť commit `deployment-data.json`.
- [ ] Otvoriť stránku a overiť dashboard.
