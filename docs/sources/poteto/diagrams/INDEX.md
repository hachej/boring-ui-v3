# Diagram / slide frames — Lauren (@poteto), cursor compile talk

Source: tldraw whiteboard talk (`talk.mp4`). Timestamps are approximate video time.
Culled to distinct teaching visuals (diagrams, charts, architecture slides, UI screenshots).

| # | File | Timestamp | Description |
|---|------|-----------|-------------|
| 1 | `01_title_shipped_2000_prs_0000.jpg` | 00:00 | Title slide: “i shipped 2000 PRs last month” — lauren tan (@poteto), Grok Bot @ SpaceXAI |
| 2 | `02_agenda_four_topics_0048.jpg` | 00:48 | Agenda: 1 trust · 2 how to trust your agents more · 3 your codebase is memory · 4 automations |
| 3 | `03_michelin_kitchen_metaphor_0104.jpg` | 01:04 | Michelin kitchen metaphor illustration — chef + many agent line-cooks plating dishes |
| 4 | `04_github_contribution_graphs_0248.jpg` | 02:48 | Stacked GitHub contribution graphs for poteto with “i shipped 5000+ PRs in 6 months” |
| 5 | `05_trust_vs_agents_curve_0624.jpg` | 06:24 | Trust vs number of agents curve marked 1, 1–5, 5–10, 10–20, hundreds, thousands |
| 6 | `06_how_to_trust_agents_levers_0736.jpg` | 07:36 | “how do i trust my agents more?” — verification, skills (eg pstack), agent-friendly architecture |
| 7 | `07_high_quality_verification_feature_map_cli_0904.jpg` | 09:04 | High-quality verification: FEATURE MAP + CLI → agent can verify its own work |
| 8 | `08_whenever_you_correct_your_agent_1728.jpg` | 17:28 | “whenever you correct your agent” ladder: codebase → static analysis → rules/bugbot → skills → style guide |
| 9 | `09_overview_board_zoom_out_1912.jpg` | 19:12 | Zoomed-out overview of the full tldraw board with multiple sections visible |
| 10 | `10_framework_workaround_propagation_2040.jpg` | 20:40 | “a framework designed for agents”: minimal context; workaround the agent sees propagates more workarounds |
| 11 | `11_codebase_memory_copy_pattern_2152.jpg` | 21:52 | Codebase-as-memory garden: ONE WORKAROUND copies into THE PATTERN |
| 12 | `12_team_needs_gardeners_2512.jpg` | 25:12 | delete tech debt → keep one paved path → lint against anti-patterns; “your team needs gardeners” |
| 13 | `13_five_nouns_dune_app_2656.jpg` | 26:56 | “Five nouns organize every app” — DUNE APP: Feature, Entrypoint, Transcript card, Host, Client |
| 14 | `14_process_boundaries_in_tree_2816.jpg` | 28:16 | “Process boundaries are visible in the tree” — renderer/ vs serving processes across typed edge |
| 15 | `15_host_backed_feature_blueprint_2936.jpg` | 29:36 | Host-backed feature blueprint vertical slice: Feature UI · Client · Shared edge · Host extension |
| 16 | `16_building_michelin_kitchen_agents_3344.jpg` | 33:44 | “building a michelin kitchen”: grok bot, cloud agents, automations + Agent SDK (line-cook vs factory) |
| 17 | `17_slack_glass_oncall_agent_thread_3504.jpg` | 35:04 | Slack-like #glass-oncall-assistant thread — Cursor AGENT reproduces bug and proposes fix |
| 18 | `18_closing_correct_agent_ladder_3704.jpg` | 37:04 | Closing revisit of “whenever you correct your agent” five-step trust ladder |

## Dune schema scroll

Eleven denser stills from the same whiteboard, about 26:40–30:40, while the camera pans the Dune board without stopping. They are not part of the 01–18 set above. The full list is [dune-schema-scroll/INDEX.md](dune-schema-scroll/INDEX.md).
