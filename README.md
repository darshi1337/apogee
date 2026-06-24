# Apogee

**Apogee** is a local-first AI browser assistant inspired by Mozilla Orbit. It helps users summarize webpages, PDFs, emails, and YouTube content using open-source language models running locally through Ollama.

Unlike cloud-based AI assistants, Apogee keeps your data on your machine. Content is processed through locally running models, giving you complete control over your privacy, models, and infrastructure.

## Supported Models

Apogee currently supports:

- Qwen 3 8B
- Mistral
- Llama 3.1 8B
- Gemma 3

All models are served locally using Ollama.

## Installation

### 1. Install Ollama

Install Ollama from:

https://ollama.com

Verify installation:

```bash
ollama --version
```

### 2. Install Apogee

```bash
pip install apogee-browser==0.1.0
```

### 3. Download Models

```bash
apogee setup
```

### 4. Start Apogee

```bash
apogee
```

## Browser Extension

Install the Apogee browser extension and connect it to the local backend.

The extension communicates only with:

```text
http://127.0.0.1:8000
```

No user content is sent to external AI providers.

## Usage

### Summarize a Webpage

1. Open any webpage.
2. Click the Apogee extension.
3. Press **Summarize**.
