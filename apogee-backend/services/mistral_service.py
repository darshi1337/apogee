# `services/mistral_service.py`

from ollama import chat

def stream_summary(prompt: str):
    stream = chat(
        model='mistral',
        messages=[
            {
                'role': 'user',
                'content': prompt
            }
        ],
        stream=True,
        options={
            "temperature": 0.2
        }
    )
    for chunk in stream:
        content = chunk['message']['content']
        yield content
