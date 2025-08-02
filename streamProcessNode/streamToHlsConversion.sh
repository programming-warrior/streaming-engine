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

# Check if directory is writable
if [ ! -w "$TEMP_DIR" ]; then
    echo "Error: Cannot write to $TEMP_DIR"
    exit 1
fi

# --- Test UDP ports are receiving data ---
echo "--- Testing UDP port connectivity ---"
if [ ${#PORT_ARRAY[@]} -gt 0 ]; then
    PORT_LIST=$(printf "port %s or " "${PORT_ARRAY[@]}")
    PORT_LIST=${PORT_LIST% or }  # Remove trailing " or "
    echo "Testing ports: $PORT_LIST"
    timeout 5s tcpdump -c 10 -i any $PORT_LIST 2>/dev/null || echo "No immediate UDP traffic detected (this is normal if streams haven't started)"
else
    echo "❌ No valid ports found in SDP file"
    exit 1
fi

# --- Background S3 Upload Process ---
echo "--- Starting S3 Upload Monitor ---"
upload_to_s3() {
    while true; do
        # Upload .ts files
        for file in "$TEMP_DIR"/*.ts; do
            if [ -f "$file" ] && [ -s "$file" ]; then  # Check file exists and is not empty
                filename=$(basename "$file")
                echo "📤 Uploading $filename to S3 (size: $(stat -c%s "$file") bytes)..."
                
                if aws s3 cp "$file" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                    --region "$AWS_REGION" \
                    --cache-control "max-age=10" \
                    --content-type "video/mp2t"; then
                    echo "✅ Successfully uploaded $filename"
                    # Remove local file after successful upload
                    rm "$file"
                else
                    echo "❌ Failed to upload $filename"
                fi
            fi
        done
        
        # Upload playlist files
        for playlist in "$TEMP_DIR"/*.m3u8; do
            if [ -f "$playlist" ] && [ -s "$playlist" ]; then  # Check file exists and is not empty
                filename=$(basename "$playlist")
                echo "📤 Uploading playlist $filename to S3 (size: $(stat -c%s "$playlist") bytes)..."
                
                if aws s3 cp "$playlist" "s3://$S3_BUCKET/$S3_PREFIX/$filename" \
                    --region "$AWS_REGION" \
                    --cache-control "max-age=1" \
                    --content-type "application/vnd.apple.mpegurl"; then
                    echo "✅ Successfully uploaded playlist $filename"
                else
                    echo "❌ Failed to upload playlist $filename"
                fi
            fi
        done
        
        # List current files in temp directory for debugging
        if [ "$(ls -A $TEMP_DIR 2>/dev/null)" ]; then
            echo "📁 Current files in $TEMP_DIR: $(ls -la $TEMP_DIR)"
        fi
        
        # Check every 3 seconds
        sleep 3
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
        if [ -f "$file" ] && [ -s "$file" ]; then
            filename=$(basename "$file")
            echo "📤 Final upload: $filename"
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

# --- Extract ports from SDP file ---
echo "--- Extracting ports from SDP file ---"
PORTS=$(grep "^m=video" "$SDP_FILE" | awk '{print $2}' | tr '\n' ' ')
echo "Detected RTP ports from SDP: $PORTS"

# Convert to array for easier handling
PORT_ARRAY=($PORTS)
echo "Port array: ${PORT_ARRAY[@]}"

# --- Pre-flight check ---
echo "--- Starting pre-flight check ---"
echo "Checking if UDP ports are accessible..."

# Create a simple test to see if we can bind to the ports (they should be busy if RTP is coming in)
for port in "${PORT_ARRAY[@]}"; do
    if [ -n "$port" ] && [ "$port" -gt 0 ] 2>/dev/null; then
        if nc -l -u -p $port -w 1 < /dev/null 2>/dev/null; then
            echo "⚠️  Port $port appears to be free (no RTP data incoming)"
        else
            echo "✅ Port $port appears to be in use (likely receiving RTP data)"
        fi
    else
        echo "❌ Invalid port detected: '$port'"
    fi
done

# --- Main FFMPEG Command with VP8 optimizations ---
echo "--- Starting FFMPEG for Real-time HLS to S3 ---"
echo "Working directory: $(pwd)"
echo "Temp directory: $TEMP_DIR"
echo "Temp directory permissions: $(ls -ld $TEMP_DIR)"

# Start FFmpeg with comprehensive logging and VP8-specific optimizations
ffmpeg \
-loglevel debug \
-fflags +flush_packets+discardcorrupt+igndts \
-flush_packets 1 \
-protocol_whitelist file,udp,rtp \
-analyzeduration 1000000 \
-probesize 1000000 \
-max_delay 1000000 \
-buffer_size 212992 \
-fifo_size 1000000 \
-rtsp_transport udp \
-avoid_negative_ts make_zero \
-use_wallclock_as_timestamps 1 \
-thread_queue_size 4096 \
-i ${SDP_FILE} \
-filter_complex \
  "[0:v:0]scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v0]; \
   [0:v:1]scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v1]; \
   [v0][v1]hstack=inputs=2,scale=1280:480[vout]" \
-map "[vout]" \
-c:v libx264 \
-preset veryfast \
-tune zerolatency \
-profile:v baseline \
-level 3.1 \
-crf 28 \
-maxrate 2000k \
-bufsize 4000k \
-g 60 \
-keyint_min 60 \
-sc_threshold 0 \
-threads 0 \
-x264opts "sliced-threads:rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0:weightp=0:nal-hrd=cbr:force-cfr=1" \
-f hls \
-hls_time 4 \
-hls_list_size 6 \
-hls_flags append_list+delete_segments+split_by_time+independent_segments \
-hls_segment_filename "${TEMP_DIR}/segment_%03d.ts" \
-hls_start_number_source epoch \
-start_number 0 \
"${TEMP_DIR}/playlist.m3u8" \
2>&1 | while IFS= read -r line; do
    echo "[FFmpeg] $line"
    # Check for specific errors
    if [[ "$line" == *"No such file or directory"* ]]; then
        echo "❌ FFmpeg cannot find input file or has permission issues"
    elif [[ "$line" == *"Keyframe missing"* ]]; then
        echo "⚠️  VP8 keyframe issue detected"
    elif [[ "$line" == *"segment"* ]] && [[ "$line" == *".ts"* ]]; then
        echo "✅ HLS segment created: $line"
    fi
done

echo "--- FFMPEG process finished ---"