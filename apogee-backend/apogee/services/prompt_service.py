from functools import lru_cache
from pathlib import Path
from string import Template

SUMMARY_STYLES = {
    "bullets": (
        "IMPORTANT:\n"
        "Return ONLY bullet points.\n"
        "Use 5-8 concise bullets.\n"
        "Each bullet must start with '• '.\n"
        "Each bullet must be on a separate line.\n"
        "Leave one blank line between bullets.\n"
        "Do not write paragraphs.\n"
        "Do not write introductions.\n"
        "Do not write conclusions.\n"
        "Do not write explanations.\n"
        "Output only the bullets."
    ),

    "sentences": (
        "IMPORTANT:\n"
        "Return ONLY short sentences.\n"
        "Write 3-5 concise sentences.\n"
        "Each sentence must be on a separate line.\n"
        "Do not use bullet points.\n"
        "Do not use numbered lists.\n"
        "Do not write a paragraph.\n"
        "Output only the sentences."
    ),

    "paragraphs": (
        "IMPORTANT:\n"
        "Return ONLY one concise paragraph.\n"
        "Use 4-6 sentences.\n"
        "Do not use bullet points.\n"
        "Do not use numbered lists.\n"
        "Do not add headings.\n"
        "Output only the paragraph."
    ),
}

PROMPTS_DIR = (
    Path(__file__).resolve().parent.parent
    / "prompts"
)


@lru_cache(maxsize=None)
def load_prompt(name):
    """Load a prompt template from disk (cached after first read)."""
    path = PROMPTS_DIR / f"{name}.txt"
    return path.read_text(encoding="utf-8")

def build_summary_prompt(title, url, content, mode):
    template_str = load_prompt("summarize")
    style = SUMMARY_STYLES.get(mode, SUMMARY_STYLES["bullets"])

    return Template(template_str).safe_substitute(
        title=title,
        url=url,
        content=content,
        style=style,
    )

def build_answer_prompt(title, url, content, question):
    template_str = load_prompt("answer")
    return Template(template_str).safe_substitute(
        title=title,
        url=url,
        content=content,
        question=question,
    )
