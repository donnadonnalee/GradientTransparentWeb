const fileInput = document.getElementById("fileInput");
const origCanvas = document.getElementById("originalCanvas");
const resCanvas = document.getElementById("resultCanvas");
const ctxOrig = origCanvas.getContext("2d");
const ctxRes = resCanvas.getContext("2d");
const dropZone = document.getElementById("dropZone");
const saveBtn = document.getElementById("saveBtn");

let tappedColor = [255, 255, 255];
let imageLoaded = false;

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    const displayWidth = 300;
    const displayHeight = Math.round(img.height * (displayWidth / img.width));
    origCanvas.width = img.width;
    origCanvas.height = img.height;
    resCanvas.width = img.width;
    resCanvas.height = img.height;
    // 表示サイズをstyleで指定
    origCanvas.style.width = displayWidth + "px";
    origCanvas.style.height = displayHeight + "px";
    resCanvas.style.width = displayWidth + "px";
    resCanvas.style.height = displayHeight + "px";
    ctxOrig.drawImage(img, 0, 0);
    imageLoaded = true;
    saveBtn.disabled = true; // 新しい画像が読み込まれたら保存ボタンを無効化
  };
  img.src = URL.createObjectURL(file);
}

fileInput.addEventListener("change", e => {
  handleFile(e.target.files[0]);
});

// Drag & Drop
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

// Save Functionality
saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "transparent_image.png";
  link.href = resCanvas.toDataURL("image/png");
  link.click();
});

// クリック座標をオリジナル画像座標に変換
origCanvas.addEventListener("click", e => {
  if (!imageLoaded) {
    alert("最初に「ファイル選択」で画像をセットしてください");
    return;
  }
  const rect = origCanvas.getBoundingClientRect();
  // 表示上のクリック位置
  const dispX = e.clientX - rect.left;
  const dispY = e.clientY - rect.top;
  // オリジナル画像サイズに変換
  const scaleX = origCanvas.width / rect.width;
  const scaleY = origCanvas.height / rect.height;
  const x = Math.floor(dispX * scaleX);
  const y = Math.floor(dispY * scaleY);
  const pixel = ctxOrig.getImageData(x, y, 1, 1).data;
  tappedColor = [pixel[0], pixel[1], pixel[2]];
  document.getElementById("colorBox").style.backgroundColor = `rgb(${tappedColor.join(",")})`;
});

function floodFillMask(ctx, width, height, bgColor, bgThreshold) {
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue = [];

  // 四隅から開始
  queue.push([0, 0]);
  queue.push([width - 1, 0]);
  queue.push([0, height - 1]);
  queue.push([width - 1, height - 1]);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const i = idx * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dist = Math.sqrt((bgColor[0] - r) ** 2 + (bgColor[1] - g) ** 2 + (bgColor[2] - b) ** 2);
    if (dist < bgThreshold) {
      mask[idx] = 1; // 背景領域
      // 4近傍
      if (x > 0) queue.push([x - 1, y]);
      if (x < width - 1) queue.push([x + 1, y]);
      if (y > 0) queue.push([x, y - 1]);
      if (y < height - 1) queue.push([x, y + 1]);
    }
  }
  return mask;
}

// 背景判定の閾値スライダー表示切替
const fullTransparentMode = document.getElementById("fullTransparentMode");
const bgThresholdControl = document.getElementById("bgThresholdControl");
const bgThresholdSlider = document.getElementById("bgThreshold");
const bgThresholdValue = document.getElementById("bgThresholdValue");

fullTransparentMode.addEventListener("change", () => {
  bgThresholdControl.style.display = fullTransparentMode.checked ? "block" : "none";
});

// スライダー値表示
bgThresholdSlider.addEventListener("input", () => {
  bgThresholdValue.textContent = bgThresholdSlider.value;
});

// 画像処理本体
document.getElementById("processBtn").addEventListener("click", () => {
  if (!imageLoaded) {
    alert("最初に「ファイル選択」で画像をセットしてください");
    return;
  }

  const intensity = +document.getElementById("intensity").value;
  const strength = +document.getElementById("strength").value;
  const useFloodFill = fullTransparentMode.checked;
  const bgThreshold = +bgThresholdSlider.value;

  const imageData = ctxOrig.getImageData(0, 0, origCanvas.width, origCanvas.height);
  const data = imageData.data;
  const maxDist = Math.sqrt(255 ** 2 * 3);

  if (useFloodFill) {
    // 背景色を推定
    const bgColor = getCornerColorAverage(ctxOrig, origCanvas.width, origCanvas.height);
    // Flood Fillで背景マスク作成
    const mask = floodFillMask(ctxOrig, origCanvas.width, origCanvas.height, bgColor, bgThreshold);

    for (let y = 0; y < origCanvas.height; y++) {
      for (let x = 0; x < origCanvas.width; x++) {
        const idx = y * origCanvas.width + x;
        const i = idx * 4;
        if (mask[idx]) {
          // 背景領域→完全透明
          data[i + 3] = 0;
        } else {
          // 被写体領域→タップ色との近似度で透過
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const dist = Math.sqrt((tappedColor[0] - r) ** 2 + (tappedColor[1] - g) ** 2 + (tappedColor[2] - b) ** 2);
          const proximity = 1.0 - (dist / maxDist);
          const threshold = (255 - intensity) / 255;
          const effective = Math.max(0.0, (proximity - threshold) / (1.0 - threshold));
          let alpha = 255 - (effective * strength);
          alpha = Math.max(1, Math.min(255, alpha));
          data[i + 3] = alpha;
        }
      }
    }
  } else {
    // 通常の半透明処理
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dist = Math.sqrt((tappedColor[0] - r) ** 2 + (tappedColor[1] - g) ** 2 + (tappedColor[2] - b) ** 2);
      const proximity = 1.0 - (dist / maxDist);
      const threshold = (255 - intensity) / 255;
      const effective = Math.max(0.0, (proximity - threshold) / (1.0 - threshold));
      let alpha = 255 - (effective * strength);
      alpha = Math.max(1, Math.min(255, alpha));
      data[i + 3] = alpha;
    }
  }

  ctxRes.putImageData(imageData, 0, 0);
  saveBtn.disabled = false;
});

function getCornerColorAverage(ctx, width, height) {
  const corners = [
    ctx.getImageData(0, 0, 1, 1).data,
    ctx.getImageData(width - 1, 0, 1, 1).data,
    ctx.getImageData(0, height - 1, 1, 1).data,
    ctx.getImageData(width - 1, height - 1, 1, 1).data
  ];
  const avg = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    avg[0] += corners[i][0];
    avg[1] += corners[i][1];
    avg[2] += corners[i][2];
  }
  return avg.map(v => v / 4);
}