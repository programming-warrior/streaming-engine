#!/bin/bash
# This script is designed to be the ENTRYPOINT of a Docker container.
# It waits for RTP streams defined in stream.sdp, combines them, and creates an HLS stream.

# Exit immediately if a command exits with a non-zero status.
set -e

SDP_FILE="stream.sdp"
OUTPUT_DIR="/output" # This should be a mounted volume

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