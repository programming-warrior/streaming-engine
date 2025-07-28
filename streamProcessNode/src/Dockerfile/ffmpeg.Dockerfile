
FROM jrottenberg/ffmpeg:7-alpine

RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash && \
    python3 -m venv /venv && \
    /venv/bin/pip install --upgrade pip && \
    /venv/bin/pip install awscli

ENV PATH="/venv/bin:$PATH"

WORKDIR /app

COPY streamToHlsConversion.sh /streamToHlsConversion.sh
RUN chmod +x /app/streamToHlsConversion.sh


# Verify AWS CLI installation
RUN aws --version


RUN mkdir -p /output/1080 /output/720 /output/480 

ENV HOME=/root

# Set entrypoint script
ENTRYPOINT ["./streamToHlsConversion.sh"]
