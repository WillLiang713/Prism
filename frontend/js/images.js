import { state, elements, createId } from './state.js';
import { showAlert } from './dialog.js';

const MAX_IMAGE_FILE_SIZE_MB = 50;
const MAX_IMAGE_FILE_SIZE_BYTES = MAX_IMAGE_FILE_SIZE_MB * 1024 * 1024;

export function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("不是有效的图片文件"));
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      reject(new Error(`图片大小不能超过${MAX_IMAGE_FILE_SIZE_MB}MB`));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

// 添加图片到状态
export async function addImages(files) {
  if (!files || files.length === 0) return;

  const fileArray = Array.from(files);
  for (const file of fileArray) {
    try {
      const dataUrl = await readImageAsDataUrl(file);
      const image = {
        id: createId(),
        dataUrl,
        name: file.name,
        size: file.size,
        type: file.type,
      };
      state.images.selectedImages.push(image);
    } catch (e) {
      console.error("添加图片失败:", e);
      await showAlert(`添加图片失败：${e.message}`, {
        title: "图片处理失败",
      });
    }
  }

  renderImagePreviews();
}

// 从状态中移除图片
export function removeImage(imageId) {
  state.images.selectedImages = state.images.selectedImages.filter(
    (img) => img.id !== imageId
  );
  renderImagePreviews();
}

// 清空所有图片
export function clearImages() {
  state.images.selectedImages = [];
  renderImagePreviews();
}

// 渲染图片预览
export function renderImagePreviews() {
  const container = elements.imagePreviewContainer;
  if (!container) return;

  const images = state.images.selectedImages;

  if (images.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "flex";
  container.innerHTML = "";

  for (const image of images) {
    const preview = document.createElement("div");
    preview.className = "image-preview-item";
    preview.dataset.imageId = image.id;

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.innerHTML = "×";
    removeBtn.addEventListener("click", () => removeImage(image.id));

    preview.appendChild(img);
    preview.appendChild(removeBtn);
    container.appendChild(preview);
  }
}
