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
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            check=True,
        )

        return model in result.stdout

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
        installed_models = result.stdout
        for model in MODELS:
            if model in installed_models:
                print(f"✓ {model}")
            else:
                print(f"✗ {model}")
    except Exception:
        print("✗ Could not communicate with Ollama")
    print("\nDiagnostics complete.")


def run_server():
    uvicorn.run(
        "apogee.app:app",
        host="127.0.0.1",
        port=8000,
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
