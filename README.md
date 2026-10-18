<h1 align="center">Voxel Musou</h1>

<p align="center"><b>一騎當千 · One warrior. A thousand foes.</b></p>

<p align="center">A voxel action game inspired by Dynasty Warriors.<br>Seven officers, four historical chapters and three ranked trials — playable in your browser.</p>

<p align="center">
  <a href="https://voxel-musou.vercel.app"><img src="media/promo.gif" alt="Voxel Musou trailer: seven officers, four chapters, three trials" width="100%"></a>
</p>

<p align="center">
  <b><a href="https://voxel-musou.vercel.app">▶ Play now</a></b>
  &nbsp; · &nbsp;
  <a href="media/promo.mp4">Watch trailer with sound</a>
  &nbsp; · &nbsp;
  <a href="#run">Run locally</a>
</p>

<p align="center"><b>7 officers</b> &nbsp; / &nbsp; <b>4 chapters</b> &nbsp; / &nbsp; <b>3 trials</b> &nbsp; / &nbsp; <b>4 difficulties</b></p>

<p align="center">
  <a href="#officers">Officers</a> &nbsp; · &nbsp;
  <a href="#story-campaign">Campaign</a> &nbsp; · &nbsp;
  <a href="#trials-and-free-battle">Trials</a> &nbsp; · &nbsp;
  <a href="#difficulty-records-and-saves">Progression</a> &nbsp; · &nbsp;
  <a href="#controls">Controls</a> &nbsp; · &nbsp;
  <a href="#development">Development</a>
</p>

---

## Features

Built with **Three.js r186** and a **fixed 60 Hz simulation**. Plain ES modules, with no package installation or build step needed to play locally.

- Officer-specific voxel models, N1–N6 normal strings, C1–C6 charge attacks, air attacks, dodges and scripted Musou sequences.
- Story objectives include duels, rescues, defence points, pursuit and battlefield set pieces, with officer-specific dialogue and endings.
- Hundreds of instanced soldiers, allied troops, army-specific colours and banners, voxel debris, hit-stop and impact effects.
- Enemy officers and allied hero NPCs with name and HP tags; Cao Cao, Zhang Liao and Xiahou Yuan have dedicated boss models and telegraphed attacks.
- Four fields: daylight Hulao Gate, dusk at Changban, the Red Cliffs night fleet and the golden-hour Mount Dingjun valley, switching within the same page.
- Atmospheric haze, depth of field, bloom, a retro pixel look and automatic MSAA quality reduction under sustained load.
- Procedural WebAudio sound, Chinese / English screen text, brush calligraphy, ink-map prologues and ink-wipe transitions.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="media/title.jpg" alt="Voxel Musou title screen" width="100%"><br>
      <b>Voxel Musou</b><br><sub>Brush calligraphy, voxel officers and a living battlefield</sub>
    </td>
    <td width="50%" align="center">
      <img src="media/select.jpg" alt="Seven officers on the character select screen" width="100%"><br>
      <b>Choose your officer</b><br><sub>Distinct weapons, fighting styles and personal records</sub>
    </td>
  </tr>
</table>

## Officers

<table>
  <tr>
    <td width="50%" align="center">
      <img src="media/guanyu.jpg" alt="Guan Yu's Musou at Mount Dingjun" width="100%"><br>
      <b>關羽 · Guan Yu</b><br><sub>青龍偃月・天斬</sub>
    </td>
    <td width="50%" align="center">
      <img src="media/zhaoyun.jpg" alt="Zhao Yun's Musou at Changban" width="100%"><br>
      <b>趙雲 · Zhao Yun</b><br><sub>蒼龍破陣</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="media/zhugeliang.jpg" alt="Zhuge Liang's Musou at the Red Cliffs" width="100%"><br>
      <b>諸葛亮 · Zhuge Liang</b><br><sub>東風・八陣</sub>
    </td>
    <td width="50%" align="center">
      <img src="media/lubu.jpg" alt="Lü Bu's Musou at Hulao Gate" width="100%"><br>
      <b>呂布 · Lü Bu</b><br><sub>天下無雙・神鬼亂舞</sub>
    </td>
  </tr>
</table>

| Officer | Weapon and fighting style | Musou |
| --- | --- | --- |
| **Liu Bei** (劉備) | Twin swords | 昭烈・雙龍斬 |
| **Guan Yu** (關羽) | Green Dragon Crescent Blade | 青龍偃月・天斬 |
| **Zhang Fei** (張飛) | Serpent spear | 燕人咆哮 |
| **Zhao Yun** (趙雲) | Spear strings and sweeping charges | 蒼龍破陣 — a dragon tears through the crowd |
| **Zhuge Liang** (諸葛亮) | Feather fan, wind blades and formation sigils | 東風・八陣 |
| **Huang Zhong** (黃忠) | Bow slashes, point-blank shots, fan shots, barrages, arrow rain, fire arrows and manual aim | 百步穿楊 — flaming volley and a giant arrow |
| **Lü Bu** (呂布) | Crescent halberd and crescent waves; also the Hulao Gate boss | 天下無雙・神鬼亂舞 |

Six officers are available initially; Lü Bu unlocks after clearing Chapter I. Story chapters use the roster below; trials and free battle offer every unlocked officer.

## Story campaign

Choose **Story (劇情模式)** on the title screen, then a chapter, difficulty and officer. Chapters unlock in order when the preceding chapter is cleared, with any of its officers on any difficulty.

<p align="center">
  <img src="media/story.jpg" alt="Chapter I Hulao Gate ink-map prologue" width="100%"><br>
  <sub>虎牢關 · Chapter I opens with an animated ink-map prologue</sub>
</p>

| Chapter | Playable officers | Battle |
| --- | --- | --- |
| **I · Hulao Gate** (虎牢關, 190) | Liu Bei, Guan Yu, Zhang Fei | Guan Yu's timed Hua Xiong duel and the three brothers against Lü Bu |
| **II · Changban** (長坂坡, 208) | Zhao Yun, Zhang Fei | Rescue A Dou and return as Zhao Yun; hold and break the bridge as Zhang Fei |
| **III · Red Cliffs** (赤壁, 208) | Zhuge Liang, Zhao Yun | Defend the altar, summon the east wind, burn the chained ships and pursue Cao Cao to Huarong Road |
| **IV · Mount Dingjun** (定軍山, 219) | Huang Zhong, Zhao Yun | Fight uphill against Xiahou Yuan |

Follow the objective panel, its direction marker and the minimap. Story battles can end in defeat if the hero falls or an objective fails; meat buns restore HP. Results show rank, KOs, clear time, damage taken, the officer's ending and newly earned records or unlocks. Retry from the result screen to attempt the battle again.

## Trials and free battle

Choose **Trials (演武試煉)** on the title screen for ranked challenges or **Free battle (自由演武)** at the end of that list.

| Trial | Goal | Unlock |
| --- | --- | --- |
| **Thousand Slain** (千人斬) | Defeat 1,000 soldiers within 3 minutes; faster clears improve rank | Available from the start |
| **Hold the Bridge** (死守) | Defend Changban Bridge for 4 minutes against escalating assaults; more KOs improve rank | Clear Chapter II |
| **The Gauntlet** (過關斬將) | Defeat Xiahou Yuan, Zhang Liao, Cao Cao and Lü Bu in sequence; faster clears improve rank | Clear Chapter IV |

Trials can end in defeat, and damage taken also affects rank. Free battle offers endless waves on any of the four fields from the start: the hero cannot die, and no clear records or unlocks are earned there.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="media/trials.jpg" alt="Trials selection screen" width="100%"><br>
      <b>演武試煉 · Trials</b><br><sub>Score attacks, bridge defence and four consecutive duels</sub>
    </td>
    <td width="50%" align="center">
      <img src="media/records.jpg" alt="Records wall with ranks and unlock requirements" width="100%"><br>
      <b>戰績 · Records</b><br><sub>Chase better ranks and unlock your next challenge</sub>
    </td>
  </tr>
</table>

## Difficulty, records and saves

Pick the difficulty after selecting a chapter, trial or free-battle field. Higher tiers increase enemy pressure, officer toughness and incoming damage; Chaos also gives officers resistance to stagger from non-heavy hits.

| Difficulty | Availability | Highest rank |
| --- | --- | --- |
| **Easy** (初級) | From the start | A |
| **Normal** (普通) | From the start | S |
| **Hard** (上級) | From the start | S |
| **Chaos** (修羅) | Clear any story chapter or trial on Hard | S |

Victories save the **best rank, fastest clear and most KOs independently**, for each chapter / trial × officer × difficulty. These appear on the title cards, officer select, the **Records (戰績)** wall and the result screen. Ranks run from C to S and account for KOs, time and cumulative damage taken; trials add stricter S-rank requirements.

Records and the selected difficulty are saved automatically in browser `localStorage`. Unlocks are derived from clear records. Progress is specific to the browser and site origin, so localhost and the hosted game have separate saves; clearing site data resets progress. Battles themselves are not saved for later resumption.

## Run

ES modules don't load from `file://`, so serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open [localhost:8000](http://localhost:8000). Requires a WebGL2 browser; a desktop GPU is recommended. Sound starts on the first key press or click.

## Controls

Keyboard and mouse, or a gamepad.

| Action | Keys | Gamepad |
| --- | --- | --- |
| Move (camera-relative) | WASD / arrow keys | left stick |
| Attack | J / left click | X □ |
| Charge / combo finisher | K / right click | Y △ |
| Jump | Space | A × |
| Dodge | L / Shift | R1 R2 |
| Musou (gauge full) | I | B ○ |
| Camera | mouse (click the field to lock it) / Q E | right stick |
| Recenter / face nearest officer | R | L1 L2 |
| Aim (Huang Zhong) | hold K / right click, release to loose | — |
| Toggle HUD control hints | H | |
| Pause / controls | Esc | |

Tap attack repeatedly for N1–N6. Charge from neutral gives C1; charge after N1–N5 branches into C2–C6 (for example, **J → J → K** gives C3). Huang Zhong can hold K / right click from neutral to aim, then release to shoot; manual aim currently requires keyboard / mouse. Attack or charge while airborne performs an air attack.

Menus support WASD / arrow keys to move, Enter / Space / J to confirm and Esc / Backspace / K to go back; on a gamepad, use the d-pad / left stick, A / × to confirm and B / ○ to go back. Click the field to capture the mouse for camera control; that first capture click does not attack. Losing pointer lock or switching away from the window pauses the battle. The pause menu offers resume, controls and a confirmed return to the title.

---

## Development

<details>
<summary><b>Battle shortcuts and URL options</b></summary>

Add these parameters to the local URL:

| URL parameter | Description |
| --- | --- |
| `?enemies=N` | Enemy grunt slot capacity, 0–2000 (default 300); waves reuse slots, officer and ally slots are separate |
| `?go=free\|story\|trial` | Start directly in a battle, skipping menu selection and the story prologue |
| `&char=ID` | Officer: `liubei`, `guanyu`, `zhangfei`, `zhaoyun`, `zhugeliang`, `huangzhong`, `lubu` (default `zhaoyun`) |
| `&ch=ID` | Chapter: `hulao`, `changban`, `chibi`, `dingjun`; trial: `slay`, `hold`, `gauntlet` |
| `&map=ID` | Free-battle field: `hulao`, `changban`, `chibi`, `dingjun` |
| `?hq` | Pin full render quality (no automatic MSAA downgrade) |

Examples:

- [Zhao Yun at Changban](http://localhost:8000/?go=story&char=zhaoyun&ch=changban)
- [Huang Zhong in Thousand Slain](http://localhost:8000/?go=trial&char=huangzhong&ch=slay)
- [Lü Bu free battle at Hulao Gate](http://localhost:8000/?go=free&char=lubu&map=hulao&enemies=300)

These shortcuts bypass menu unlock and roster restrictions and use the saved difficulty. For trial shortcuts, always specify a trial ID with `ch`.

</details>

<details>
<summary><b>Project layout and architecture</b></summary>

```text
index.html       Entry point, importmap and screen CSS
src/main.js      Boot, screen flow, battle reset and fixed-step loop
src/core/        Input, events, RNG, difficulty, records and unlocks
src/chars/       Officer registry, playable kits, models and NPC boss kits
src/hero/        Shared rig, locomotion, animation and combo state machine
src/combat/      Hit detection, damage and projectiles
src/crowd/       Soldier simulation, armies and instanced rendering
src/actors/      Boss / allied hero NPCs and healing pickups
src/musou/       Shared Musou simulation, scripted sequences and presentation
src/story/       Chapter / trial data, objective director, prologue and results
src/world/       Four maps, terrain, set pieces, sky and scenery
src/ui/          Title, officer select, loading, HUD and menu navigation
src/camera/      Camera control and occlusion handling
src/vfx/         Combat effects and arrow rendering
src/post/        Post-processing and adaptive MSAA
src/audio/       Procedural battle audio and sound bank
vendor/three/    Vendored Three.js r186
checks/          Node regression scripts and simulation probes
media/           README screenshots and trailer (GIF, MP4)
```

Simulation and presentation are separated: gameplay advances in fixed 60 Hz steps, while render modules read simulation state. Officers share the hero / combat infrastructure through kits; story chapters and trials share a data-driven objective director.

</details>

<details>
<summary><b>Manual checks and simulation probes</b></summary>

The repository includes checks that can be run explicitly with **Node 22.15+**; they do not require a browser or package installation:

| Command | Scope |
| --- | --- |
| `node checks/campaign.mjs` | Chapter scripting, progression, difficulty and records regressions |
| `node checks/campaign-walk.mjs [chapter] [hero]` | Campaign routes through the real simulation, with invulnerability and boosted damage for traversal |
| `node checks/trials.mjs` | Trial scripting, victory / defeat conditions and S-rank gates |
| `node checks/trials-bot.mjs [trial] [hero] [difficulty] [seed]` | Trial balance probe using input-only bots; supports `--dodge` and `--air` |
| `node checks/shared-originality.mjs` | Shared model geometry, render commands and scripted Musou timing |
| `node src/chars/check.mjs` | Playable / NPC kit contracts, portraits, moves, animation clips and Musou |
| `node src/world/changban.check.mjs` | Changban bridge set pieces and terrain / walk-height consistency |
| `node checks/gamepad.mjs` | Gamepad slot selection, non-standard mapping fallback, menu nav and battle sample() |
| `node checks/gamepad-browser.mjs` | Headless Chromium: injected pads drive the title menu and a battle |

These scripts cover simulation and source contracts; they do not verify browser rendering or replace playing the battles.

</details>

## Credits & License

- Code: MIT, see [LICENSE](LICENSE).
- [three.js](https://threejs.org/): MIT.
- HUD fallback font `src/ui/brush.woff2` is a subset of Yuji Boku by Kinuta Font Factory, licensed under the SIL Open Font License 1.1.

This is a fan project, not affiliated with or endorsed by KOEI TECMO. "Dynasty Warriors" is a trademark of KOEI TECMO. No game assets from the original games are included.
