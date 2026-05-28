from pathlib import Path

PROMPT_DIR = Path("prompts")

def load_prompt(prompt_name: str):
    path = PROMPT_DIR / f"{prompt_name}.txt"
    with open(path, "r", encoding="utf-8") as file:
        return file.read()

def build_summary_prompt(title, url, content, mode):
    template = load_prompt("summarize")
    return template.format(
        title=title,
        url=url,
        content=content
    )

def build_synthesis_prompt(combined_summary):
    template = load_prompt("synthesize")
    return template.format(
        combined_summary=combined_summary
    )
