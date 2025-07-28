#!/bin/bash
#
#
#
#





# OUTPUT_PATH="$HOME/output"

# Create output directory
# mkdir -p $OUTPUT_PATH/1080
# mkdir -p $OUTPUT_PATH/720
# mkdir -p $OUTPUT_PATH/480



# VIDEO_DIM=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$INPUT_VIDEO")
# WIDTH=$(echo $VIDEO_DIM | cut -d'x' -f1)
# HEIGHT=$(echo $VIDEO_DIM | cut -d'x' -f2)

# if [ "$WIDTH" -ge "$HEIGHT" ]; then
#         echo "processing 1080"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1920:1080 -b:v 5M -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/1080/chunk%03d.ts  $OUTPUT_PATH/1080/index.m3u8
#         echo "processing 720"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1280:720 -b:v 3M  -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/720/chunk%03d.ts  $OUTPUT_PATH/720/index.m3u8
#         echo "processing 480"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=854:480 -b:v 2M -hls_time 2 -f hls -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/480/chunk%03d.ts $OUTPUT_PATH/480/index.m3u8

# elif [ "$WIDTH" -lt "$HEIGHT" ]; then
#         echo "processing 1080"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1080:1920 -b:v 5M -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/1080/chunk%03d.ts  $OUTPUT_PATH/1080/index.m3u8

#         echo "processing 720"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=720:1280 -b:v 3M  -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/720/chunk%03d.ts  $OUTPUT_PATH/720/index.m3u8
#         echo "processing 480"
#         ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=480:854 -b:v 2M -hls_time 2 -f hls -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/480/chunk%03d.ts $OUTPUT_PATH/480/index.m3u8
# fi


# echo "creating master.m3u8"
# echo '#EXTM3U' > $OUTPUT_PATH/master.m3u8
# echo '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080' >> $OUTPUT_PATH/master.m3u8
# echo '1080/index.m3u8' >> $OUTPUT_PATH/master.m3u8
# echo '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720' >> $OUTPUT_PATH/master.m3u8
# echo '720/index.m3u8' >> $OUTPUT_PATH/master.m3u8
# echo '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480' >> $OUTPUT_PATH/master.m3u8
# echo '480/index.m3u8' >> $OUTPUT_PATH/master.m3u8



 #Upload the HLS output to the destination S3 bucket
#  echo "Uploading processed video to s3://$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION"
#  aws s3 cp $OUTPUT_PATH "s3://$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION" --recursive


#  aws sqs send-message --queue-url "https://sqs.ap-south-1.amazonaws.com/851725498528/s3-link-db-update.fifo" \
#            --message-body "{\"s3Path\":\"$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION/master.m3u8\", \"s3OldPath\":\"$DEST_BUCKET/$FILE_KEY\", \"thumbnailUrl\":\"$DEST_BUCKET/$TRIMMED_FILE_KEY/thumbnail.webp\"}" \
#            --message-group-id "default" \
#            --message-deduplication-id "$(date +%s)"

 # Cleanup
# rm -rf  "$OUTPUT_PATH"


ffmpeg \
-protocol_whitelist file,udp,rtp \
-i stream.sdp \
-filter_complex \
  "[0:v:0]scale=1280:720[v0]; \
   [0:v:1]scale=1280:720[v1]; \
   [v0][v1]hstack=inputs=2[vout]; \
   [0:a:0][0:a:1]amix=inputs=2[aout]" \
-map "[vout]" -map "[aout]" \
-c:v libx264 -preset veryfast -crf 23 -sc_threshold 0 \
-c:a aac -b:a 128k \
-f hls \
-hls_time 4 \
-hls_list_size 5 \
-hls_flags delete_segments \
-master_pl_name master.m3u8 \
-hls_segment_filename "stream_%v/data%02d.ts" \
-var_stream_map "v:0,a:0" "stream_%v.m3u8"

