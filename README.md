# make-fun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mamemushi-agent/make-fun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mamemushi-agent/make-fun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. It reads the sealed DefiLlama snapshot and ranks 226 pre-token protocols — the full 40-protocol watchlist plus every rankable pre-token protocol below the $50M floor — by an implied token value calibrated from the snapshot itself: the median market-cap/TVL multiple of the 128 live-token protocols in the same category, winsorised and shrunk toward the global median, then adjusted for 7-day TVL growth, tokenless age and chain breadth. No protocol name is special-cased. Every ranked protocol carries a concrete seven-step farm plan with capital, fee and time estimates derived from its category, chain, TVL and age, and the static dashboard (board, live-token view, calibration view, per-protocol detail) recomputes every row in-page and checks it against board.json.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

With the competition input mounted at `/input`, plain `node main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to `/output`. Node 22, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=sze6h773&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
