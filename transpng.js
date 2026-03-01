const fileInput = document.getElementById("fileInput");
const origCanvas = document.getElementById("originalCanvas");
const resCanvas = document.getElementById("resultCanvas");
const maskCanvas = document.getElementById("maskCanvas");
const ctxOrig = origCanvas.getContext("2d", { willReadFrequently: true });
const ctxRes = resCanvas.getContext("2d");
const ctxMask = maskCanvas.getContext("2d");
const dropZone = document.getElementById("dropZone");
const saveBtn = document.getElementById("saveBtn");

let tappedColor = [255, 255, 255];
let manualSeeds = []; // 追加の背景シード（座標 [x, y] の配列）
let imageLoaded = false;

// --- Color Space Conversion (RGB -> LAB) ---
function rgbToLab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

  x /= 95.047; y /= 100.000; z /= 108.883;
  x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
  y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
  z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

  return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

function labDistance(lab1, lab2) {
  return Math.sqrt((lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2);
}

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    const displayWidth = 400; // UI改善に合わせて少し大きく
    const displayHeight = Math.round(img.height * (displayWidth / img.width));
    origCanvas.width = img.width;
    origCanvas.height = img.height;
    resCanvas.width = img.width;
    resCanvas.height = img.height;
    maskCanvas.width = img.width;
    maskCanvas.height = img.height;
    origCanvas.style.width = displayWidth + "px";
    origCanvas.style.height = displayHeight + "px";
    resCanvas.style.width = displayWidth + "px";
    resCanvas.style.height = displayHeight + "px";
    maskCanvas.style.width = displayWidth + "px";
    maskCanvas.style.height = displayHeight + "px";
    ctxOrig.drawImage(img, 0, 0);
    imageLoaded = true;
    saveBtn.disabled = true;
    manualSeeds = []; // 新しい画像なので手動シードをリセット
    ctxRes.clearRect(0, 0, resCanvas.width, resCanvas.height);
    ctxMask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  };
  img.src = URL.createObjectURL(file);
}

fileInput.addEventListener("change", e => handleFile(e.target.files[0]));

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "transparent_image.png";
  link.href = resCanvas.toDataURL("image/png");
  link.click();
});

origCanvas.addEventListener("click", e => {
  if (!imageLoaded) return;
  const rect = origCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (origCanvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (origCanvas.height / rect.height));
  const p = ctxOrig.getImageData(x, y, 1, 1).data;
  tappedColor = [p[0], p[1], p[2]];
  document.getElementById("colorBox").style.backgroundColor = `rgb(${tappedColor.join(",")})`;
});

// Resultキャンバスをクリックして追加の背景エリアを指定
resCanvas.addEventListener("click", e => {
  if (!imageLoaded) return;
  const rect = resCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (resCanvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (resCanvas.height / rect.height));

  // マニュアルシードに追加
  manualSeeds.push([x, y]);

  // 即座に再処理を実行
  document.getElementById("processBtn").click();
});

// --- Enhanced Flood Fill ---
function gradientAwareFloodFill(width, height, data, bgThreshold, gradThreshold, edgeRadius, manualSeedsArr) {
  const mask = new Float32Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;

  const seeds = [];
  // 四隅
  const cornerCoords = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  // 手動シードを統合
  const allSeedCoords = [...cornerCoords, ...manualSeedsArr];

  allSeedCoords.forEach(([cx, cy]) => {
    // 範囲外チェック
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return;
    const idx = (cy * width + cx) * 4;
    seeds.push(rgbToLab(data[idx], data[idx + 1], data[idx + 2]));
    if (!visited[cy * width + cx]) {
      queue[tail++] = cy * width + cx;
      visited[cy * width + cx] = 1;
    }
  });

  const getLabAt = (tx, ty) => {
    const i = (ty * width + tx) * 4;
    return rgbToLab(data[i], data[i + 1], data[i + 2]);
  };

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx / width) | 0;
    const currentLab = getLabAt(x, y);

    let isBg = false;
    for (const sLab of seeds) {
      if (labDistance(sLab, currentLab) < bgThreshold) {
        isBg = true; break;
      }
    }

    if (isBg) {
      mask[idx] = 1.0;
      const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!visited[nIdx]) {
            // 勾配判定 (edgeRadius を考慮)
            let maxDiff = 0;
            for (let r = 1; r <= edgeRadius; r++) {
              const rx = x + dx * r, ry = y + dy * r;
              if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
                const rLab = getLabAt(rx, ry);
                maxDiff = Math.max(maxDiff, labDistance(currentLab, rLab));
              }
            }

            if (maxDiff < gradThreshold) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
      }
    }
  }
  return mask;
}

// --- Sub-pixel Smoothing ---
function smoothMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const smoothed = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = x + dx, ty = y + dy;
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            sum += mask[ty * width + tx];
            count++;
          }
        }
      }
      smoothed[y * width + x] = sum / count;
    }
  }
  return smoothed;
}

document.getElementById("processBtn").addEventListener("click", () => {
  if (!imageLoaded) return;

  const intensity = +document.getElementById("intensity").value;
  const strength = +document.getElementById("strength").value;
  const useFloodFill = document.getElementById("fullTransparentMode").checked;
  const showMask = document.getElementById("showMask").checked;
  const bgThreshold = +document.getElementById("bgThreshold").value;
  const gradValue = +document.getElementById("gradThreshold").value;
  // 感覚と反転させる: 値が大きいほど敏感（閾値が小さい＝すぐ止まる）
  // 1-100 の入力を 50-0.5 の内部閾値に変換
  const gradThreshold = (101 - gradValue) / 2;
  const edgeRadius = +document.getElementById("edgeRadius").value;
  const smoothRadius = +document.getElementById("smoothRadius").value;

  const imageData = ctxOrig.getImageData(0, 0, origCanvas.width, origCanvas.height);
  const data = imageData.data;
  const tappedLab = rgbToLab(...tappedColor);

  // マスク用のImageDataを作成
  const maskImageData = new ImageData(origCanvas.width, origCanvas.height);
  const maskData = maskImageData.data;

  if (useFloodFill) {
    let mask = gradientAwareFloodFill(origCanvas.width, origCanvas.height, data, bgThreshold, gradThreshold, edgeRadius, manualSeeds);
    mask = smoothMask(mask, origCanvas.width, origCanvas.height, smoothRadius);

    for (let i = 0; i < mask.length; i++) {
      const idx = i * 4;

      // マスクレイヤーの作成 (マゼンタ)
      if (mask[i] > 0.05) {
        maskData[idx] = 255;      // R
        maskData[idx + 1] = 0;    // G
        maskData[idx + 2] = 255;  // B
        maskData[idx + 3] = mask[i] * 128; // Alpha
      }

      // クリーンな変換画像 (保存用)
      if (mask[i] > 0.99) {
        data[idx + 3] = 0;
      } else {
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const currentLab = rgbToLab(r, g, b);
        const dist = labDistance(tappedLab, currentLab);
        const proximity = Math.max(0, 1.0 - (dist / 150));
        const threshold = (255 - intensity) / 255;
        const effective = Math.max(0.0, (proximity - threshold) / (1.0 - threshold));
        let alpha = 255 - (effective * strength);

        if (mask[i] > 0) {
          alpha = Math.min(alpha, 255 * (1 - mask[i]));
        }
        data[idx + 3] = Math.max(0, Math.min(255, alpha));
      }
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      const currentLab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const dist = labDistance(tappedLab, currentLab);
      const proximity = Math.max(0, 1.0 - (dist / 150));
      const threshold = (255 - intensity) / 255;
      const effective = Math.max(0.0, (proximity - threshold) / (1.0 - threshold));
      let alpha = 255 - (effective * strength);
      data[i + 3] = Math.max(1, Math.min(255, alpha));
    }
  }

  ctxRes.putImageData(imageData, 0, 0);
  ctxMask.putImageData(maskImageData, 0, 0);

  // マスクの表示状態を更新
  maskCanvas.style.display = showMask ? "block" : "none";
  saveBtn.disabled = false;
});

saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "transparent_result.png";
  link.href = resCanvas.toDataURL("image/png");
  link.click();
});

// 初期表示
const fullMode = document.getElementById("fullTransparentMode");
fullMode.addEventListener("change", () => {
  document.getElementById("bgThresholdControl").style.display = fullMode.checked ? "block" : "none";
});

// マスクのリアルタイム表示切り替え
const showMaskToggle = document.getElementById("showMask");
showMaskToggle.addEventListener("change", () => {
  maskCanvas.style.display = showMaskToggle.checked ? "block" : "none";
});

["bgThreshold", "gradThreshold", "intensity", "strength", "edgeRadius", "smoothRadius"].forEach(id => {
  const el = document.getElementById(id);
  const valDis = document.getElementById(id + "Value");
  if (el && valDis) {
    el.addEventListener("input", () => valDis.textContent = el.value);
  }
});
