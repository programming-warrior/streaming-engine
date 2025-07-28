#!/bin/bash
#
#
#
#



set -e

cleanup() {
        echo "Cleaning up..."
        rm -rf "$INPUT_VIDEO" "$OUTPUT_PATH"
        echo "Exiting with failure."
        exit 1
}

trap cleanup ERR

if [ -z "$SRC_BUCKET" ]; then
            echo "Error: SRC_BUCKET environment variable is not set"
                exit 1
fi

if [ -z "$FILE_KEY" ]; then
            echo "Error: FILE_KEY environment variable is not set"
                exit 1
fi



OUTPUT_PATH="$HOME/output"

# Create output directory
mkdir -p $OUTPUT_PATH/1080
mkdir -p $OUTPUT_PATH/720
mkdir -p $OUTPUT_PATH/480


# Download the video file from the source S3 bucket
# echo "Downloading video from s3://$SRC_BUCKET/$FILE_KEY"
# aws s3 cp "s3://$SRC_BUCKET/$FILE_KEY" "$INPUT_VIDEO"

#ffmpeg -i $INPUT_VIDEO -codec:v libx264 -codec:a aac -hls_time 4 -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/segment%03d.ts -start_number 0 $OUTPUT_PATH/index.m3u8

#ffmpeg -i "$INPUT_VIDEO" -codec: copy -start_number 0 -hls_time 1 -hls_list_size 0 -f hls "$OUTPUT_PATH/index.m3u8"


#ffmpeg -i $INPUT_VIDEO \
#          -filter:v:0 "scale=w=1920:h=1080:force_original_aspect_ratio=decrease" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k \
#            -filter:v:1 "scale=w=1280:h=720:force_original_aspect_ratio=decrease" -c:v:1 libx264 -b:v:1 3000k -maxrate:v:1 3210k -bufsize:v:1 4500k \
#              -filter:v:2 "scale=w=854:h=480:force_original_aspect_ratio=decrease" -c:v:2 libx264 -b:v:2 1500k -maxrate:v:2 1600k -bufsize:v:2 2250k \
#                -filter:v:3 "scale=w=640:h=360:force_original_aspect_ratio=decrease" -c:v:3 libx264 -b:v:3 800k -maxrate:v:3 856k -bufsize:v:3 1200k \
#                  -map 0:v -f hls \
#                    -var_stream_map "v:0 v:1 v:2 v:3" \
#                      -master_pl_name $OUTPUT_PATH/master.m3u8 \
#                        -hls_time 6 -hls_playlist_type vod \
#                          -hls_segment_filename "$OUTPUT_PATH/output_%v/segment_%03d.ts" \
#                            $OUTPUT/output_%v.m3u8

VIDEO_DIM=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$INPUT_VIDEO")
WIDTH=$(echo $VIDEO_DIM | cut -d'x' -f1)
HEIGHT=$(echo $VIDEO_DIM | cut -d'x' -f2)

if [ "$WIDTH" -ge "$HEIGHT" ]; then
        echo "processing 1080"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1920:1080 -b:v 5M -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/1080/chunk%03d.ts  $OUTPUT_PATH/1080/index.m3u8
        echo "processing 720"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1280:720 -b:v 3M  -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/720/chunk%03d.ts  $OUTPUT_PATH/720/index.m3u8
        echo "processing 480"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=854:480 -b:v 2M -hls_time 2 -f hls -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/480/chunk%03d.ts $OUTPUT_PATH/480/index.m3u8

elif [ "$WIDTH" -lt "$HEIGHT" ]; then
        echo "processing 1080"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=1080:1920 -b:v 5M -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/1080/chunk%03d.ts  $OUTPUT_PATH/1080/index.m3u8

        echo "processing 720"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=720:1280 -b:v 3M  -hls_time 2  -f hls  -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/720/chunk%03d.ts  $OUTPUT_PATH/720/index.m3u8
        echo "processing 480"
        ffmpeg -i $INPUT_VIDEO -c:v libx264 -vf scale=480:854 -b:v 2M -hls_time 2 -f hls -hls_playlist_type vod -hls_segment_filename $OUTPUT_PATH/480/chunk%03d.ts $OUTPUT_PATH/480/index.m3u8
fi


echo "creating master.m3u8"
echo '#EXTM3U' > $OUTPUT_PATH/master.m3u8
echo '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080' >> $OUTPUT_PATH/master.m3u8
echo '1080/index.m3u8' >> $OUTPUT_PATH/master.m3u8
echo '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720' >> $OUTPUT_PATH/master.m3u8
echo '720/index.m3u8' >> $OUTPUT_PATH/master.m3u8
echo '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480' >> $OUTPUT_PATH/master.m3u8
echo '480/index.m3u8' >> $OUTPUT_PATH/master.m3u8



 #Upload the HLS output to the destination S3 bucket
 echo "Uploading processed video to s3://$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION"
 aws s3 cp $OUTPUT_PATH "s3://$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION" --recursive


 aws sqs send-message --queue-url "https://sqs.ap-south-1.amazonaws.com/851725498528/s3-link-db-update.fifo" \
           --message-body "{\"s3Path\":\"$DEST_BUCKET/$FILE_KEY_WITHOUT_EXTENSION/master.m3u8\", \"s3OldPath\":\"$DEST_BUCKET/$FILE_KEY\", \"thumbnailUrl\":\"$DEST_BUCKET/$TRIMMED_FILE_KEY/thumbnail.webp\"}" \
           --message-group-id "default" \
           --message-deduplication-id "$(date +%s)"

 # Cleanup
rm -rf  "$OUTPUT_PATH"
