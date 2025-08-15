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


# --- Background S3 Upload Process (Corrected with better events and logging) ---
echo "--- Starting S3 Upload Monitor ---"
upload_to_s3() {
    echo "Uploader started. Watching for 'close_write' and 'moved_to' events in $OUTPUT_DIR"
    # CORRECTED: Added 'moved_to' to catch atomic renames of the .m3u8 file.
    inotifywait -m -q -e close_write,moved_to --format '%w%f' "$OUTPUT_DIR" | while read -r FILE_PATH; do
        echo "inotify event detected for: $FILE_PATH"

        if [ ! -f "$FILE_PATH" ]; then
            echo "File $FILE_PATH no longer exists. Skipping."
            continue
        fi

        FILENAME=$(basename "$FILE_PATH")

        if [[ "$FILENAME" == *.ts ]]; then
            echo "Segment ready: $FILENAME. Uploading to S3..."
            aws s3 cp "$FILE_PATH" "s3://$S3_BUCKET/$S3_PREFIX/$FILENAME" \
                --region "$AWS_REGION" \
                --cache-control "max-age=10" \
                --content-type "video/mp2t"
            
            if [ $? -eq 0 ]; then
                rm "$FILE_PATH"
                echo "Successfully uploaded and removed $FILENAME"
            else
                echo "ERROR: Failed to upload $FILENAME"
            fi
        elif [[ "$FILENAME" == *.m3u8 ]]; then
            echo "Playlist updated: $FILENAME. Uploading to S3..."
            aws s3 cp "$FILE_PATH" "s3://$S3_BUCKET/$S3_PREFIX/$FILENAME" \
                --region "$AWS_REGION" \
                --cache-control "max-age=1" \
                --content-type "application/vnd.apple.mpegurl"
            
            if [ $? -eq 0 ]; then
                echo "Successfully uploaded playlist $FILENAME"
            else
                echo "ERROR: Failed to upload playlist $FILENAME"
            fi
        fi
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

# --- Main FFMPEG Command (No changes needed here) ---
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
# THE FIX: Removed 'delete_segments' to give the uploader script full control
-hls_flags append_list+split_by_time \
-hls_segment_filename "${OUTPUT_DIR}/data%d.ts" \
-hls_start_number_source epoch \
"${OUTPUT_DIR}/master.m3u8"