#!/bin/bash
# This script is designed to be the ENTRYPOINT of a Docker container.
# It waits for RTP streams defined in stream.sdp, combines them, and creates an HLS stream.

# Exit immediately if a command exits with a non-zero status.
set -e

SDP_FILE="stream.sdp"
OUTPUT_DIR="/output" # This should be a mounted volume
S3_BUCKET="${S3_BUCKET}"
AWS_REGION="${AWS_REGION}"
ROOM_ID="${ROOM_ID}"
S3_PREFIX="live-stream/$ROOM_ID"


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

if ! command -v inotifywait &> /dev/null; then
    echo "Error: inotify-tools is not installed. Please add it to your Dockerfile."
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


# --- Background S3 Upload Process (Corrected Parallel and Resilient) ---
echo "--- Starting S3 Upload Monitor (Parallel, Resilient Polling) ---"
upload_to_s3() {
    local MAX_JOBS=20
    echo "[UPLOADER] Resilient uploader started. Polling every 2 seconds with $MAX_JOBS parallel jobs."
    
    while true; do
        # STEP 1: UPLOAD SEGMENTS FIRST (IN PARALLEL)
        local job_count=0
        
        # THE FIX: Use Process Substitution '< <()' to avoid a subshell deadlock.
        while IFS= read -r -d '' ts_file; do
            # This entire block is run in a background subshell
            (
                if [ -f "$ts_file" ]; then
                    local filename
                    filename=$(basename "$ts_file")
                    echo "[UPLOADER] Found segment: $filename. Starting parallel upload..."
                    
                    if aws s3 cp "$ts_file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                        --region "$AWS_REGION" \
                        --cache-control "max-age=10" \
                        --content-type "video/mp2t"; then
                        
                        rm "$ts_file"
                        echo "[UPLOADER] SUCCESS: Parallel upload for $filename complete."
                    else
                        echo "[UPLOADER] ERROR: Parallel upload for $filename failed. Will retry."
                    fi
                fi
            ) & # The '&' sends the subshell to the background

            job_count=$((job_count + 1))
            if [ "$job_count" -ge "$MAX_JOBS" ]; then
                wait -n # Wait for any single background job to finish
                job_count=$((job_count - 1))
            fi
        done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "*.ts" -print0)
        
        # After the loop, wait for all remaining background jobs to finish
        wait

        # STEP 2: UPLOAD PLAYLIST SECOND (after all segments are done)
        local playlist_path="${OUTPUT_DIR}/master.m3u8"
        if [ -f "$playlist_path" ]; then
            # The '|| true' prevents the script from exiting if the upload fails
            # due to the race condition.
            aws s3 cp "$playlist_path" "s3://$S3_BUCKET/$S3_PREFIX/master.m3u8" \
                --region "$AWS_REGION" \
                --cache-control "max-age=1" \
                --content-type "application/vnd.apple.mpegurl" || \
                echo "[UPLOADER] WARN: Playlist upload failed, likely due to a harmless race condition. Will upload on next cycle."
        fi

        # STEP 3: Wait before the next polling cycle.
        sleep 2
    done
}

# CORRECTED: Redirect uploader output to a dedicated log file for easy debugging.
upload_to_s3 > "${OUTPUT_DIR}/uploader.log" 2>&1 &
UPLOAD_PID=$!


# --- Cleanup function ---
cleanup() {
    echo "--- Cleaning up ---"
    kill $UPLOAD_PID 2>/dev/null || true
    echo "Performing final upload of any remaining files..."
    find "$OUTPUT_DIR" -type f ! -name "uploader.log" -print0 | while IFS= read -r -d '' file; do
        filename=$(basename "$file")
        echo "Final upload for: $filename"
        aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
            --region "$AWS_REGION" || echo "Warning: Final upload for $filename failed."
    done
    echo "Removing local output directory..."
    rm -rf "$OUTPUT_DIR"
    echo "Cleanup completed"
}

trap cleanup EXIT INT TERM

# --- Main FFMPEG Command (Updated for Audio) ---
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
   [v0][v1]hstack=inputs=2[vout]; \
   [0:a:0][0:a:1]amix=inputs=2[aout]" \
-map "[vout]" \
-map "[aout]" \
-c:v libx264 \
-preset ultrafast \
-tune zerolatency \
-crf 28 \
-c:a aac \
-b:a 128k \
-g 60 \
-keyint_min 60 \
-sc_threshold 0 \
-f hls \
-hls_time 2 \
-hls_list_size 10 \
-hls_flags append_list+split_by_time \
-hls_segment_filename "${OUTPUT_DIR}/data%d.ts" \
-hls_start_number_source epoch \
"${OUTPUT_DIR}/master.m3u8"