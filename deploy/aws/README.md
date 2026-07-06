# Apogee on AWS EC2

This deploys the existing Apogee backend on one EC2 instance, keeps Ollama
bound locally, and exposes only the FastAPI app through Nginx.

## Instance

Recommended starting point for the four configured Ollama models:

- `g6.xlarge` or larger when available: 1 NVIDIA L4 GPU with 24 GB GPU memory.
- `g5.xlarge` if G6 is unavailable: 1 NVIDIA A10G GPU with 24 GB GPU memory.
- 120 GB or larger EBS volume for OS, Python environment, Ollama, and models.

G6 and G5 both provide 24 GB GPU memory on single-GPU sizes, which is a good
fit for one 4B/8B model loaded at a time through Ollama. Keep concurrency low
at first; the current backend streams each request directly to Ollama.

## Security Group

Inbound:

- SSH `22` only from your IP.
- HTTPS `443` from your users.
- HTTP `80` only for initial certificate issuance or redirect to HTTPS.

Do not expose Ollama's `11434` port publicly.

## Server Setup

On Ubuntu:

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama

ollama pull qwen3:8b
ollama pull mistral:latest
ollama pull llama3.1:8b
ollama pull gemma3:4b

sudo mkdir -p /opt/apogee /etc/apogee
sudo chown -R ubuntu:ubuntu /opt/apogee
git clone https://github.com/darshi1337/apogee.git /opt/apogee

python3 -m venv /opt/apogee/venv
/opt/apogee/venv/bin/pip install -e /opt/apogee/apogee-backend

sudo cp /opt/apogee/deploy/aws/apogee.env.example /etc/apogee/apogee.env
sudo nano /etc/apogee/apogee.env

sudo cp /opt/apogee/deploy/aws/apogee.service /etc/systemd/system/apogee.service
sudo systemctl daemon-reload
sudo systemctl enable --now apogee
```

Use a long random `APOGEE_API_KEY`. For cloud deployments,
`APOGEE_ALLOW_LOCAL_PDFS=0` should stay disabled so browser `file://` PDF URLs
cannot read server-local files.

## Nginx and TLS

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

sudo cp /opt/apogee/deploy/aws/nginx-apogee.conf /etc/nginx/sites-available/apogee
sudo ln -s /etc/nginx/sites-available/apogee /etc/nginx/sites-enabled/apogee
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d your-domain.example
```

After TLS is active, set the extension backend URL to
`https://your-domain.example` and paste the same API key.

## Health Check

```bash
curl -H "X-Apogee-API-Key: $APOGEE_API_KEY" https://your-domain.example/health
```

Expected response:

```json
{"connected":true,"models":["qwen3:8b","mistral:latest","llama3.1:8b","gemma3:4b"]}
```
