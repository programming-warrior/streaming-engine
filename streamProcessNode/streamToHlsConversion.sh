#!/bin/bash
# This script is designed to be the ENTRYPOINT of a Docker container.
# It waits for RTP streams defined in stream.sdp, combines them, and creates an HLS stream.

# Exit immediately if a command exits with a non-zero status.
set -e

SDP_FILE="stream.sdp"
OUTPUT_DIR="/output" # This should be a mounted volume
S3_BUCKET="${S3_BUCKET}"
AWS_REGION="${AWS_REGION}"
ROOM_ID="1234"
S3_PREFIX="live-stream/$ROOM_ID"



# Usage: test_udp_connection <ip> <port>
test_udp_connection() {
    local ip="$1"
    local port="$2"
    echo "Testing UDP connectivity to $ip:$port..."

    # Send a UDP packet and wait to see if the port is reachable
    # This test is best-effort since UDP is connectionless
    timeout 2s bash -c "echo -n 'ping' | nc -u -w1 $ip $port"

    if [ $? -eq 0 ]; then
        echo "✅ UDP packet sent to $ip:$port (no confirmation if received)."
    else
        echo "❌ Failed to send UDP packet to $ip:$port."
    fi
}


test_udp_connection $IP $PORT1

test_udp_connection $IP $PORT2

# --- Environment Variables Check ---
echo "--- Checking Environment Variables ---"
if [ -z "$S3_BUCKET" ]; then
    echo "Error: S3_BUCKET environment variable is required"
    exit 1
fi

echo "S3 Bucket: $S3_BUCKET"
echo "AWS Region: $AWS_REGION"

if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

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

# --- Create output directory if it doesn't exist ---
mkdir -p "$OUTPUT_DIR"


# --- Background S3 Upload Process ---
echo "--- Starting S3 Upload Monitor ---"
upload_to_s3() {
    while true; do
        # Upload .ts files
        for file in "$OUTPUT_DIR"/*.ts; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                echo "Uploading $filename to S3..."
                aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                    --region "$AWS_REGION" \
                    --cache-control "max-age=10" \
                    --content-type "video/mp2t"
                
                # Remove local file after successful upload
                if [ $? -eq 0 ]; then
                    rm "$file"
                    echo "Successfully uploaded and removed $filename"
                fi
            fi
        done
        
        # Upload playlist files
        for playlist in "$OUTPUT_DIR"/*.m3u8; do
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

upload_to_s3 &
UPLOAD_PID=$!


# --- Cleanup function ---
cleanup() {
    echo "--- Cleaning up ---"
    kill $UPLOAD_PID 2>/dev/null || true
    
    # Final upload of any remaining files
    echo "Final upload of remaining files..."
    for file in "$OUTPUT_DIR"/*; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                --region "$AWS_REGION" || true
        fi
    done
    
    # Clean up temp directory
    rm -rf "$OUTPUT_DIR"
    echo "Cleanup completed"
}


trap cleanup EXIT INT TERM

# --- Main FFMPEG Command ---
# Key changes for real-time HLS output:
# 1. Added -fflags +flush_packets to force packet flushing
# 2. Added -flush_packets 1 for immediate output
# 3. Reduced -hls_time to 2 seconds for faster segment creation
# 4. Added -hls_flags +append_list+delete_segments+split_by_time
# 5. Added -avoid_negative_ts make_zero to handle timing issues
# 6. Added -use_wallclock_as_timestamps 1 for real-time processing

echo "--- Starting FFMPEG for Real-time HLS ---"
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
-hls_segment_filename "${OUTPUT_DIR}/data%02d.ts" \
-hls_start_number_source epoch \
"${OUTPUT_DIR}/master.m3u8"

echo "--- FFMPEG process finished ---"