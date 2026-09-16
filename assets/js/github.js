// Pulls your public repos from GitHub so project cards can link to the code
// automatically. Results are cached in the browser for an hour so we stay far
// under GitHub's limit for anonymous requests (60 per hour per visitor).

const TTL = 60 * 60 * 1000;

export async function fetchRepos(user) {
  const key = 'gh:' + user;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.t < TTL) return hit.repos;
  } catch (e) { /* ignore */ }

  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('GitHub said ' + res.status);
  const raw = await res.json();
  const repos = raw
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      name: r.name,
      url: r.html_url,
      description: r.description || '',
      language: r.language || '',
      stars: r.stargazers_count || 0,
      homepage: r.homepage || '',
      updated: r.pushed_at,
      topics: r.topics || [],
    }));
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), repos })); } catch (e) { /* ignore */ }
  return repos;
}

// Fill in any <a data-github-repo="name"> whose href is still a placeholder,
// and any [data-github-meta="name"] with language and star count.
export async function hydrateGithubLinks(user, root = document) {
  const links = root.querySelectorAll('[data-github-repo]');
  if (!links.length) return;
  let repos;
  try {
    repos = await fetchRepos(user);
  } catch (e) {
    return; // leave the placeholder links alone
  }
  const byName = new Map(repos.map((r) => [r.name.toLowerCase(), r]));
  links.forEach((a) => {
    const r = byName.get(a.dataset.githubRepo.toLowerCase());
    if (!r) return;
    if (a.tagName === 'A' && /\[GITHUB_URL\]|^#?$/.test(a.getAttribute('href') || '')) a.href = r.url;
    const meta = root.querySelector(`[data-github-meta="${a.dataset.githubRepo}"]`);
    if (meta) {
      const bits = [];
      if (r.language) bits.push(r.language);
      if (r.stars) bits.push(`${r.stars} ★`);
      meta.textContent = bits.join(' · ');
    }
  });
}
