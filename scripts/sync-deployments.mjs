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
  const url = `https://api.github.com/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!res.ok) return [];
  const statuses = await res.json();
  return Array.isArray(statuses) ? statuses : [];
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
 * Posledný čas úspechu v danom prostredí: pre každé nasadenie (od najnovšieho) hľadáme
 * v histórii statusov záznam „success“ (nie len aktuálny vrchol – ten môže byť inactive).
 */
async function findLastSuccessAt(owner, repo, envName, token) {
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
      const successAt = await fetchNewestSuccessTimeFromDeployment(
        owner,
        repo,
        d.id,
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
