# videos/

여기에 영상 파일을 넣고 레포 루트에서 아래를 실행하세요.

```bash
node tools/build-manifest.mjs
```

## 파일명 규칙

`순서번호_파트_제목.mp4`

```
01_call_첫인사.mp4
02_call_자기소개.mp4
03_call_하루이야기.mp4
04_call_질문.mp4
05_cctv_거실@CAM03.mp4
06_cctv_작업실@CAM05.mp4
07_cctv_현관@CAM01.mp4
```

- 맨 앞 숫자가 **재생 순서**입니다. (`01`, `02` … 영상이 10개를 넘어도 숫자 정렬로 처리됩니다)
- `call` = 파트 1(가상 인물과의 영상통화), `cctv` = 파트 2(CCTV로 삶을 엿보기)
- `@CAM03` 은 CCTV 화면에 표시할 카메라 번호입니다. (생략 시 자동 부여)
- 파트 표기를 빼고 싶으면 `node tools/build-manifest.mjs --cctv-from=5` 처럼
  몇 번부터 CCTV 파트인지 알려주면 됩니다.

형식은 `.mp4`(H.264 + AAC)를 권장합니다. `.mov`는 브라우저에서 재생이 안 될 수 있습니다.

```bash
# HEVC/ProRes/대용량 → 웹 안전 포맷으로 변환
ffmpeg -i 원본.mov -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p \
       -c:a aac -b:a 192k -movflags +faststart 01_call_첫인사.mp4
```
