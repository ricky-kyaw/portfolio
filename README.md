# Ricky Kyaw — portfolio site

A hand-written static site. Plain HTML, CSS and JavaScript. No framework, no build step, nothing to install.

## Run it locally

Any static file server works. The small one in the project turns caching off and shows the 404 page, so it is the nicest for editing:

```bash
python tools/serve.py
```

Then open http://localhost:4173/. The site uses root-relative links (`/projects/`), so it must be served from a folder root, not opened as a `file://` page.

## Where things live

```
index.html              Home
story/  education/  projects/  resume/  contact/     one folder per page (clean URLs)
assets/css/site.css     all styles, mobile first
assets/js/main.js       entry point: page transitions, fade-ins, theme, menu, visit counting
assets/js/router.js     fetch-and-swap page transitions (no white flash, no reload)
assets/js/reveal.js     scroll fade-ins
assets/js/theme.js      light / dark
assets/js/cell.js       the notebook cell on Home (commands)
assets/js/mathkit.js    exact math, primes, Fibonacci — written by hand, no eval()
assets/js/figure.js     Figure 1, the random walk
assets/js/github.js     pulls your public repos to fill project links
assets/js/site.config.js   your name, links and service codes
tests/index.html        browser tests for mathkit and the cell (open /tests/)
tools/serve.py          local server for editing (no caching, serves 404.html)
404.html                the page shown for a wrong address (GitHub Pages and Netlify pick it up by name)
```

## Fill in your details

1. **Links and email.** Search the project for `[LINKEDIN_URL]`, `[GITHUB_URL]` and `[MY_EMAIL_ADDRESS]` and replace them. They appear in the HTML pages and in `assets/js/site.config.js`.
2. **Your name.** It is "Ricky Kyaw" everywhere (taken from your GitHub handle). Search and replace if you want something else.
3. **Resume PDF.** Put it at `assets/ricky-kyaw-resume.pdf`, or change the path in `resume/index.html` and `site.config.js`.
4. **Projects, education, skills, bullet points.** Replace the `[PLACEHOLDER]` text on those pages.

## Connect the free services

- **Contact form (Formspree).** Make a free form at formspree.io, copy its id (looks like `xabcdefg`), and replace `[FORMSPREE_ID]` in `contact/index.html`. Messages then go straight to your email, and the page thanks the sender in place.
- **Visit counting (GoatCounter).** Make a free account at goatcounter.com, pick a site code, and put it in `goatcounterCode` in `site.config.js`. Nothing loads until the code is set. No cookies, no personal tracking.
- **GitHub.** `githubUser` in `site.config.js` is already `ricky-kyaw`. Any project link with `data-github-repo="repo-name"` fills itself in from your public repos.
- **Booking (optional).** Replace `[CALCOM_URL]` in `contact/index.html` with your Cal.com link, or delete that row.

## Deploy

Upload the folder to GitHub Pages (user site), Netlify, Cloudflare Pages or Vercel. No build command; the publish folder is the project root. The site expects to live at the root of a domain (for example `ricky-kyaw.github.io` or your own domain).

## Design notes

- Look: quiet engineering graph paper, IBM Plex type, one blue accent.
- Motion: text links draw a thin underline; cards lift 3px with a soft shadow; sections fade in and rise 12px on scroll; pages glide instead of reloading; everything respects "reduce motion".
- The Home cell understands plain English ("show me the projects"), does exact big-number math (`2^64`), tests primes, and computes Fibonacci numbers, all by hand-written code.
