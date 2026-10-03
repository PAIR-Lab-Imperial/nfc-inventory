export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

const allowedImageTypes = new Set(IMAGE_ACCEPT.split(","));

export function validateImageFile(file) {
  if (!file) return null;
  if (!allowedImageTypes.has(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (!Number.isFinite(file.size) || file.size < 1) return "The selected image is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Image files may not exceed 8 MB.";
  return null;
}

export function suggestAssetCode(categories, equipment, categoryName) {
  const category = categories.find((item) => item.name === categoryName);
  const prefix = String(category?.assetCodePrefix || "").toLocaleUpperCase("en-GB");
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(prefix)) return "";
  const expression = new RegExp(`^${prefix}-(\\d{3,6})$`, "i");
  let highest = 0;
  for (const item of equipment) {
    const match = expression.exec(String(item.assetCode || ""));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}
