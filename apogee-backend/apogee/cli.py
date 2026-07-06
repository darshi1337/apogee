import os
import subprocess
import sys
import uvicorn

MODELS = [
    "qwen3:8b",
    "mistral:latest",
    "llama3.1:8b",
    "gemma3:4b",
]


def ollama_installed():
    try:
        subprocess.run(
            ["ollama", "--version"],
            capture_output=True,
            check=True,
        )
        return True
    except Exception:
        return False


def model_installed(model):
    """Check whether a model is installed by parsing the first column of `ollama list`."""
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            check=True,
        )
        # Skip the header row, split each line, and compare the model name column.
        installed = {
            line.split()[0]
            for line in result.stdout.splitlines()[1:]
            if line.strip()
        }
        return model in installed

    except Exception:
        return False


def setup():
    print("Checking Ollama...")
    if not ollama_installed():
        print(
            "\nOllama is not installed.\n"
            "Download it from https://ollama.com\n"
        )
        return
    print("Ollama found.\n")
    for model in MODELS:
        if model_installed(model):
            print(f"✓ {model} already installed")
            continue
        print(f"Installing {model}...")
        try:
            subprocess.run(
                ["ollama", "pull", model],
                check=True,
            )
            print(f"✓ {model} installed")
        except subprocess.CalledProcessError:
            print(f"✗ Failed to install {model}")
    print("\nSetup complete.")


def doctor():
    print("Running diagnostics...\n")
    if ollama_installed():
        print("✓ Ollama installed")
    else:
        print("✗ Ollama not installed")
        return
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            check=True,
        )
        installed = {
            line.split()[0]
            for line in result.stdout.splitlines()[1:]
            if line.strip()
        }
        for model in MODELS:
            if model in installed:
                print(f"✓ {model}")
            else:
                print(f"✗ {model}")
    except Exception:
        print("✗ Could not communicate with Ollama")
    print("\nDiagnostics complete.")


def run_server():
    # Override APOGEE_HOST/APOGEE_PORT to dodge a taken port; the extension
    # defaults to 127.0.0.1:8000, so update its endpoint to match.
    host = os.environ.get("APOGEE_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("APOGEE_PORT", "8000"))
    except ValueError:
        print("Invalid APOGEE_PORT; falling back to 8000.")
        port = 8000

    print(f"Starting Apogee on {host}:{port}")
    if port != 8000 or host != "127.0.0.1":
        print(
            "  Non-default endpoint: update the extension backend URL to match."
        )
    if os.environ.get("APOGEE_API_KEY"):
        print("  API key authentication enabled.")
    elif host not in {"127.0.0.1", "localhost"}:
        print("  Warning: set APOGEE_API_KEY before exposing Apogee publicly.")

    uvicorn.run(
        "apogee.app:app",
        host=host,
        port=port,
    )


def main():
    if len(sys.argv) > 1:
        command = sys.argv[1].lower()
        if command == "setup":
            setup()
            return
        if command == "doctor":
            doctor()
            return
    run_server()


if __name__ == "__main__":
    main()
