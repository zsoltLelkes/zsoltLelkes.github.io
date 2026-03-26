/**
 * Načíta config.json, stiahne nasadenia z GitHub API, zapíše deployment-data.json.
 * Token: DEPLOYMENTS_SYNC_TOKEN (PAT pre viac repozitárov v org) alebo GITHUB_TOKEN (len aktuálny repo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DISCOVER_DEPLOYMENTS_PAGE_SIZE = 100;

function deploymentEnvironmentKey(d) {
  return d.environment && String(d.environment).trim() !== ""
    ? d.environment
    : "—";
}

function getToken() {
  const t = process.env.DEPLOYMENTS_SYNC_TOKEN || process.env.GITHUB_TOKEN;
  if (!t) {
    console.error("Chýba DEPLOYMENTS_SYNC_TOKEN alebo GITHUB_TOKEN.");
    process.exit(1);
  }
  return t;
}

async function githubFetch(url, token) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchDeploymentStatusesRaw(owner, repo, deploymentId, token) {
  const all = [];
  let page = 1;
  const maxPages = 10;
  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${owner}/${repo}/deployments/${deploymentId}/statuses?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!res.ok) break;
    const statuses = await res.json();
    const arr = Array.isArray(statuses) ? statuses : [];
    all.push(...arr);
    if (arr.length < 100) break;
    page += 1;
  }
  return all;
}

function statusState(s) {
  return String(s?.state || "").toLowerCase();
}

/** Najnovší stav nasadenia + čas tohto stavu (pre úspech = čas úspešného statusu). */
async function fetchLatestDeploymentStatus(owner, repo, deploymentId, token) {
  const statuses = await fetchDeploymentStatusesRaw(
    owner,
    repo,
    deploymentId,
    token
  );
  if (statuses.length === 0) return null;
  const sorted = [...statuses].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  const latest = sorted[0];
  if (!latest || !latest.state) return null;
  const targetUrl =
    latest.target_url && String(latest.target_url).trim() !== ""
      ? String(latest.target_url).trim()
      : null;
  return {
    state: latest.state,
    created_at: latest.created_at || null,
    target_url: targetUrl
  };
}

/**
 * Čas najnovšieho statusu „success“ v histórii daného nasadenia (nie len najnovší status).
 * Pri novšom nasadení GitHub často nastaví starému najnovší stav „inactive“ – samotný úspech
 * zostáva v histórii statusov.
 */
async function fetchNewestSuccessTimeFromDeployment(
  owner,
  repo,
  deploymentId,
  token
) {
  const statuses = await fetchDeploymentStatusesRaw(
    owner,
    repo,
    deploymentId,
    token
  );
  if (statuses.length === 0) return null;
  const sorted = [...statuses].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  const success = sorted.find((s) => statusState(s) === "success");
  return success?.created_at || null;
}

/**
 * Actions často neukladajú „success“ do deployment statusov rovnako ako klasické nasadenia.
 * Fallback: behy s head_sha = commit nasadenia, conclusion = success → čas dokončenia behu.
 * Vyžaduje oprávnenie čítať Actions (fine-grained: Actions → Read).
 */
async function fetchActionsNewestSuccessTimeForSha(owner, repo, sha, token) {
  if (!sha) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=50`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    const ok = runs.filter(
      (r) => String(r.conclusion || "").toLowerCase() === "success"
    );
    if (ok.length === 0) return null;
    const sorted = [...ok].sort(
      (a, b) =>
        new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
    );
    const run = sorted[0];
    return (
      run.updated_at ||
      run.run_started_at ||
      run.created_at ||
      null
    );
  } catch {
    return null;
  }
}

async function fetchLastSuccessTimeForDeployment(owner, repo, deployment, token) {
  const fromStatuses = await fetchNewestSuccessTimeFromDeployment(
    owner,
    repo,
    deployment.id,
    token
  );
  if (fromStatuses) return fromStatuses;
  return await fetchActionsNewestSuccessTimeForSha(
    owner,
    repo,
    deployment.sha,
    token
  );
}

/** Odkaz na workflow run pre commit (ak GitHub Actions v repozitári existujú). */
async function fetchWorkflowRunUrlForSha(owner, repo, sha, token) {
  if (!sha) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    if (runs.length === 0) return null;
    const sorted = [...runs].sort(
      (a, b) =>
        new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    const href = sorted[0].html_url;
    return href && String(href).trim() !== "" ? String(href).trim() : null;
  } catch {
    return null;
  }
}

/**
 * GitHub REST API pri zozname jobov často nevracia pole `environment` (overené na verejnom API),
 * preto sa nedá spoľahlivo párovať podľa job.environment.
 * Spájanie: workflow súbor v `run.path` zvyčajne obsahuje názov prostredia (deploy-staging.yml → staging).
 */
function workflowPathMatchesEnvironment(workflowPath, envName) {
  if (!workflowPath || !envName || envName === "—") return false;
  const p = workflowPath.toLowerCase();
  const e = envName.toLowerCase();
  if (p.includes(e)) return true;
  if (e === "github-pages" && (p.includes("/pages/") || p.includes("pages-build"))) {
    return true;
  }
  return false;
}

/**
 * Dynamicky: prejde nedávne úspešné behy; prvý, kde cesta workflow obsahuje názov prostredia.
 * Žiadne extra volania /jobs, žiadny limit 80 „šumu“ (pages, sync) pred staging.
 */
async function findLastSuccessAtViaWorkflowPath(owner, repo, envName, token) {
  if (!envName || envName === "—") return null;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  let page = 1;
  const maxPages = 20;

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    if (runs.length === 0) break;

    const sorted = [...runs].sort(
      (a, b) =>
        new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
    );

    for (const run of sorted) {
      if (String(run.conclusion || "").toLowerCase() !== "success") continue;
      const path = run.path || "";
      if (workflowPathMatchesEnvironment(path, envName)) {
        return run.updated_at || run.created_at || null;
      }
    }

    if (runs.length < 100) break;
    page += 1;
  }
  return null;
}

/**
 * Posledný čas úspechu v danom prostredí:
 * 1) Úspešné behy, kde workflow path zodpovedá názvu prostredia (bez /jobs – API tam často nemá environment).
 * 2) Nasadenia + história deployment statusov + Actions runs podľa sha.
 */
async function findLastSuccessAt(owner, repo, envName, token) {
  const viaPath = await findLastSuccessAtViaWorkflowPath(
    owner,
    repo,
    envName,
    token
  );
  if (viaPath) return viaPath;

  let page = 1;
  const maxPages = 15;
  while (page <= maxPages) {
    let url;
    if (envName === "—") {
      url = `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100&page=${page}`;
    } else {
      const params = new URLSearchParams({
        environment: envName,
        per_page: "100",
        page: String(page)
      });
      url = `https://api.github.com/repos/${owner}/${repo}/deployments?${params}`;
    }
    let list;
    try {
      list = await githubFetch(url);
    } catch {
      break;
    }
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) break;

    for (const d of arr) {
      if (envName === "—" && deploymentEnvironmentKey(d) !== "—") continue;
      const successAt = await fetchLastSuccessTimeForDeployment(
        owner,
        repo,
        d,
        token
      );
      if (successAt) {
        return successAt;
      }
    }

    if (arr.length < 100) break;
    page += 1;
  }
  return null;
}

async function fetchRepoDeployments(owner, repo, token) {
  const discoverUrl = `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=${DISCOVER_DEPLOYMENTS_PAGE_SIZE}`;
  let discoverList;
  try {
    discoverList = await githubFetch(discoverUrl, token);
  } catch (e) {
    console.warn(`Chyba pre ${owner}/${repo}:`, e.message);
    return [];
  }
  discoverList = Array.isArray(discoverList) ? discoverList : [];
  const envNames = new Set(discoverList.map(deploymentEnvironmentKey));

  const perEnvLists = await Promise.all(
    Array.from(envNames).map(async (envName) => {
      if (envName === "—") {
        const best = discoverList
          .filter((d) => deploymentEnvironmentKey(d) === "—")
          .sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          )[0];
        return best ? [best] : [];
      }
      const params = new URLSearchParams({
        environment: envName,
        per_page: "1"
      });
      const listUrl = `https://api.github.com/repos/${owner}/${repo}/deployments?${params}`;
      try {
        const list = await githubFetch(listUrl, token);
        const arr = Array.isArray(list) ? list : [];
        return arr.length ? [arr[0]] : [];
      } catch {
        return [];
      }
    })
  );

  const merged = perEnvLists.flat();
  const seen = new Set();
  const unique = merged.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  const rows = await Promise.all(
    unique.map(async (d) => {
      const st = await fetchLatestDeploymentStatus(owner, repo, d.id, token);
      let run_url = st?.target_url || null;
      if (!run_url && d.sha) {
        run_url = await fetchWorkflowRunUrlForSha(owner, repo, d.sha, token);
      }
      return {
        owner,
        repo,
        environment: d.environment ?? null,
        ref: d.ref ?? null,
        created_at: d.created_at,
        state: st?.state || "—",
        ...(run_url ? { run_url } : {})
      };
    })
  );
  return rows;
}

function dedupeByRepoAndEnvironment(rows) {
  const map = new Map();
  for (const row of rows) {
    const env = row.environment || "—";
    const key = `${row.owner}/${row.repo}\0${env}`;
    const prev = map.get(key);
    if (
      !prev ||
      new Date(row.created_at) > new Date(prev.created_at)
    ) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function main() {
  const token = getToken();
  const configPath = join(ROOT, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const { organization, repositories } = config;
  if (!organization || !repositories || !Array.isArray(repositories)) {
    console.error("Neplatná konfigurácia v config.json");
    process.exit(1);
  }

  return (async () => {
    const all = [];
    for (const repo of repositories) {
      const part = await fetchRepoDeployments(organization, repo, token);
      all.push(...part);
    }
    const deduped = dedupeByRepoAndEnvironment(all);
    const rows = [];
    for (const row of deduped) {
      if (row.state === "success") {
        rows.push(row);
        continue;
      }
      const envKey = row.environment || "—";
      const last_success_at = await findLastSuccessAt(
        row.owner,
        row.repo,
        envKey,
        token
      );
      rows.push({ ...row, last_success_at });
    }

    const out = {
      generatedAt: new Date().toISOString(),
      organization,
      rows
    };
    const outPath = join(ROOT, "deployment-data.json");
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Zapísané ${rows.length} riadkov do deployment-data.json`);
  })();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
