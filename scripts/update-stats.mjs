#!/usr/bin/env node
/**
 * Regenerates GitHub Activity SVGs from GitHub's own APIs only:
 * - Languages: REST /users/{user}/repos + /repos/.../languages
 * - Streak + contribution graph: GraphQL contributionsCollection
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const USER = process.env.GITHUB_USERNAME || 'clarenceportugal'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')

const TEAL = '#14B8A6'
const TEAL_SOFT = '#2DD4BF'
const BG = '#0D1117'
const BORDER = '#30363D'
const TEXT = '#C9D1D9'
const MUTED = '#8B949E'

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required so stats come from GitHub APIs.')
  process.exit(1)
}

const restHeaders = {
  'User-Agent': 'clarenceportugal-profile-stats',
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`
}

const gqlHeaders = {
  'User-Agent': 'clarenceportugal-profile-stats',
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
}

async function gh(url) {
  const res = await fetch(url, { headers: restHeaders })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function graphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: gqlHeaders,
    body: JSON.stringify({ query, variables })
  })
  const json = await res.json()
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join('; ') || `${res.status} GraphQL`)
  }
  return json.data
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
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
  default: TEAL
}

function colorFor(lang) {
  return COLORS[lang] || COLORS.default
}

function parseUtcDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function formatShortDate(isoDate) {
  const dt = new Date(parseUtcDate(isoDate))
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function dayDiff(aIso, bIso) {
  return Math.round((parseUtcDate(bIso) - parseUtcDate(aIso)) / 86400000)
}

/** Fetch every contribution day from account creation via GitHub GraphQL. */
async function fetchContributionDays() {
  const meta = await graphql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
          contributionCalendar { totalContributions }
        }
      }
    }`,
    { login: USER }
  )

  const createdAt = new Date(meta.user.createdAt)
  const startYear = createdAt.getUTCFullYear()
  const endYear = new Date().getUTCFullYear()
  const days = []

  for (let year = startYear; year <= endYear; year += 1) {
    const from = `${year}-01-01T00:00:00Z`
    const to = `${year}-12-31T23:59:59Z`
    const data = await graphql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }`,
      { login: USER, from, to }
    )

    const weeks = data.user.contributionsCollection.contributionCalendar.weeks
    for (const week of weeks) {
      for (const day of week.contributionDays) {
        days.push({
          date: day.date,
          count: Number(day.contributionCount) || 0
        })
      }
    }
  }

  // Deduplicate by date (year boundaries can overlap in calendar weeks)
  const byDate = new Map()
  for (const day of days) byDate.set(day.date, day)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function computeStreaks(days) {
  const total = days.reduce((sum, d) => sum + d.count, 0)
  const active = days.filter((d) => d.count > 0)

  let longest = 0
  let longestStart = null
  let longestEnd = null
  let run = 0
  let runStart = null

  for (let i = 0; i < days.length; i += 1) {
    if (days[i].count > 0) {
      if (run === 0) runStart = days[i].date
      else if (dayDiff(days[i - 1].date, days[i].date) !== 1) {
        run = 0
        runStart = days[i].date
      }
      run += 1
      if (run > longest) {
        longest = run
        longestStart = runStart
        longestEnd = days[i].date
      }
    } else {
      run = 0
      runStart = null
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const byDate = new Map(days.map((d) => [d.date, d.count]))

  let current = 0
  let currentStart = null
  let currentEnd = null
  let cursor = byDate.get(todayIso) > 0 ? todayIso : yesterday

  if (byDate.get(cursor) > 0) {
    currentEnd = cursor
    while (byDate.get(cursor) > 0) {
      current += 1
      currentStart = cursor
      const prev = new Date(parseUtcDate(cursor) - 86400000).toISOString().slice(0, 10)
      cursor = prev
    }
  }

  return {
    total,
    longest,
    longestStart,
    longestEnd,
    current,
    currentStart,
    currentEnd,
    firstActive: active[0]?.date || null,
    lastActive: active.at(-1)?.date || null
  }
}

function buildStreakSvg(stats) {
  const totalLabel = String(stats.total)
  const currentLabel = String(stats.current)
  const longestLabel = String(stats.longest)
  const totalRange =
    stats.firstActive && stats.lastActive
      ? `${formatShortDate(stats.firstActive)} - ${formatShortDate(stats.lastActive)}`
      : 'No contributions yet'
  const currentRange =
    stats.currentStart && stats.currentEnd
      ? `${formatShortDate(stats.currentStart)} - ${formatShortDate(stats.currentEnd)}`
      : 'No current streak'
  const longestRange =
    stats.longestStart && stats.longestEnd
      ? `${formatShortDate(stats.longestStart)} - ${formatShortDate(stats.longestEnd)}`
      : 'No longest streak'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="GitHub contribution streak from GitHub API">
  <rect width="495" height="195" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <line x1="165" y1="28" x2="165" y2="170" stroke="${BORDER}"/>
  <line x1="330" y1="28" x2="330" y2="170" stroke="${BORDER}"/>

  <g font-family="Segoe UI, Helvetica, Arial, sans-serif" text-anchor="middle">
    <text x="82.5" y="56" fill="${MUTED}" font-size="14">Total Contributions</text>
    <text x="82.5" y="110" fill="${TEAL}" font-size="36" font-weight="700">${escapeXml(totalLabel)}</text>
    <text x="82.5" y="148" fill="${MUTED}" font-size="11">${escapeXml(totalRange)}</text>

    <text x="247.5" y="42" fill="${TEAL}" font-size="14" font-weight="600">Current Streak</text>
    <text x="247.5" y="110" fill="${TEXT}" font-size="40" font-weight="700">${escapeXml(currentLabel)}</text>
    <text x="247.5" y="136" fill="${MUTED}" font-size="12">days</text>
    <text x="247.5" y="160" fill="${MUTED}" font-size="11">${escapeXml(currentRange)}</text>

    <text x="412.5" y="56" fill="${MUTED}" font-size="14">Longest Streak</text>
    <text x="412.5" y="110" fill="${TEAL}" font-size="36" font-weight="700">${escapeXml(longestLabel)}</text>
    <text x="412.5" y="148" fill="${MUTED}" font-size="11">${escapeXml(longestRange)}</text>
  </g>
</svg>
`
}

function buildContributionGraphSvg(days) {
  // Last ~52 weeks of daily totals, then aggregate by week for a clean line chart
  const cutoff = new Date(Date.now() - 52 * 7 * 86400000).toISOString().slice(0, 10)
  const recent = days.filter((d) => d.date >= cutoff)
  const weeks = []
  for (let i = 0; i < recent.length; i += 7) {
    const slice = recent.slice(i, i + 7)
    weeks.push({
      date: slice[0].date,
      count: slice.reduce((s, d) => s + d.count, 0)
    })
  }

  const width = 1200
  const height = 420
  const padL = 56
  const padR = 28
  const padT = 72
  const padB = 56
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const max = Math.max(1, ...weeks.map((w) => w.count))

  const points = weeks.map((w, i) => {
    const x = padL + (weeks.length <= 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW)
    const y = padT + plotH - (w.count / max) * plotH
    return { x, y, ...w }
  })

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${points.at(-1).x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  const yTicks = 4
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = Math.round((max * (yTicks - i)) / yTicks)
    const y = padT + (plotH * i) / yTicks
    return `
  <line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="${BORDER}" stroke-dasharray="4 6"/>
  <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" fill="${MUTED}" font-size="12" text-anchor="end" font-family="Segoe UI, Helvetica, Arial, sans-serif">${value}</text>`
  }).join('')

  const xLabels = [0, Math.floor(points.length / 2), points.length - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i && points[v])
    .map((idx) => {
      const p = points[idx]
      return `<text x="${p.x.toFixed(1)}" y="${height - 22}" fill="${MUTED}" font-size="12" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif">${escapeXml(formatShortDate(p.date))}</text>`
    })
    .join('\n  ')

  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${TEAL_SOFT}" stroke="${BG}" stroke-width="1.5"/>`
    )
    .join('\n  ')

  const totalRecent = recent.reduce((s, d) => s + d.count, 0)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub contribution graph from GitHub API">
  <rect width="${width}" height="${height}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <text x="${width / 2}" y="36" fill="${TEAL}" font-size="22" font-weight="700" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif">Contribution Graph</text>
  <text x="${width / 2}" y="58" fill="${MUTED}" font-size="13" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif">${totalRecent} contributions in the last year | sourced from GitHub GraphQL</text>
${grid}
  <path d="${area}" fill="${TEAL}" fill-opacity="0.18"/>
  <path d="${line}" fill="none" stroke="${TEAL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${xLabels}
</svg>
`
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
  <text x="24" y="${yLabel}" fill="${TEXT}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13">${escapeXml(row.name)}</text>
  <text x="396" y="${yLabel}" fill="${MUTED}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" text-anchor="end">${p}%</text>
  <rect x="24" y="${yBar}" width="${barMax}" height="10" rx="5" fill="#21262D"/>
  <rect x="24" y="${yBar}" width="${w}" height="10" rx="5" fill="${fill}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} from GitHub API">
  <rect width="${width}" height="${height}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <text x="24" y="34" fill="${TEAL}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(title)}</text>
${bars}
</svg>
`
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

async function updateLanguages() {
  const repos = await fetchAllRepos()

  const byRepo = new Map()
  for (const repo of repos) {
    if (!repo.language) continue
    byRepo.set(repo.language, (byRepo.get(repo.language) || 0) + 1)
  }

  const byCode = new Map()
  for (const repo of repos) {
    const langs = await gh(repo.languages_url)
    for (const [lang, bytes] of Object.entries(langs)) {
      byCode.set(lang, (byCode.get(lang) || 0) + Number(bytes))
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
  console.log('Updated language SVGs from GitHub REST API')
}

async function updateContributionWidgets() {
  const days = await fetchContributionDays()
  const streaks = computeStreaks(days)
  writeFileSync(join(ASSETS, 'github-streak.svg'), buildStreakSvg(streaks))
  writeFileSync(join(ASSETS, 'contribution-graph.svg'), buildContributionGraphSvg(days))
  console.log(
    `Updated streak + contribution graph from GitHub GraphQL (total=${streaks.total}, current=${streaks.current}, longest=${streaks.longest})`
  )
}

mkdirSync(ASSETS, { recursive: true })
await updateLanguages()
await updateContributionWidgets()
console.log('Done — all GitHub Activity cards sourced from GitHub APIs')
