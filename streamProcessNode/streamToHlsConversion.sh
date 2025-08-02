#!/bin/bash
# This script is designed to be the ENTRYPOINT of a Docker container.
# It waits for RTP streams defined in stream.sdp, combines them, and creates an HLS stream.
# HLS segments are uploaded directly to AWS S3.

# Exit immediately if a command exits with a non-zero status.
set -e

SDP_FILE="stream.sdp"
TEMP_DIR="/app/hls_output"
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
mkdir -p "$TEMP_DIR"

if [ -d "$TEMP_DIR" ]; then
    echo "✅ Temporary directory created successfully: $TEMP_DIR"
else
    echo "❌ Failed to create temporary directory at $TEMP_DIR"
    exit 1
fi

# --- Background S3 Upload Process ---
echo "--- Starting S3 Upload Monitor ---"
upload_to_s3() {
    echo ls "$TEMP_DIR"
    while true; do
        # Upload .ts files
        for file in "$TEMP_DIR"/*.ts; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                echo "Uploading $filename to S3..."
                aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                    --region "$AWS_REGION" \
                    --cache-control "max-age=10" \
                    --content-type "video/mp2t"
                
                # Remove local file after successful upload
                if [ $? -eq 0 ]; then
                    # rm "$file"
                    echo "Successfully uploaded  $filename"
                fi
            fi
        done
        
        # Upload playlist files
        for playlist in "$TEMP_DIR"/*.m3u8; do
            if [ -f "$playlist" ]; then
                filename=$(basename "$playlist")
                echo "Uploading playlist $filename to S3..."
                aws s3 cp "$playlist" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                    --region "$AWS_REGION" \
                    --cache-control "max-age=1" \
                    --content-type "application/vnd.apple.mpegurl"
                
                echo "Successfully uploaded playlist $filename"
            fi
        done
        
        # Check every 2 seconds
        sleep 2
    done
}

# Start the upload process in background
upload_to_s3 &
UPLOAD_PID=$!

# --- Cleanup function ---
cleanup() {
    echo "--- Cleaning up ---"
    kill $UPLOAD_PID 2>/dev/null || true
    
    # Final upload of any remaining files
    echo "Final upload of remaining files..."
    for file in "$TEMP_DIR"/*; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                --region "$AWS_REGION" || true
        fi
    done
    
    # Clean up temp directory
    rm -rf "$TEMP_DIR"
    echo "Cleanup completed"
}

# Set up trap for cleanup on exit
trap cleanup EXIT INT TERM

# --- Main FFMPEG Command ---
echo "--- Starting FFMPEG for Real-time HLS to S3 ---"
ffmpeg \
-loglevel info \
-fflags +flush_packets \
-flush_packets 1 \
-protocol_whitelist file,udp,rtp \
-analyzeduration 5M \
-probesize 5M \
-avoid_negative_ts make_zero \
-use_wallclock_as_timestamps 1 \
-i ${SDP_FILE} \
-filter_complex \
  "[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30[v0]; \
   [0:v:1]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30[v1]; \
   [v0][v1]hstack=inputs=2[vout]" \
-map "[vout]" \
-c:v libx264 \
-preset ultrafast \
-tune zerolatency \
-crf 28 \
-g 60 \
-keyint_min 60 \
-sc_threshold 0 \
-f hls \
-hls_time 2 \
-hls_list_size 10 \
-hls_flags append_list+delete_segments+split_by_time \
-hls_segment_filename "${TEMP_DIR}/data%02d.ts" \
-hls_start_number_source epoch \
"${TEMP_DIR}/master.m3u8"

echo "--- FFMPEG process finished ---"