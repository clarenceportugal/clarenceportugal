# How GitHub Activity updates work

GitHub profile READMEs **cannot run live JavaScript**. So these cards are not
"hardcoded forever" and also not literal second-by-second realtime.

Instead:

1. GitHub Action runs every **6 hours** (or when you click **Run workflow**)
2. Script calls **live GitHub APIs** with your `PROFILE_STATS_TOKEN`
3. It regenerates SVG files under `assets/`
4. Action commits them if anything changed

| Card | Data source |
|------|-------------|
| Streak | GraphQL `viewer.contributionsCollection` |
| Contribution graph | Same contribution calendar |
| Top languages | REST `/user/repos` + each repo `languages` (bytes) |

## Token scopes (important)

Update / recreate `PROFILE_STATS_TOKEN` with:

- `read:user` — contribution stats (including private if shown on profile)
- `repo` — so **Top Languages** includes private repos you own

Without `repo`, languages only see public repos (can look skewed toward Dart/HTML).

Secret name must stay: `PROFILE_STATS_TOKEN`  
Repo: https://github.com/clarenceportugal/clarenceportugal/settings/secrets/actions
