# Ricky Kyaw — portfolio site

Live at https://rickydx.dev

A hand-written static site. Plain HTML, CSS and JavaScript. No framework, no build step, nothing to install. The files in this folder are the website, exactly as they are.

## Run it locally

Any static file server works. The small one in the project turns caching off and shows the 404 page, so it is the nicest for editing:

```bash
python tools/serve.py
```

Then open http://localhost:4173/. The site uses root-relative links (`/projects/`), so it must be served from a folder root, not opened as a `file://` page.

## Where things live

```
index.html              Home
story/  education/  projects/  play/  resume/  contact/  study-log/     one folder per page (clean URLs)
404.html                the page shown for a wrong address (GitHub Pages and Cloudflare Pages pick it up by name)
assets/css/site.css     all styles, mobile first
assets/js/main.js       entry point: page transitions, fade-ins, theme, menu, copy buttons, contact form
assets/js/router.js     fetch-and-swap page transitions (no white flash, no reload)
assets/js/reveal.js     scroll fade-ins
assets/js/theme.js      light / dark (dark unless the visitor picks light)
assets/js/cell.js       the notebook cell on Home (commands)
assets/js/mathkit.js    exact math, primes, Fibonacci — written by hand, no eval()
assets/js/figure.js     Figure 1, the random walk
assets/js/github.js     pulls your public repos to fill project links
assets/js/story.js      the Story page: nine slides, arrows / arrow keys / swipe; drag to turn the two cities; hold to see the Loikaw photo's colours
assets/js/story-walls.js    the quiet backgrounds: the Loikaw photograph redrawn in a few inks (four ways), and three drawn skies with flat Burmese pagoda skylines (the last one runs into London)
assets/js/voxel/engine.js   draws the two block cities: a small 3D renderer written by hand (no WebGL, no library), with water reflections and rain
assets/js/voxel/scenes.js   builds Yangon and London out of blocks (and an older Loikaw), and sets the mood of each
assets/js/home-plates.js    the small board on Home: replays one recorded game of Ransom against itself
assets/js/study-log.js      the Study Log page: streaks, the 39-week grid, "Lock in"; assets/css/study-log.css holds its styles
data/study-log.json     the study hours. You add a line and commit; the page reads it
assets/js/pixelfont.js  the chunky block lettering on the slide titles (drawn from grids, no font file)
assets/img/story/       one still picture per slide, shown when scripts are off and while the scene loads; loikaw.webp is the photograph behind the Loikaw slides; horizon.png is the faint skyline along the bottom of every page in the dark theme
assets/js/play.js       the Play page: a game of chess against Ransom, the engine
assets/js/play/rules.js    the rules of chess (the page's own referee): legal moves, check, mate, draws, notation
assets/js/play/board.js    the board: click, drag or arrow keys; assets/js/play/pieces.js draws the pieces from grids
assets/js/play/engine.js   downloads the engine once and talks to its thread; assets/js/play/worker.js is that thread
assets/wasm/            the engine itself, built from engine-port/: ransom.wasm, ransom-simd.wasm (faster), ransom-net.bin (its weights)
engine-port/            the chess engine rewritten in C, with the tests that prove it plays like the original (see its README)
.github/workflows/engine-port.yml   rebuilds the engine and runs those tests on GitHub whenever engine-port/ changes
assets/js/site.config.js   your name, email, site address and links
assets/img/og.png       the picture shown when the site is shared (1200 x 630)
favicon.ico, assets/img/favicon.svg, assets/img/apple-touch-icon.png   icons
robots.txt, sitemap.xml    for search engines
CNAME, .nojekyll        for GitHub Pages: the custom domain, and "serve these files as they are"
tests/index.html        browser tests for mathkit and the cell (open /tests/)
tools/serve.py          local server for editing (no caching, serves 404.html)
tests/voxel.html        draws every scene in every mood and shows how long each frame takes (open /tests/voxel.html)
tests/study-log.html    tests for the Study Log: London dates, streaks, the grid, bad data (open /tests/study-log.html)
tests/rules.html        tests for the chess rules: move counts to a fixed depth on 110 positions, notation, draws (open /tests/rules.html)
tools/make_images.py    redraws og.png and the PNG icons (needs Pillow; only if you change the name or look)
tools/ground_truth.txt  the facts the site is allowed to state, in your own words
tools/check_facts.py    checks a page against ground_truth.txt: every number, date, grade, name and link must be found there
tools/pack_posters.py   shrinks the Story pictures (needs Pillow)
```

## Changing the Story page

The words live in `story/index.html`, one `<section class="slide">` per slide. A slide is one of two kinds. `data-tier="3d"` (Yangon and London only) names a scene (`data-scene`), a mood (`data-mood`) and where the camera starts (`data-yaw`, `data-pitch`, `data-zoom`, and `data-shift-y` to move the city up or down). `data-tier="wall"` names a background from `assets/js/story-walls.js` (`data-wall`); `data-hold` on the first Loikaw slide lets press-and-hold bring the photograph's colours back. After changing any of those:

1. Run `python tools/serve.py` and open `http://127.0.0.1:4173/story/?capture=1`. This saves a fresh still picture for every slide, and the skyline `horizon.png`, into `assets/img/story/`. It only works on your own machine.
2. Run `python tools/pack_posters.py` to make the pictures small.
3. Run `python tools/check_facts.py`. It must say that everything was found in the ground truth. If you are adding a new fact, add it to `tools/ground_truth.txt` first.

## Adding study hours

1. Open `/study-log/?owner=1` once in your own browser. That turns on your private view (it is remembered in that browser only, and the address is cleaned straight away).
2. Press "Lock in today", enter the hours (0 to 12) and the phase (1 to 4). The page shows one line of JSON and a Copy button.
3. Paste that line into the `entries` list in `data/study-log.json`, commit and push. The public page reads that file.

The blunt "STREAK BROKEN" banner only ever shows in your private view. Visitors see calm wording, and can keep a streak of their own that stays in their browser.

## Changing the chess engine

The Play page runs `assets/wasm/ransom.wasm`. It is built from the C files in `engine-port/src/`, which are a line-by-line port of the Python engine in your `optiver-chessathon-engine` repository. If you change the engine:

1. `pip install ziglang wasmtime` once (a C compiler and a WebAssembly runtime, both as Python packages).
2. `python engine-port/build.py` builds both `.wasm` files.
3. `python engine-port/tests/run_fidelity.py` and again with `--simd`. Both must say PASS: same move, same score and same node count as the original on 104 positions and through four whole games.

`engine-port/README.md` explains how the reference numbers were recorded. Update `tools/ground_truth.txt` if the numbers on the Play page change.

## What is already connected

- **Email.** `origin@rickydx.dev` in every footer, on Resume and Contact, and in `site.config.js`. Contact also lists `human@` and `stdin@`.
- **Links.** GitHub `https://github.com/ricky-kyaw` and LinkedIn `https://www.linkedin.com/in/ricky-kyaw/` in every footer, on Resume and Contact, in `site.config.js`, and in the Home page's search-engine data.
- **Site address.** `https://rickydx.dev` in every page's canonical link, Open Graph and Twitter tags, `sitemap.xml`, `robots.txt` and `CNAME`.
- **Contact form (Formspree).** `contact/index.html` posts to `https://formspree.io/f/xrpbbowj`. With scripts on, the message is sent in place and the page says thank you; with scripts off, it is a normal form post.
- **Visit counting (GoatCounter).** The GoatCounter script tag is in the `<head>` of every page. It counts the first page by itself; `main.js` reports each later page, because moving between pages does not reload anything. GoatCounter ignores visits on `localhost`. No cookies, no personal tracking.
- **GitHub.** `githubUser` in `site.config.js` is `ricky-kyaw`. Any project link with `data-github-repo="repo-name"` fills itself in from your public repos.

## Still to fill in

1. **Your name.** The site shows "Ricky Kyaw", and the Resume page is headed "Myat Hein (Ricky) Kyaw". If the short name ever changes, run `python tools/make_images.py` afterwards to redraw the share picture.
2. **Resume PDF (optional).** The Resume page has a "Print, or save as a PDF" button and a print layout in `site.css`, so the PDF always matches the page. If you would rather offer a file of your own, put it in `assets/` and set `resumePdf` in `site.config.js`.
3. **Projects, education, skills.** These pages are filled in. Every fact on them is listed in `tools/ground_truth.txt`, with where it came from. To change a fact, change it there first, then on the page, then run `python tools/check_facts.py`: it must find every number, date, grade, name and link in the ground truth.
4. **Booking (optional).** There is no booking link on the Contact page yet. If you open a Cal.com page, add one more row to the list at the bottom of `contact/index.html`, in the same shape as the LinkedIn row.

## Deploy

There is no build command. The folder to publish is the project root. The site must live at the root of a domain, which `rickydx.dev` is.

Where the domain stands today (checked 2026-09-18): DNS is at **Porkbun**, email is **Zoho** (three `MX` records plus `TXT` records), and both `rickydx.dev` and `www` still point at Porkbun's parking page. Whichever host you pick, **never delete the Zoho `MX` and `TXT` records**, or `origin@`, `human@` and `stdin@` stop receiving mail.

**GitHub Pages (the simpler route here: DNS stays at Porkbun)**

1. Commit everything, then push this repository to GitHub. On a free account the repository must be public.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Custom domain: `rickydx.dev` (the `CNAME` file already says so).
4. In Porkbun → DNS for `rickydx.dev`, first delete the parking records: the `ALIAS` for the bare domain and the `CNAME` for `www` (and `*`, if present) that point to `pixie.porkbun.com`. Leave every Zoho record alone. Then add four `A` records for the bare domain (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and a `CNAME` record for `www` pointing to `<your-github-username>.github.io`.
5. Wait for GitHub to issue the certificate (usually under an hour), then tick "Enforce HTTPS". A `.dev` domain only works over HTTPS, so until the certificate exists browsers will refuse to open the site. That is normal.

**Cloudflare Pages (needs the domain's DNS moved to Cloudflare)**

1. Workers & Pages → Create → Pages → Connect to Git, and pick this repository.
2. Framework preset: **None**. Build command: **leave empty**. Build output directory: **/**.
3. To use `rickydx.dev` without `www`, Cloudflare requires the domain to be a zone on your Cloudflare account: add the site to Cloudflare, check that it imported every Zoho record (3 `MX`, the SPF `TXT`, the Zoho verification `TXT`, and the DKIM `TXT`), delete the imported Porkbun parking records, then switch the nameservers at Porkbun to the two Cloudflare gives you.
4. Pages project → Custom domains → add `rickydx.dev` and `www.rickydx.dev`, and add a redirect rule from `www` to the bare domain.
5. Security → Settings → turn off **Email Address Obfuscation** for the zone. The pages already opt their addresses out with `<!--email_off-->` comments, because Cloudflare's un-scrambling script does not run when pages change without a reload; turning the feature off as well is the safe double lock.

**After the first deploy, on either host**

- Send yourself one message from the live Contact page. If the page thanks you in place, the form is perfect. If it jumps to a Formspree page with an "are you human" check instead, the message still arrives, but to keep visitors on your site open the form in Formspree → Settings and switch reCAPTCHA off (the hidden honeypot field and Formspree's own spam filter stay on).
- Open GoatCounter and check the visit shows up. Visits from `localhost` are ignored on purpose.
- Paste `https://rickydx.dev` into a LinkedIn post draft or https://www.opengraph.xyz to see the preview card.

Publishing the project root also publishes `README.md`, `tools/`, `tests/` and `engine-port/`. They hold nothing private, and `robots.txt` keeps the last three out of search engines. The `CNAME` and `.nojekyll` files are only read by GitHub Pages and do no harm elsewhere.

## Design notes

- Look: near-black (#0B0D10) pages with an 8% edge vignette, a 2% grain and a faint pixel skyline along the bottom; the light theme is off-white (#FAFAF8) with the vignette only. Instrument Sans for text, IBM Plex Mono for labels, one blue accent, and links inside the page are blue.
- Motion: text links draw a thin underline; cards lift 3px with a soft shadow; sections fade in and rise 12px on scroll; pages glide instead of reloading; everything respects "reduce motion".
- The Home cell understands plain English ("show me the projects"), does exact big-number math (`2^64`), tests primes, and computes Fibonacci numbers, all by hand-written code.
