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

# --- Main FFMPEG Command ---
# This is the single, robust command to execute.
# The invalid -timeout and -reconnect flags have been confirmed to be removed.
# -analyzeduration and -probesize are the correct flags to handle delays in the RTP stream.
# -loglevel debug provides maximum information if an error occurs.

echo "--- Starting FFMPEG ---"
ffmpeg \
-loglevel debug \
-protocol_whitelist file,udp,rtp \
-analyzeduration 20M \
-probesize 20M \
-i ${SDP_FILE} \
-filter_complex \
  "[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30[v0]; \
   [0:v:1]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30[v1]; \
   [v0][v1]hstack=inputs=2[vout]" \
-map "[vout]" \
-c:v libx264 \
-preset ultrafast \
-crf 28 \
-g 60 \
-f hls \
-hls_time 4 \
-hls_list_size 5 \
-hls_flags delete_segments+independent_segments \
-hls_segment_filename "${OUTPUT_DIR}/data%02d.ts" \
"${OUTPUT_DIR}/master.m3u8"

echo "--- FFMPEG process finished successfully ---"
