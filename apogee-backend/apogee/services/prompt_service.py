from functools import lru_cache
from pathlib import Path
from string import Template

SUMMARY_STYLES = {
    "bullets": (
        "Return only the final answer.\n\n"
        "Rules:\n"
        "- Output 8-14 concise bullet points.\n"
        "- Each bullet must be on its own line.\n"
        "- Do not write any introduction.\n"
        "- Do not write any heading.\n"
        "- Do not write any conclusion.\n"
        "- Do not explain what you are doing.\n"
        "- Do not prefix the output with phrases like "
        "'Here is the summary', 'Summary:', or similar.\n"
        "- Output only the bullet points."
    ),

    "sentences": (
        "Return only the final answer.\n\n"
        "Rules:\n"
        "- Output exactly 7-10 concise sentences.\n"
        "- Put each sentence on a separate line.\n"
        "- Do not use bullets.\n"
        "- Do not use numbering.\n"
        "- Do not write a paragraph.\n"
        "- Do not write any introduction.\n"
        "- Do not write any heading.\n"
        "- Do not write any conclusion.\n"
        "- Do not prefix the response with phrases like "
        "'Here is the summary', 'Summary:', "
        "'Below is a summary', or similar.\n"
        "- Output only the sentences."
    ),

    "paragraphs": (
        "Return only the final answer.\n\n"
        "Rules:\n"
        "- Output one concise paragraph containing 10-15 sentences.\n"
        "- Do not use bullets.\n"
        "- Do not use numbering.\n"
        "- Do not add a heading.\n"
        "- Do not write an introduction.\n"
        "- Do not write a conclusion.\n"
        "- Do not prefix the response with phrases like "
        "'Here is the summary', 'Summary:', or similar.\n"
        "- Output only the paragraph."
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


def build_suggested_questions_prompt(title, url, summary):
    template_str = load_prompt("suggest_questions")
    return Template(template_str).safe_substitute(
        title=title,
        url=url,
        summary=summary,
    )
