
FROM jrottenberg/ffmpeg:7-alpine

# Install Python and create a virtual environment
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash && \
    python3 -m venv /venv && \
    /venv/bin/pip install --upgrade pip && \
    /venv/bin/pip install awscli

# Ensure the virtual environment's binaries are in the PATH
ENV PATH="/venv/bin:$PATH"

# Create working directory
WORKDIR /app

# Copy entrypoint script and set permissions
COPY streamToHlsConversion.sh /app/streamToHlsConversion.sh
RUN chmod +x /app/streamToHlsConversion.sh


# Verify AWS CLI installation
RUN aws --version

RUN mkdir -p /app/output/1080 /app/output/720 /app/output/480 

ENV HOME=/root

# Set entrypoint script
ENTRYPOINT ["/app/streamToHlsConversion.sh"]
