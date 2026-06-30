import re

def clean_text(text: str) -> str:
    # Collapse runs of blank lines into a single newline
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Collapse horizontal whitespace (spaces/tabs) but preserve newlines
    text = re.sub(r'[^\S\n]+', ' ', text)
    # Strip leading/trailing whitespace from each line
    text = '\n'.join(line.strip() for line in text.splitlines())
    return text.strip()