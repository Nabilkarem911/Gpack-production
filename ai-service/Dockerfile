FROM python:3.11-slim

WORKDIR /app

# Install system deps for vosk + wget for model download
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget unzip libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download Vosk Arabic model (small ~50MB) during build
RUN mkdir -p /app/models && \
    wget -q https://alphacephei.com/vosk/models/vosk-model-ar-mgb2-0.4.zip -O /tmp/model.zip && \
    unzip -q /tmp/model.zip -d /app/models && \
    mv /app/models/vosk-model-ar-mgb2-0.4 /app/models/ar && \
    rm /tmp/model.zip

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
