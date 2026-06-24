from pathlib import Path

PROMPT_DIR = Path("prompts")

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


def load_prompt(name):
    path = PROMPTS_DIR / f"{name}.txt"
    with open(path, "r", encoding="utf-8") as file:
        return file.read()

def build_summary_prompt(title, url, content, mode):
    template = load_prompt("summarize")
    style = SUMMARY_STYLES.get(mode, SUMMARY_STYLES["bullets"])

    return template.format(
        title=title,
        url=url,
        content=content,
        style=style
    )

def build_answer_prompt(title, url, content, question):
    template = load_prompt("answer")
    return template.format(
        title=title,
        url=url,
        content=content,
        question=question
    )
