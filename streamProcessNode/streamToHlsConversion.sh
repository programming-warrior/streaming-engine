#!/bin/bash
# This script is designed to be the ENTRYPOINT of a Docker container.
# It waits for RTP streams defined in stream.sdp, combines them, and creates an HLS stream.
# HLS segments are uploaded directly to AWS S3.

# Exit immediately if a command exits with a non-zero status.
set -e

SDP_FILE="stream.sdp"
TEMP_DIR="/tmp/hls_output"
S3_BUCKET="${S3_BUCKET}"
S3_PREFIX="${S3_PREFIX:-live-stream}"
AWS_REGION="${AWS_REGION}"

# --- Environment Variables Check ---
echo "--- Checking Environment Variables ---"
if [ -z "$S3_BUCKET" ]; then
    echo "Error: S3_BUCKET environment variable is required"
    exit 1
fi

echo "S3 Bucket: $S3_BUCKET"
echo "S3 Prefix: $S3_PREFIX"
echo "AWS Region: $AWS_REGION"

# --- AWS CLI Check ---
echo "--- Verifying AWS CLI ---"
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

# Test AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: AWS credentials not configured or invalid"
    echo "Make sure to set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and optionally AWS_SESSION_TOKEN"
    exit 1
fi

echo "AWS credentials verified"

# --- Verification ---
echo "--- Verifying SDP and Network ---"
if [ ! -f "$SDP_FILE" ]; then
    echo "Error: SDP file not found at $SDP_FILE"
    exit 1
fi
echo "SDP file found. Contents:"
cat "$SDP_FILE"
echo "--------------------------------"

# --- Create temporary directory ---
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
echo "✅ Temporary directory created successfully: $TEMP_DIR"



ffmpeg -loglevel debug -i "rtp://172.31.8.60:$PORT1" -f null -
ffmpeg -loglevel debug -i "rtp://172.31.8.60:$PORT2" -f null -