#!/usr/bin/env node
/**
 * Regenerates GitHub streak + top-language SVGs for the profile README.
 * Intended to run in GitHub Actions on a schedule.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const USER = process.env.GITHUB_USERNAME || 'clarenceportugal'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')

const headers = {
  'User-Agent': 'clarenceportugal-profile-stats',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
}

async function gh(url) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function fetchAllRepos() {
  const repos = []
  let page = 1
  while (true) {
    const batch = await gh(
      `https://api.github.com/users/${USER}/repos?per_page=100&type=owner&page=${page}`
    )
    if (!batch.length) break
    repos.push(...batch)
    page += 1
    if (page > 10) break
  }
  return repos.filter((r) => !r.fork)
}

function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const COLORS = {
  Dart: '#00B4AB',
  TypeScript: '#3178C6',
  JavaScript: '#F1E05A',
  HTML: '#E34F26',
  CSS: '#563D7C',
  Python: '#3572A5',
  'C++': '#F34B7D',
  C: '#555555',
  Java: '#B07219',
  Kotlin: '#A97BFF',
  PHP: '#4F5D95',
  CMake: '#DA3434',
  default: '#14B8A6'
}

function colorFor(lang) {
  return COLORS[lang] || COLORS.default
}

function buildBarsSvg(title, rows) {
  const height = 34 + rows.length * 40 + 20
  const width = 420
  const barMax = 372
  const total = rows.reduce((s, r) => s + r.value, 0) || 1

  const bars = rows
    .map((row, i) => {
      const yLabel = 68 + i * 40
      const yBar = yLabel + 8
      const w = Math.max(4, Math.round((row.value / total) * barMax))
      const p = pct(row.value, total).toFixed(1)
      const fill = colorFor(row.name)
      return `
  <text x="24" y="${yLabel}" fill="#C9D1D9" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13">${escapeXml(row.name)}</text>
  <text x="396" y="${yLabel}" fill="#8B949E" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" text-anchor="end">${p}%</text>
  <rect x="24" y="${yBar}" width="${barMax}" height="10" rx="5" fill="#21262D"/>
  <rect x="24" y="${yBar}" width="${w}" height="10" rx="5" fill="${fill}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <rect width="${width}" height="${height}" rx="12" fill="#0D1117" stroke="#30363D"/>
  <text x="24" y="34" fill="#14B8A6" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(title)}</text>
${bars}
</svg>
`
}

async function updateLanguages() {
  const repos = await fetchAllRepos()

  const byRepo = new Map()
  for (const repo of repos) {
    if (!repo.language) continue
    byRepo.set(repo.language, (byRepo.get(repo.language) || 0) + 1)
  }

  const byCode = new Map()
  for (const repo of repos) {
    try {
      const langs = await gh(repo.languages_url)
      for (const [lang, bytes] of Object.entries(langs)) {
        byCode.set(lang, (byCode.get(lang) || 0) + Number(bytes))
      }
    } catch {
      // ignore per-repo language fetch failures
    }
  }

  const topRepo = [...byRepo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }))

  const topCode = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }))

  writeFileSync(join(ASSETS, 'top-languages.svg'), buildBarsSvg('Top Languages by Repo', topRepo))
  writeFileSync(join(ASSETS, 'top-languages-code.svg'), buildBarsSvg('Top Languages by Code', topCode))
  console.log('Updated language SVGs')
}

async function updateStreak() {
  const urls = [
    `https://github-readme-streak-stats.herokuapp.com/?user=${USER}&theme=dark&hide_border=true&ring=14B8A6&fire=14B8A6&currStreakLabel=14B8A6&background=0D1117&stroke=30363D&dates=8B949E`,
    `https://streak-stats.demolab.com/?user=${USER}&theme=github_dark&hide_border=true&ring=14B8A6&fire=14B8A6&currStreakLabel=14B8A6`
  ]

  let lastError
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      const svg = await res.text()
      if (!svg.includes('<svg')) throw new Error(`Invalid SVG from ${url}`)
      writeFileSync(join(ASSETS, 'github-streak.svg'), svg)
      console.log(`Updated streak SVG from ${url}`)
      return
    } catch (err) {
      lastError = err
      console.warn(String(err))
    }
  }
  throw lastError || new Error('Failed to update streak SVG')
}

mkdirSync(ASSETS, { recursive: true })
await updateLanguages()
await updateStreak()
console.log('Done')
