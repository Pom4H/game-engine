import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';

const [tag='render-latest', ...files] = process.argv.slice(2);
if (!files.length) throw new Error('usage: node tools/publish-release.mjs <tag> <file...>');

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA ?? 'main';
if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');

const api = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28'
};
const request = async (url, init={}) => {
  const response = await fetch(url, {...init, headers: {...headers, ...(init.headers??{})}});
  if (!response.ok) throw new Error(`${init.method??'GET'} ${url}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

let release;
const byTag = await fetch(`${api}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {headers});
if (byTag.ok) {
  release = await byTag.json();
} else if (byTag.status === 404) {
  release = await request(`${api}/repos/${repository}/releases`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: 'Latest renders',
      body: 'Automatically updated render outputs.',
      prerelease: true
    })
  });
} else {
  throw new Error(`GET release: ${byTag.status} ${await byTag.text()}`);
}

for (const file of files) {
  const name = basename(file);
  const existing = release.assets?.find(asset => asset.name === name);
  if (existing) await request(`${api}/repos/${repository}/releases/assets/${existing.id}`, {method: 'DELETE'});
  const bytes = await readFile(file);
  const upload = await fetch(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length)},
    body: bytes
  });
  if (!upload.ok) throw new Error(`upload ${name}: ${upload.status} ${await upload.text()}`);
  console.log(`published ${name}`);
}
