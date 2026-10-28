const express = require("express");
const router = express.Router();

const IMG_API_URL = "https://api.imgbb.com/1/upload";
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

router.post("/", async (req, res) => {
  try {
    const { imageUrl, file, name } = req.body;
    const imageSource = typeof imageUrl === "string" ? imageUrl.trim() : "";
    const base64File = typeof file === "string" ? file.trim() : "";

    if (imageSource) {
      return res.status(200).json({
        success: true,
        data: {
          url: imageSource,
          provider: "direct-url",
        },
      });
    }

    const imageMatch = base64File.match(/^data:(image\/(jpeg|jpg|png|webp|gif));base64,(.+)$/i);

    if (!imageMatch) {
      return res.status(400).json({
        success: false,
        message: "A valid image URL or base64 image is required",
      });
    }

    const base64Data = imageMatch[3];
    const imageSizeBytes = Math.ceil((base64Data.length * 3) / 4);

    if (imageSizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        message: "Image size must be 2MB or less",
      });
    }

    const apiKey = process.env.IMGBB_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Image upload is not configured on the server",
      });
    }

    const form = new URLSearchParams();
    form.append("key", apiKey);
    form.append("image", base64File.replace(/^data:image\/[a-zA-Z-]+;base64,/, ""));
    form.append("name", typeof name === "string" && name ? name : "upload");

    const response = await fetch(`${IMG_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const payload = await response.json();

    if (!response.ok || !payload?.data?.url) {
      return res.status(400).json({
        success: false,
        message: "Image upload failed",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        url: payload.data.url,
        provider: "imgbb",
      },
    });
  } catch (error) {
    console.error("Image upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to process image upload",
    });
  }
});

module.exports = { router };
