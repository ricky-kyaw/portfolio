"""Check that a page states nothing that is not in tools/ground_truth.txt.

    python tools/check_facts.py story/index.html
    python tools/check_facts.py            (checks the pages listed in PAGES)

For the text inside <main> it collects every number, year, grade, month,
counting word and name (a capitalised word that does not start a sentence),
plus every link, and looks each one up in the ground-truth file. Anything
it cannot find is printed, and the exit code is 1.

It cannot judge meaning. It catches invented numbers, dates, names and
links; a person still has to read the sentences.
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRUTH = ROOT / "tools" / "ground_truth.txt"
# Each page, and the sections of the ground truth its numbers and dates may come from.
# (A year from the Education list must not drift onto a Story slide.)
PAGES = {"story/index.html": ["story", "credits"], "play/index.html": ["play"], "education/index.html": ["education"], "projects/index.html": ["projects", "play"],
         "resume/index.html": ["resume", "identity", "education", "projects", "play"],
         "study-log/index.html": ["study-log", "identity"]}

COUNTING = """one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty
hundred thousand million first second third fourth fifth half dozen double twice""".split()
MONTHS = """january february march april may june july august september october november december
jan feb mar apr jun jul aug sep sept oct nov dec""".split()
# Capitalised words that are ordinary English, not names.
PLAIN = set("i i'm i've a an the then now so when on at it my in we see get".split())


# Tags that start a new piece of text (so "Physics" and its grade "A" are not read as one word).
BLOCKS = ("p", "h1", "h2", "h3", "h4", "li", "dt", "dd", "section", "div", "button", "label", "figcaption", "td", "th", "summary")


class MainText(HTMLParser):
    """The words a visitor can read inside <main>, and the links in it."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # > 0 while inside <main>
        self.skip = 0           # > 0 while inside <script>/<style>
        self.blocks = [""]
        self.links = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "main":
            self.depth += 1
        if not self.depth:
            return
        if tag in ("script", "style"):
            self.skip += 1
        if tag in BLOCKS or tag == "br":
            self.blocks.append("")
        else:
            self.blocks[-1] += " "  # a <span> or <a> boundary still separates words
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag == "img" and a.get("alt"):
            self.blocks.append(a["alt"])
            self.blocks.append("")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        if tag == "main" and self.depth:
            self.depth -= 1
        if tag in BLOCKS:
            self.blocks.append("")
        elif self.depth:
            self.blocks[-1] += " "

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.blocks[-1] += data


def words_of(text):
    return re.findall(r"[A-Za-z][A-Za-z'’.]*[A-Za-z]|[A-Za-z]", text)


def stem(word):
    w = word.lower().replace("’", "'")
    w = re.sub(r"'s$", "", w)
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def load_truth():
    text, links, section = {}, set(), ""
    for line in TRUTH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("["):
            section = line.strip("[]")
            continue
        if section == "links":
            links.add(line.rstrip("/"))
        else:
            text.setdefault(section, []).append(line)
    return {k: "\n".join(v) for k, v in text.items()}, links


def check(page, sections, links, allowed=None):
    truth = "\n".join(sections.values())  # names may come from any section
    strict = "\n".join(sections.get(k, "") for k in allowed) if allowed else truth  # numbers and dates may not
    html = (ROOT / page).read_text(encoding="utf-8")
    parser = MainText()
    parser.feed(html)
    blocks = [re.sub(r"\s+", " ", b).strip() for b in parser.blocks]
    blocks = [b for b in blocks if b]
    truth_lower = strict.lower()
    truth_numbers = set(re.findall(r"\d+", strict))
    truth_stems = {stem(w) for w in words_of(truth)}
    problems = []
    # a note left in the page where a fact is still missing: the page is not ready to publish
    for note in re.findall(r"<!--\s*(AI meter: waiting[^>]*?)\s*-->", html):
        problems.append(f"still waiting for a fact: {note}")

    for block in blocks:
        for number in re.findall(r"\d+", block):
            if number not in truth_numbers:
                problems.append(f'number "{number}" in: {block}')
        if "A*" in block and "a*" not in truth_lower:
            problems.append(f'grade "A*" in: {block}')
        for sentence in re.split(r"(?<=[.!?:;])\s+", block):
            for i, word in enumerate(words_of(sentence)):
                low = word.lower().replace("’", "'")
                if low in COUNTING or low in MONTHS:
                    if not re.search(rf"\b{re.escape(low)}\b", truth_lower):
                        problems.append(f'"{word}" in: {block}')
                elif word[0].isupper() and low not in PLAIN and (i > 0 or word.isupper()):
                    if stem(word) not in truth_stems:
                        problems.append(f'name "{word}" in: {block}')

    for href in parser.links:
        if href.startswith(("http://", "https://")):
            if href.rstrip("/") not in links:
                problems.append(f"outside link not in ground truth: {href}")
        elif href.startswith("/"):
            target = ROOT / href.split("#")[0].split("?")[0].lstrip("/")
            if not (target.is_file() or (target / "index.html").is_file()):
                problems.append(f"link to a page that does not exist: {href}")
        elif not href.startswith(("#", "mailto:")):
            problems.append(f"link is not root-relative: {href}")
    return blocks, problems


def main():
    pages = sys.argv[1:] or list(PAGES)
    sections, links = load_truth()
    failed = False
    for page in pages:
        blocks, problems = check(page, sections, links, PAGES.get(page.replace("\\", "/")))
        print(f"{page}: {len(blocks)} pieces of text checked")
        for p in dict.fromkeys(problems):
            print("  NOT IN GROUND TRUTH:", p)
        failed = failed or bool(problems)
        if not problems:
            print("  every number, date, grade, name and link was found in the ground truth")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
